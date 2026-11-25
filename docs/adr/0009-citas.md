# ADR 0009: Citas en Rust, solape, máquina de estados y guarda D9

- **Estado:** Aceptada
- **Fecha:** 2026-11-24
- **Fase:** 5
- **Fuentes:** `docs/adr/0005-tiempo-utc-y-hora-local.md` (auditoría y throttle en UTC), `docs/adr/0007-catalogo-y-auditoria-de-negocio.md` (puntos 3 y 5, guarda D9 transitoria), `docs/adr/0008-clientes.md` (acoplamientos transitorios, límite de la guarda D9), `docs/planeers/plan-mvp.md` (D9, D11, D15), `docs/pr/fase5-citas.md`, `src/features/appointments/rules.ts` (copia exacta de la máquina de estados)

## Contexto

- Las citas seguían en el mock del front (`src/lib/mock/`). Clientes, catálogo y recursos ya estaban en Rust (Fases 3 y 4).
- Un recurso con citas futuras no puede desactivarse (D9). En Fases 0 a 4 esa guarda era solo de front; Rust no la impedía (ADR 0007, punto 3; ADR 0008, límites).
- El historial de cliente, los pagos y las métricas leían citas del mock. Se mantienen como acoplamientos transitorios hasta las Fases 6 y 7.

## Decisión

### 1. Migración 0011 (`src-tauri/src/db/migrations/0011_appointments.sql`)

- Tabla `appointments`: `client_id`, `service_id`, `resource_id` con FK a `clients`, `services` y `resources`. `status` en `scheduled | in_progress | completed | cancelled | no_show`.
- Snapshots de precio (`price_cents_snapshot` ≥ 0) y duración (`duration_min_snapshot` entre 1 y 1440). Una cita conserva el precio y la duración del servicio del momento de crearla.
- `notes` nulo o de hasta 500 caracteres.
- CHECK de formato: `starts_at` y `ends_at` deben sobrevivir a `strftime('%Y-%m-%dT%H:%M', …)`. Rechaza `25:00` y `30-feb`.
- CHECK de coherencia: `ends_at = strftime(starts_at, '+' || duration_min_snapshot || ' minutes')`.
- CHECK de medianoche: `ends_at` cae el mismo día que `starts_at` o es exactamente `dia+1T00:00`.
- Índices: `(resource_id, starts_at)`, `(client_id, starts_at)` y `(starts_at)`.
- Se registra como `(11, …)` en `src-tauri/src/db/migrations.rs`. Las migraciones 0001 a 0010 no cambian.

### 2. Hora local `YYYY-MM-DDTHH:MM` (D-a)

- Las citas guardan hora local sin zona. Se comparan como texto (D11): `starts_at < :fin AND ends_at > :inicio` es correcto porque el formato ordena lexicográficamente igual que cronológicamente.
- ADR 0005 sigue vigente para auditoría y throttle (UTC). No se aplica a `starts_at`.
- "Ahora" se obtiene con `strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')` (`repository::local_minute_now`). Las funciones que dependen de la hora reciben `now` por parámetro (`*_at(now)`), y la entrada se valida con `require_valid_local_minute` (`db/mod.rs`), con el mismo criterio fail-closed que `require_valid_instant`. Un valor inválido produce `DbError::InvalidLocalMinute`, que sale como `internal` (`named_records/failure.rs`).
- Usos de `now`: atajo de completar (D-d) y guarda D9 (punto 8).

### 3. Aritmética de fechas propia en Rust (D-b)

- `features/appointments/rules.rs` implementa `days_from_civil` y `civil_from_days` sin crate `time`. Valida fechas reales (años bisiestos, 30-feb rechazado) y calcula `ends_at`.
- `ends_at(starts_at, duración)` rechaza con `CrossesMidnight` cualquier cita que termine después de la medianoche siguiente. Ejemplos de la tabla de pruebas (`rules_test.rs`): 23:00 + 60 min se acepta y termina `00:00` del día siguiente; 23:30 + 60 min se rechaza; 00:00 + 1440 min se acepta; 00:05 + 1440 min se rechaza.
- Inicio válido: múltiplo de 5 minutos (`START_STEP_MIN`), en `has_valid_start`. Si no cumple, error `validation` sobre `startsAt`.

