# ADR 0007: Catálogo, recursos, métodos de pago y tasas; auditoría de negocio

- **Estado:** Aceptada
- **Fecha:** 2026-11-24
- **Fase:** 3
- **Fuentes:** `docs/adr/0004-sesion-y-auditoria.md` (catálogo de eventos, decisión 6), `docs/adr/0003-fechas-y-moneda.md` (moneda y tasa), `docs/adr/0006-users-manage-control-total.md`, `docs/planeers/plan-mvp.md` (D9, D15, Fases 3 a 6), `docs/pr/fase3-catalogo.md`

## Contexto

- La Fase 2 dejó `audit_log` con 16 acciones y 3 entidades (`user`, `role`, `system`), en `db/migrations/0003_audit_log.sql`. Ese archivo no cambia en la Fase 3.
- D15 (plan-mvp) exige auditar creación, edición, desactivación y reactivación de clientes, servicios, recursos, citas, pagos, métodos de pago, tasas, usuarios, roles y permisos.
- El front de Fase 0 y el mock en memoria (`src/lib/mock/`) siguen siendo la fuente de datos de clientes, citas, pagos, historial y métricas hasta las Fases 4 a 7.
- Las Fases 3 a 6 necesitan un catálogo, recursos, métodos de pago y tasas consultables desde Rust antes de que existan citas o pagos reales.

## Decisión

### 1. Auditoría de negocio (migración 0005)

- `db/migrations/0005_audit_business.sql` reconstruye `audit_log` completo: copia las filas de la tabla anterior, conserva índice y triggers `audit_log_no_update` y `audit_log_no_delete`.
- Acciones: de 16 a 24 (`AuditAction`). Se añaden `create`, `update`, `deactivate`, `soft_delete`, `reactivate`, `void`, `backup_created` y `backup_restored`.
- Entidades: de 3 a 10 (`AuditEntity`): `user`, `role`, `system`, `client`, `service`, `resource`, `appointment`, `payment`, `payment_method`, `exchange_rate`.
- La acción genérica no depende de la entidad: `create`, `update`, `deactivate` y `reactivate` sirven a servicios, recursos, métodos de pago y tasas. La entidad distingue el objeto afectado.
- Servicios, recursos, métodos de pago y tasas escriben la auditoría dentro de la transacción de la acción (`db.with_tx`, `record_change` de `named_records`); servicios, recursos y métodos de pago comparten además la validación de nombre de `named_records`.

### 2. Recursos, métodos de pago y tasas (migraciones 0006 a 0009)

- `0006_services.sql`: `services`, con precio en centavos USD (1 a 100 000 000 000), duración en minutos (múltiplo de 5, máximo 1440) y clave normalizada única `name_key`.
- `0007_resources.sql`: `resources`, tipo `cabin` o `manicure`, con seed de dos cabinas y un puesto de manicure inactivo.
- `0008_payment_methods.sql`: `payment_methods`, con cinco métodos de seed.
- `0009_exchange_rates.sql`: `exchange_rates`, una fila por fecha (`UNIQUE`), tasa en entero escalado `rate_bs_per_usd_e4` (1 a 100 000 000 000).
- Los recursos y los métodos de pago se desactivan; no se borran (D9, D15).
- La tabla de tasas acepta fechas con formato `YYYY-MM-DD` válidas y año entre 2000 y 2099 (CHECK en SQL y `FIRST_RATE_YEAR`/`LAST_RATE_YEAR` en `features/rates/model.rs`).
- IPC: 31 comandos en `src-tauri/src/lib.rs` y `src/lib/bindings.ts` (16 de Fase 2 más 15 nuevos: 4 de servicios, 4 de recursos, 4 de métodos de pago y 3 de tasas: `list_rates`, `get_rate`, `upsert_rate`). El bloque `export_bindings` de Fase 2 verifica la deriva.

### 3. Guarda D9 transitoria en el front

- `src/features/resources/api.ts`, `setResourceActive`: desactivar un recurso con citas futuras programadas se bloquea en el front (`resourceHasFutureAppointments`, con los ids de las citas). La comprobación lee el espejo del mock.
- Es transitoria: la guarda real en Rust llega en la Fase 5 (citas), cuando existan las citas en la BD. Mientras tanto, Rust no impide la desactivación.

### 4. Tasas copiadas, no referenciadas (para Fase 6)

- `payments` (Fase 6) debe copiar el valor de la tasa en el momento del pago, no guardar una referencia a `exchange_rates.id`. Motivo: una tasa puede corregirse después (`upsert_rate` actualiza la fila) y el pago debe conservar la tasa vigente al registrarlo (plan, Fase 6: pagos USD/VES con tasa congelada).

