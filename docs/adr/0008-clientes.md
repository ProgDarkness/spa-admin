# ADR 0008: Clientes en Rust, cédula, búsqueda y auditoría

- **Estado:** Aceptada
- **Fecha:** 2026-11-24
- **Fase:** 4
- **Fuentes:** `docs/adr/0007-catalogo-y-auditoria-de-negocio.md` (D15, espejos, seed de desarrollo), `docs/adr/0004-sesion-y-auditoria.md` (permisos y auditoría), `docs/planeers/plan-mvp.md` (D7 cédula obligatoria, D15 auditoría), `docs/pr/fase4-clientes.md`

## Contexto

- La Fase 3 dejó catálogo, recursos, métodos de pago y tasas en Rust. Los clientes seguían en el mock del front (`src/lib/mock/`).
- D7 (plan-mvp) exige cédula obligatoria, única, con formato `V|E|J-dígitos`.
- D15 exige auditar creación, edición, desactivación y reactivación de clientes.
- Las citas (Fase 5) y el historial de cliente (Fase 7) dependen de clientes en Rust.

## Decisión

### 1. Migración 0010 (`src-tauri/src/db/migrations/0010_clients.sql`)

- Tabla `clients`: `id` autoincremental, `first_name` y `last_name` no vacíos, `national_id` `NOT NULL UNIQUE`, `phone` no vacío de hasta 32 caracteres, `search_key`, `deleted_at` (nulo si activo), `created_at`/`updated_at` con formato `YYYY-MM-DDTHH:MM` local, y `created_by`/`updated_by` referenciando `users(id)`.
- CHECK de `national_id`: prefijo `V`, `E` o `J`, guion, solo dígitos después, longitud 8 a 11 caracteres.
- La migración se registra como `(10, ...)` en `src-tauri/src/db/migrations.rs`. Las migraciones 0001 a 0009 no cambian.

### 2. Cédula V|E|J normalizada en Rust y en la UI

- Regla idéntica en `src-tauri/src/features/clients/normalization.rs` (`normalize_national_id`) y en `src/features/clients/national-id.ts` (`normalizeNationalId`).
- Formas aceptadas: prefijo `V`, `E` o `J` sin distinguir mayúsculas; separador `-`, espacio o ninguno; cuerpo con 6 a 9 dígitos. El cuerpo puede llevar puntos de miles con grupos de 3 (`12.345.678`, primer grupo de hasta 3 dígitos).
- Forma guardada: `V-12345678` (sin separadores de miles, prefijo en mayúscula).
- Las cédulas escritas como `v12345678`, `V 12345678` o `V-12.345.678` se guardan igual que `V-12345678`.

### 3. Teléfono

- Se acepta un `+` opcional al inicio, dígitos, `-` y espacios. Entre 7 y 15 dígitos; máximo 32 caracteres; sin caracteres de control.
- Se guarda como se escribió, con los espacios repetidos colapsados a uno (`split_whitespace` en `valid_phone`).
- La búsqueda usa los dígitos: `search_key` incluye `phone_digits(phone)`.

### 4. Búsqueda: LIKE sobre `search_key`, no FTS5

- `search_key` concatena nombre, apellido, cédula (con y sin separadores), teléfono y dígitos del teléfono, todo en minúsculas y sin marcas diacríticas (`fold_text`).
- La consulta se normaliza igual (`search_term`): recorte a 100 caracteres (`QUERY_MAX_CHARACTERS`, se trunca, no se rechaza); si parece cédula o teléfono, se quitan `+`, espacios, `-` y `.`.
- Los comodines `%`, `_` y la propia `\` se escapan con `ESCAPE '\'` (`like_pattern`). Una consulta vacía produce `%%` y devuelve todo.
- Por qué no FTS5: la búsqueda necesita subcadenas de cédula y de dígitos de teléfono (prefijos y partes internas), que la tokenización de FTS5 no resuelve sin un tokenizador propio. Un LIKE con comodín inicial recorre la tabla completa; con el volumen esperado de clientes de un spa es aceptable. *(Razonamiento de este ADR; no hay medición de rendimiento en esta fase.)*

### 5. Operaciones y auditoría D15

- `create`: valida, comprueba cédula libre, inserta y audita `create` con el snapshot completo del cliente (`Diff::created`).
- `update`: valida, comprueba que la cédula no pertenezca a otro cliente (incluido uno borrado), y si los campos no cambian devuelve el cliente sin auditar. Si cambian, audita `update` con el diff por campo.
- `soft_delete` / `reactivate` (`set_client_deleted`): si el estado ya coincide, devuelve el cliente sin auditar. Si cambia, audita `soft_delete` o `reactivate` con diff por campo. No hay borrado físico.
- Se audita dentro de la transacción de la acción (`db.with_tx`, `record_change` de `named_records`), entidad `client`.
- Snapshot auditado: `firstName`, `lastName`, `nationalId`, `phone`, `deleted`.
- Actualizar un cliente borrado está permitido y el cliente queda borrado (no se toca `deleted_at`).