### 4. Solape en transacción (D-c)

- `ensure_slot_free` (`service.rs`) busca en `find_overlaps` citas del mismo recurso con `starts_at < :fin AND ends_at > :inicio`, estado en `scheduled | in_progress | completed` e `id IS NOT :propia`.
- Las comprobaciones de solape se hacen dentro de `db.with_tx` (`BEGIN IMMEDIATE`). Los comandos de escritura comprueban permisos antes y dentro de la transacción.
- Intervalo `[inicio, fin)`: una cita que termina a las 10:00 no solapa con una que empieza a las 10:00. `fin == inicio` no solapa.
- Cancelada y no asistió no bloquean el hueco (`blocks_slot`).
- Error `overlap` con `entityIds` = ids de las citas en conflicto.
- **Sin trigger en BD.** El solape se garantiza solo en el repositorio y el servicio. Seed, restauración e importación deben pasar por la misma comprobación; no existe una red de seguridad en SQL. Es una decisión consciente: un trigger de solape complicaría la migración y el seed, y el único escritor de citas es el backend Rust.

### 5. Máquina de estados y reapertura (D-d)

- `rules::can_transition` reproduce la tabla de `src/features/appointments/rules.ts`:
  - `start` y `markNoShow`: solo desde `scheduled`.
  - `cancel`: desde `scheduled` o `in_progress`.
  - `complete`: desde `in_progress`, o desde `scheduled` si `now >= starts_at` (atajo).
  - `reopen`: desde un estado final (`completed`, `cancelled`, `no_show`) a `scheduled`.
- Mover (`move_appointment`) solo en `scheduled`. Destino en recurso activo (`resourceInactive` si no). La duración se congela (`duration_min_snapshot`), así que el nuevo `ends_at` se recalcula con ella. Mover a su propio hueco se acepta sin cambios.
- `reopen` exige `appointments.write` y `appointments.reopen`. Solo la Propietaria tiene `appointments.reopen`. La comprobación se hace fuera de la transacción y de nuevo dentro (`reopen_is_rechecked_inside_the_transaction…`).
- Al reabrir se revalida el solape con `ensure_slot_free` (excluyendo la propia cita). Si la cita tiene `ends_at > now` y su recurso está inactivo, se devuelve `resourceInactive`. Una cita final ya pasada en un recurso inactivo puede reabrirse.

### 6. Auditoría (D-f)

- Entidad `appointment`.
- Crear: `create` con el snapshot completo (`appointment_snapshot`).
- Mover, cambios de estado e reapertura: `update` con diff por campo (`appointment_change_diff`).
- No existe acción `reopen`. `audit_log` solo acepta inserción y su CHECK de acciones se mantiene (ADR 0005 y ADR 0004).
- **Notas nunca en claro en la auditoría.** El snapshot guarda `hasNotes` y el diff guarda `notesChanged` (booleano). El texto de la nota no aparece en `audit_log`. Esto difiere de la PII de clientes (ADR 0008, punto 8).
- Un cambio sin diferencia no audita.

### 7. Guarda D9 en Rust (cierre del punto 3 del ADR 0007)

- `resources::service::set_resource_active_at` consulta dentro de la transacción `future_scheduled_of_resource(recurso, now)`. Semántica (decisión del usuario, P2): cualquier cita `scheduled` con `ends_at > now`. Así cubre también las citas atrasadas que siguen en `scheduled` sin cerrar.
- Si hay citas bloqueantes, error `resourceHasFutureAppointments` con `entityIds` = ids bloqueantes.
- No bloquean: citas pasadas (`ends_at <= now`), canceladas, no asistió, completadas y en curso.
- Reactivar no consulta la guarda. Si el estado no cambia, no audita.
- Comando `list_future_appointments_of_resource(id)` devuelve solo `{ id, startsAt }` y exige `resources.manage`. No expone cliente, precio ni notas.