### 5. Seed del mock en el bundle de producción (decisión del usuario, 2026-11-24)

- El usuario decidió dejar el seed del mock dentro del bundle de producción hasta las Fases 4 a 6. Clientes, citas, pagos, historial y métricas siguen siendo mock puro, y no pueden arrancar sin datos de ejemplo.
- `src/lib/mock/store.ts` inicializa el estado con `createSeed` en la carga del módulo.
- `scripts/check-bundle.ts` mantiene `SEED_SENTINEL_MARKERS` (`Manicure (Rosa)`, `(ejemplo)`, `Cabina 1`, `createSeed`) y `SEED_SENTINELS_BLOCK_BUNDLE = false`: `bun run check:bundle` informa los centinelas como aviso y sale con código 0.
- En la Fase 6: `SEED_SENTINELS_BLOCK_BUNDLE` pasa a `true` y el seed se corta del bundle de producción (import dinámico o inyección, con condición `process.env.NODE_ENV !== 'production'`; en vitest `NODE_ENV` es `test`, así que los tests siguen usando el seed).

### 6. Espejos del store mock

- `src/lib/mirror-sync.ts` (`createMirrorSync`) mantiene el espejo de cada colección:
  - `list*` pide siempre la colección completa a Rust (`includeInactive: true`) y reemplaza la colección entera; el filtro por activos se aplica después (`visibleRows`).
  - Un contador por entidad descarta respuestas obsoletas: una lista iniciada antes de una mutación, o antes de otra lista más reciente, no se aplica.
  - `reflectMutation` marca la mutación con el contador y refleja el resultado de Rust en el espejo.
- `getRate` es lectura: consulta una fecha sin listar la colección; su resultado se refleja con `mirrorOptionalRate` (`src/features/rates/api.ts`).
- `createAppointment` (`src/features/appointments/api.ts`) y `createPayment` (`src/features/payments/api.ts`) refrescan el espejo de catálogo, recursos, métodos de pago y tasas desde Rust antes de validar, para no validar contra datos obsoletos.
- Acoplamientos transitorios: `appointments` depende de `catalog` y `resources`; `payments` depende de `payment-methods` y `rates`. Se retiran con el seed en la Fase 6.
- Dependencia de permisos: los `create` de citas y pagos llaman a `list*` de Rust, que exige permiso de lectura. Los roles seed (Propietaria, Recepción, Solo lectura) cumplen esa condición. Un rol sin permiso de lectura en esos módulos fallaría en Rust al refrescar; el comportamiento no se verificó en esta revisión.

### 7. Navegación por permisos

- `NavItem.permissions` (`src/lib/routes.ts`) es una lista de `PermissionKey`. `src/components/sidebar-nav.tsx` muestra el ítem si `useCanAny(item.permissions)` (`src/lib/session.tsx`) devuelve verdadero.
- Es control de interfaz. La frontera de seguridad sigue siendo `require_permission` en Rust.

### 8. Seed de desarrollo en Rust

- `src-tauri/src/dev_seed_catalog.rs` siembra servicios y tasas del día solo en compilación de depuración (`#[cfg(debug_assertions)]` en `setup.rs`) y solo si `SPA_DEV_SEED_PASSWORD` está definida (`dev_seed.rs`, `SEED_PASSWORD_VAR`). En release no hay seed.

## Consecuencias

- `audit_log` solo acepta acciones y entidades del catálogo D15 a partir de 0005; una base en `user_version` 4 o anterior migra sin reescribir la 0003.
- El front de Fase 3 es un espejo de Rust para catálogo, recursos, métodos de pago y tasas; el mock de clientes, citas y pagos queda como antes.
- Hay una duplicación deliberada entre recursos y métodos de pago (ambos usan `named_records` y tienen CRUD casi igual). Se extrae un módulo común cuando exista un tercer CRUD con la misma forma, no antes.
- Las pruebas de Rust en release no compilan: `insert_user` y `NewUser` (`features/auth/repository.rs`) están tras `#[cfg(debug_assertions)]` y los tests de release los importan. Preexistente de Fase 2; ver `docs/pr/fase3-catalogo.md`, deuda conocida.

## Límites

- La guarda D9 real y la citas en Rust llegan en la Fase 5. Hasta entonces, la protección contra desactivar un recurso con citas futuras es solo de front.
- Los centinelas del seed siguen en el bundle de producción hasta la Fase 6, por decisión del usuario.