### 6. Errores nuevos

| Código | Mensaje | Campo | entityIds | Cuándo |
|---|---|---|---|---|
| `notFound` | Cliente no encontrado | ninguno | ninguno | id inexistente en `get`, `update` o `set_client_deleted` |
| `nationalIdTaken` | Ya existe un cliente con esa cédula | `nationalId` | ninguno | alta o edición con cédula de otro cliente activo o borrado |
| `clientDeletedReactivate` | Ya existió un cliente eliminado con esa cédula. ¿Reactivarlo? | `nationalId` | `[id del cliente borrado]` | alta con cédula de un cliente borrado |

- Los tres están en `src-tauri/src/errors.rs` y en el shim de pruebas `src/test/ipc/ipc-errors.ts`.
- Solo el alta distingue cliente borrado (`DeletedHolder`). La edición devuelve `nationalIdTaken` en ambos casos.

### 7. Permisos

- `clients.read` o `clients.write` para `list_clients` y `get_client` (`require_any_permission`).
- `clients.write` para `create_client`, `update_client` y `set_client_deleted` (`require_permission`), comprobado antes de la transacción y de nuevo dentro de ella, con permisos recargados desde la BD.
- Es la frontera de seguridad. La navegación del front no lo sustituye.

### 8. PII en claro en el log de auditoría (decisión consciente)

- Las filas de `audit_log` guardan nombre, apellido, cédula y teléfono en claro dentro de `diff`, conforme a D15.
- Quien tenga `audit.read` puede ver esos datos. Es un riesgo aceptado en esta fase; no se cifra ni se enmascara el diff.

### 9. Seed de desarrollo

- `src-tauri/src/dev_seed_clients.rs`: solo en `#[cfg(debug_assertions)]` (`lib.rs`, `setup.rs`), solo si `SPA_DEV_SEED_PASSWORD` está definida y existe la Propietaria sembrada, y solo si la tabla `clients` está vacía.
- Nueve clientes con ids 1 a 9. El 9 (Carlos Mendoza, `V-26789012`) se crea y se desactiva con `set_client_deleted`, para tener un caso borrado.
- El seed del mock de `src/lib/mock/seed.ts` contiene el mismo `V-26789012`; por eso `check:bundle` lo reporta como centinela informativo (ADR 0007, punto 5).

### 10. Espejo en el front

- `src/features/clients/api.ts` mantiene el espejo con `createMirrorSync`, igual que catálogo y recursos (ADR 0007, punto 6).
- `listClients(filter)` hace dos llamadas dentro de una sola operación del espejo: `listClients({ query: '', includeDeleted: true })` (colección completa) y, si hay consulta, `listClients({ query, includeDeleted: true })` (coincidencias). El espejo se reemplaza solo con la colección completa; la llamada filtrada solo determina el orden y el subconjunto de la vista. Una mutación entre ambas llamadas la descarta el contador de `mirror-sync`.
- Los filtros de activos se aplican después (`visibleClients`).
- `getClient(id)` es lectura: no reemplaza el espejo.
- Las mutaciones (`createClient`, `updateClient`, `softDeleteClient`, `reactivateClient`) reflejan el resultado de Rust con `reflectMutation`.

### 11. Acoplamientos transitorios

- `src/features/appointments/api.ts` refresca el espejo de clientes antes de validar una cita (`refreshMirrorsFromRust` con `listClients({ query: null, includeDeleted: true })`).
- `src/features/client-history/api.ts` toma el cliente de `getClient` antes de construir el historial.
- Ambos se retiran cuando el seed del mock salga del bundle (Fase 6, ADR 0007, punto 5). Mientras tanto, citas e historial dependen de clientes en Rust.

### 12. Riesgo D7

- Un cliente sin cédula válida no se puede cargar. Rust rechaza la alta con `validation` sobre `nationalId` y el CHECK de la tabla lo impide en la BD.
- Es el efecto del riesgo que D7 registra en el plan (clientes que llegan solo con nombre). El plan dice que la regla se informa a la empleada, no que se condicione el flujo.

## Consecuencias

- Búsqueda y validación de cédula son idénticas en Rust y en la UI; un cambio en una regla exige cambiar la otra y sus pruebas de paridad (`src/test/ipc/clients-backend-parity.test.ts`, `src/features/clients/national-id.test.ts`).
- El diff de auditoría contiene PII; cualquier exportación del log de auditoría la expone.
- `list_clients` no pagina: la respuesta trae todos los clientes en cada búsqueda.

## Límites

- Sin paginación en `list_clients` (deuda registrada en `docs/pr/fase4-clientes.md`).
- Sin rendimiento medido de la búsqueda LIKE sobre un volumen real de clientes.
- La guarda D9 de recursos con citas futuras sigue siendo solo de front hasta la Fase 5.