### 8. Creación (D-e)

- Orden de validación, igual que el mock: formato de ids y de `startsAt` (`validation`), notas (`validation` sobre `notes`), cliente (`notFound` sobre `clientId`, si no existe o está borrado), servicio (`notFound` sobre `serviceId` si no existe; `validation` sobre `serviceId` si está inactivo), recurso (`notFound` sobre `resourceId` si no existe; `resourceInactive` si está inactivo), fin de medianoche (`crossesMidnight`), solape (`overlap`).
- Snapshots de precio y duración del servicio. Cambiar el servicio después no altera citas existentes (`service_create_test`).
- Se permite crear citas en el pasado.
- Notas: se recortan los espacios. Máximo 500 caracteres y sin caracteres de control (`is_allowed_text_character`).

### 9. Comandos IPC

- 6 comandos nuevos: `list_appointments(range)`, `list_all_appointments()`, `create_appointment`, `move_appointment`, `transition_appointment`, `list_future_appointments_of_resource`. Total: **42 comandos** (`src/lib/bindings.ts`, verificado: 42 invocaciones `__TAURI_INVOKE` distintas).
- `list_all_appointments` es la colección completa para el espejo del front. Existe porque `list_appointments` con la ventana de ±182 días dejaba fuera citas fuera de ese rango, y el espejo las perdía.
- Lectura (`list_appointments`, `list_all_appointments`): `appointments.read` o `appointments.write`.
- Escritura (`create`, `move`, `transition`): `appointments.write`. `transition` con `reopen` además exige `appointments.reopen`.

### 10. Errores nuevos

| Código | Mensaje | Campo | entityIds | Cuándo |
|---|---|---|---|---|
| `overlap` | El recurso ya tiene una cita en ese horario | `startsAt` | ids en conflicto | solape con otra cita del mismo recurso |
| `crossesMidnight` | La cita no puede terminar después de la medianoche | `startsAt` | ninguno | inicio + duración pasa de la medianoche |
| `invalidTransition` | La cita no admite esa operación en su estado actual | ninguno | ninguno | transición o mover fuera de `scheduled` |
| `resourceInactive` | El recurso está inactivo | `resourceId` | ninguno | crear, mover o reabrir en recurso inactivo |
| `resourceHasFutureAppointments` | El recurso tiene citas futuras que deben reubicarse antes de desactivarlo | ninguno | ids bloqueantes | desactivar recurso con citas `scheduled` con `ends_at > now` |
| `notFound` (reutilizado) | La cita no existe / El cliente no existe / El servicio no existe / El recurso no existe | `clientId`, `serviceId` o `resourceId` según caso | ninguno | id inexistente |
| `validation` (reutilizado) | — | `startsAt`, `notes`, `serviceId`, `resourceId`, `durationMin`, `from`, `to` | ninguno | formato o rango inválido |

- Los cinco códigos nuevos están en `src-tauri/src/errors.rs`. Los mensajes del mock se mantienen en `src/test/ipc/ipc-errors.ts`.

### 11. Espejo en el front (D-g)

- `src/features/appointments/api.ts`:
  - `listAppointments(rango)` es lectura filtrada en Rust. **No reemplaza el espejo**, igual que `getClient`.
  - `syncAppointmentsMirror()` trae la colección completa con `createMirrorSync().list` y reemplaza el espejo. Lo usan los consumidores que calculan sobre citas.
  - Las mutaciones (`createAppointment`, `moveAppointment`, `transitionAppointment`) reflejan el resultado de Rust con `reflectMutation`.
  - `createAppointment` ya no refresca clientes con `refreshMirrorsFromRust`; Rust valida.
- `src/features/resources/api.ts`: `setResourceActive` y `listFutureAppointmentsOfResource` pasan a Rust. Se elimina la guarda de mock de Fase 3.

### 12. Acoplamientos transitorios (se retiran en Fases 6 y 7)

- `src/features/payments/api.ts` (`createPayment`), `src/features/metrics/api.ts` y `src/features/client-history/api.ts` llaman a `syncAppointmentsMirror()` antes de validar o calcular.
- Requieren `appointments.read` o `appointments.write`. Los roles seed (Propietaria, Recepción, Solo lectura) cumplen esa condición.
- Mutar una cita invalida las claves de métricas, historial y pagos en `hooks.ts`.

### 13. Backend simulado y paridad

- `src/test/ipc/appointments-backend.ts` reproduce las reglas de Rust (solape, medianoche, estados, reapertura, D9) sobre el estado compartido `shared-rows`.
- `src/test/ipc/appointments-backend-parity.test.ts` ejecuta los mismos casos contra el simulado. `resources-backend.ts` aplica la guarda D9 (semántica P2) sobre las citas compartidas.
- `scripts/check-bundle.ts`: `createAppointmentsIpcBackend` en `IDENTIFIER_MARKERS`. Los centinelas siguen sin bloquear (`SEED_SENTINELS_BLOCK_BUNDLE = false`) hasta la Fase 6.

### 14. Seed de desarrollo (D-h)

- `src-tauri/src/dev_seed_appointments.rs`: solo en `#[cfg(debug_assertions)]`, con `SPA_DEV_SEED_PASSWORD`, solo si la tabla `appointments` está vacía y tras los seeds de catálogo y clientes.
- Dieciséis citas con ids 1 a 16, iguales a `src/lib/mock/seed.ts`. Estados finales en algunas, recurso 3 inactivo, cliente 9 borrado. Las fechas son relativas al día del primer arranque (`SeedDay`). Cada inserción audita `create`.
- Por la coherencia con el mock, el seed de pagos del mock (`src/lib/mock/seed.ts`) apunta a las citas 1 a 16 (decisión del usuario, P1; ver punto 15).

### 15. Decisiones del usuario

- **P1:** los pagos de seed del mock enganchados a las citas 1 a 16 se aceptan en builds de producción. **No distribuir builds antes de la Fase 6**, que retira el mock del bundle.
- **P2:** guarda D9 = cualquier cita `scheduled` con `ends_at > now` (cubre atrasadas sin cerrar). Se alinea el mock.
- **P3:** borrar un cliente con citas futuras se permite, sin guarda.

## Consecuencias

- Las reglas de tiempo, solape y estado existen en Rust y en el mock. Un cambio en una exige cambiar la otra y sus pruebas de paridad (`appointments-backend-parity.test.ts`, `rules_test.rs`).
- El solape depende del código Rust. Sin trigger, cualquier escritura futura fuera de `repository.rs` debe repetir la comprobación.
- La auditoría de citas no contiene texto de notas. La de clientes sí contiene PII (ADR 0008).
- Los acoplamientos de payments, metrics y client-history dependen del espejo de citas hasta la Fase 6.

## Límites

- `list_appointments` y `list_all_appointments` no paginan. La colección completa viaja en cada sincronización del espejo.
- `resourceInactive` al reabrir se evalúa con `ends_at > now`, no con `starts_at > now`. Una cita final cuyo `ends_at` aún no llegó no puede reabrirse en un recurso inactivo; una cuyo `ends_at` ya pasó sí puede, aunque quede `scheduled` en el pasado.
- La guarda D9 vive en el comando de desactivación de recursos. Cualquier otra vía de escritura a `resources.active` debe pasar por el mismo servicio.
- `cargo test --release --no-run` no compila. Es deuda preexistente: `insert_user` y `NewUser` quedan detrás de `cfg(debug_assertions)` y las pruebas de `features/auth` los importan. Se verificó en esta fase (37 errores, todos de `features/auth`).
- Zona horaria fija `America/Caracas` en las pruebas (`src/test/timezone-config.test.ts`). No se prueban otras zonas.
