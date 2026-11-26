# ADR 0010: Pagos e historial de cliente en Rust, tasa copiada, anulación y corte del seed

- **Estado:** Aceptada
- **Fecha:** 2026-11-25
- **Fase:** 6
- **Fuentes:** `docs/adr/0003-fechas-y-moneda.md` (pago en VES, tasa del día, half-up), `docs/adr/0007-catalogo-y-auditoria-de-negocio.md` (puntos 4 y 5: tasa copiada y seed del mock en el bundle), `docs/adr/0008-clientes.md`, `docs/adr/0009-citas.md` (secciones 12 y 15: acoplamientos transitorios y decisión P1), `docs/planeers/plan-mvp.md`, `docs/pr/fase6-pagos.md`, `src/lib/usd-equivalent-vectors.json`

## Contexto

- Los pagos, el historial de cliente y las métricas seguían en el mock del front. Las citas ya estaban en Rust desde la Fase 5.
- ADR 0007, punto 4: un pago debe conservar la tasa vigente al registrarlo. `upsert_rate` actualiza la fila de `exchange_rates`, así que una referencia por id no es válida.
- ADR 0007, punto 5 y ADR 0009, decisión P1: el seed del mock seguía dentro del bundle de producción hasta esta fase. No se debían distribuir builds antes de la Fase 6.
- ADR 0009, sección 12: `payments`, `client-history` y `metrics` dependían del espejo de citas.

## Decisión

### 1. Migración 0012 (`src-tauri/src/db/migrations/0012_appointment_payments.sql`)

- Tabla `appointment_payments`: `appointment_id` con FK a `appointments`, `method_id` con FK a `payment_methods`, `currency` en `USD | VES`, `amount_cents` entre 1 y 10^11.
- `rate_bs_per_usd_e4` es un valor **copiado** en el momento del pago. No tiene FK a `exchange_rates`. Con esto se cumple la deuda del ADR 0007, punto 4.
- `usd_equivalent_cents` entre 1 y 2^53 − 1.
- `paid_at` y `voided_at` en formato local `YYYY-MM-DDTHH:MM` (`strftime`, igual que las citas). `voided_at >= paid_at`.
- `voided_by` con FK a `users`. `void_reason` de 1 a 200 caracteres (CHECK de longitud).
- CHECK por moneda:
  - `USD`: `rate_bs_per_usd_e4 IS NULL` y `usd_equivalent_cents = amount_cents`.
  - `VES`: `rate_bs_per_usd_e4 IS NOT NULL`, `rate` entre 1 y 10^11, y `usd_equivalent_cents = (amount_cents * 20000 + rate) / (2 * rate)`.
  - Nota: en SQLite, un CHECK cuya expresión evalúa a NULL no rechaza la fila. Por eso el caso `VES` lleva `rate_bs_per_usd_e4 IS NOT NULL` de forma explícita.
- CHECK de anulación: `voided_at`, `voided_by` y `void_reason` son todos nulos o todos presentes.
- Índices por `appointment_id` y por `paid_at`.
- Triggers de inmutabilidad:
  - `BEFORE DELETE`: aborta siempre (`payments cannot be deleted`).
  - `BEFORE UPDATE`: aborta si el pago ya está anulado (`OLD.voided_at IS NOT NULL`) o si cambia `id`, `created_at`, `created_by`, `appointment_id`, `method_id`, `currency`, `amount_cents`, `rate_bs_per_usd_e4`, `usd_equivalent_cents` o `paid_at`.
  - La anulación sí actualiza `voided_*` y `updated_*`, y solo por `mark_voided`.
- Pruebas: rechazos de cada CHECK, DELETE y re-anulación rechazados, FK inválida y migración desde `user_version` 11 sin perder filas (`src-tauri/src/db/migrations_payments_test.rs`).

### 2. Fórmula del equivalente (half-up entero)

- Fórmula: `usd_equivalent_cents = half_up(amount_cents * 10000 / rate_e4)`, calculada en entero como `(2 * amount * 10000 + rate) / (2 * rate)`.
- Idéntica en tres sitios:
  - SQL: `(amount * 20000 + rate) / (2 * rate)`.
  - Rust (`src-tauri/src/features/payments/rules.rs`): aritmética en `i128`. Devuelve error si el monto o la tasa están fuera de rango y si el resultado supera 2^53 − 1.
  - TypeScript (`src/lib/money.ts`): `BigInt`.
- Vectores compartidos: `src/lib/usd-equivalent-vectors.json` (20 casos). Los leen `src/lib/money-vectors.test.ts`, `src/test/ipc/payments-backend.test.ts` y `src-tauri/src/features/payments/rules_test.rs` (`include_str!`).
- Un equivalente menor que 1 se rechaza (`validation` sobre `amountCents`).

### 3. Topes de monto y tasa

- **Tope de monto: 10^11 céntimos** (`MAX_AMOUNT_CENTS`). El plan inicial decía 10^13; se bajó a 10^11.
  - Razón: el peor caso del equivalente es el monto máximo con la tasa mínima, `10^11 * 10^4 / 1 = 10^15`, que cabe en un entero seguro de JavaScript (2^53 − 1 ≈ 9·10^15). Con 10^13, el peor caso sería 10^17 y no sería representable como `Number` en el front.
  - Coincide con el tope de precio de `services` (ADR 0007).
- Tasa entre 1 y 10^11 (`MAX_RATE_E4`), igual que `exchange_rates`.

### 4. Tiempo

- `paid_at` es el "ahora" local validado (`require_valid_local_minute`). No es editable. Decisión del usuario.
- La tasa del día se toma de los 10 primeros caracteres del "ahora" local validado (`YYYY-MM-DD`). Si el reloj no es válido, la operación se rechaza (fail-closed), con el mismo criterio que `local_minute_now`.

### 5. Alta de pago (`create_payment_at`)

Orden de validación dentro de la transacción:

1. Permiso `payments.write`, antes y dentro de la transacción.
2. Formato: ids positivos, monto entre 1 y 10^11, tasa entre 1 y 10^11 si se envía. La tasa se valida también en USD y se rechaza si es inválida.
3. La cita existe, **en cualquier estado** (D5). Pagar una cita cancelada o `no_show` está permitido. Si no existe, `notFound` sobre `appointmentId`.
4. El método existe (si no, `notFound` sobre `methodId`) y está activo (si no, `validation` sobre `methodId`).
5. Tasa:
   - USD: ignora una tasa enviada válida. Guarda `rate = NULL`.
   - VES: usa la tasa enviada, o la del día. Si no hay ninguna, `rateMissing` sobre `rateBsPerUsdE4`.
6. Equivalente con la fórmula de la sección 2.
7. Inserción y auditoría `create` con snapshot, en la misma transacción.

Corregir la tasa después no altera el pago guardado: la tasa copiada es la vigente al registrar.

### 6. Anulación (`void_payment_at`)

- Escritura con `payments.write`: Propietaria y Recepción (decisión del usuario). Lectura con `payments.read` o `payments.write` (`READ_PERMISSIONS`).
- Motivo: se recorta (`trim`), debe tener entre 1 y 200 caracteres y no puede contener caracteres de control ni de formato (`is_allowed_text_character`). El CHECK de SQL solo valida la longitud; la validación de caracteres vive **solo en Rust**.
- Pago ya anulado: `alreadyVoided` con `entityIds = [id]`. La primera anulación se conserva.
- Se guardan `voided_by` (actor) y `voided_at` (ahora local). Auditoría `void` con diff de `voidedAt`, `voidedBy` y `voidReason`. El diff no incluye importes.
- El motivo es el único texto libre que llega a la auditoría de pagos, acotado a 200 caracteres. El snapshot de `create` no contiene texto libre.
- Si falla la auditoría, la anulación se revierte (test `a_failing_audit_rolls_the_void_back`).
- Los pagos anulados quedan fuera de todas las sumas del historial.

### 7. Historial de cliente en Rust (`get_client_history`)

- Módulo `src-tauri/src/features/client_history/`. Sustituye al cálculo del front (`compute.ts`, eliminado).
- Permisos: `clients.read`, `appointments.read` y `payments.read`. Se exigen los tres (`require_permission` por cada uno).
- Respuesta:
  - `client`: incluye clientes con borrado lógico.
  - `entries`: cada cita con `serviceName`, `resourceName` (incluidos inactivos) y sus pagos ordenados por `paid_at, id`. Los pagos anulados aparecen en la línea de tiempo con su marca de anulación.
  - `totalMinutes`: suma de `duration_min_snapshot` solo de citas `completed`.
  - `paidByCurrency`: pagos no anulados de citas `completed`, por moneda.
  - `collectedOnNonCompletedByCurrency`: pagos no anulados de citas `cancelled` y `no_show`.
  - `pendingByCurrency`: pagos no anulados de citas `scheduled` e `in_progress`.
  - `vesUsdEquivalentOfCompleted`: equivalente en USD de los pagos VES de citas `completed`. Es informativo.
- Las sumas se calculan en SQL (`COALESCE(SUM(...))`).
- Si alguna suma supera 2^53 − 1, el servicio devuelve `TotalExceedsSafeRange`. Se traduce a un error `internal` controlado y se registra en el log.
- Un cliente inexistente devuelve `notFound`. Un cliente sin citas devuelve totales en cero.

### 8. Comandos IPC y errores

- 5 comandos nuevos, de 42 a 47 en total:
  - `list_payments(appointmentId)`
  - `list_all_payments()`
  - `create_payment`
  - `void_payment`
  - `get_client_history(clientId)`
- Registro en `src-tauri/src/lib.rs`, `src-tauri/build.rs`, `src-tauri/capabilities/default.json` y `src-tauri/permissions/autogenerated/`. `src/lib/bindings.ts` regenerado.
- Códigos de error nuevos: `rateMissing` y `alreadyVoided`. Un pago inexistente usa `notFound` con el mensaje "El pago no existe".

### 9. Espejo y front

- `src/features/payments/api.ts`:
  - `syncPaymentsMirror()` llama a `listAllPayments` con `createMirrorSync().listUntilApplied`. Hace hasta 3 intentos. Si todos quedan obsoletos, devuelve error (`internal`) y **no** devuelve `ok`.
  - `createPayment` y `voidPayment` pasan por Rust con `reflectMutation`.
  - Se eliminan `conversionOf`, `dayRateOf` y la sincronización de citas. Pagos ya no depende de citas.
- `src/features/client-history/api.ts` delega en `get_client_history`. El componente `history-summary` se adapta al DTO y muestra "Cobrado en citas no completadas" por moneda.
- `src/features/metrics/api.ts` sincroniza el espejo de citas **y** el de pagos antes de calcular. Métricas sigue calculando en el front hasta la Fase 7.
- Backends simulados: `src/test/ipc/payments-backend.ts` y `src/test/ipc/client-history-backend.ts`, registrados en `dev-backends.ts`. `payments-backend-parity.test.ts` ejecuta los casos de paridad con Rust. El simulado **no** valida `require_valid_local_minute`; su reloj es `now()` inyectado.
- Accesibilidad: `FormMessage` (`src/components/ui/form.tsx`) añade `aria-live="polite"`.

### 10. Corte del seed del bundle de producción (cierra ADR 0007, punto 5, y ADR 0009, P1)

Mecanismo:

- `src/lib/mock/store.ts`: el estado arranca en `EMPTY_STATE`. `setStoreSeeder` guarda el seeder (por defecto, vacío). `resetStore` usa ese seeder. El store ya no importa `./seed` en tiempo de ejecución; solo un `import type`, que se borra al compilar.
- Desarrollo: `src/test/ipc/dev-browser-ipc.ts` siembra (`commit(createSeed(todayLocal()))`) solo si el estado sigue vacío. Se carga desde `src/app/providers.tsx` con un import dinámico que solo se ejecuta si `process.env.NODE_ENV === 'development'`.
- Tests: `vitest.setup.ts` llama a `setStoreSeeder(createSeed)`, `resetStore()` y `installDevIpc(createSeed(...))` antes de cada prueba. El seed sigue disponible en tests.
- E2E: `e2e/support/tauri-ipc.ts` entrega `createSeed` al IPC simulado desde el código de prueba. El seed no sale del bundle. `playwright.config.ts` construye con `bun run build` y sirve `out`.
- Centinelas en `scripts/check-bundle.ts`:
  - `SEED_SENTINEL_MARKERS`: `Manicure (Rosa)`, `(ejemplo)`, `Cabina 1`, `createSeed`, `V-26789012`, `Cita seed inexistente`, `0414-1234567`, `E-81234567`, `V-14567890`.
  - `SEED_SENTINELS_BLOCK_BUNDLE = true`. El job `web` de `.github/workflows/ci.yml` ejecuta `bun run check:bundle`, y ese paso ahora falla si aparece un centinela.
  - Los centinelas son cadenas literales que sobreviven a la minificación. Los valores numéricos del seed no se usan: el minificador reescribe los números (por ejemplo, `100000000000` pasa a `1e11`) y coinciden con constantes ajenas al seed, así que dan falsos positivos o pasan desapercibidos.
  - `V-12345678` quedó descartado porque aparece en un mensaje de error de producción.
- Guardas:
  - `src/test/seed-import-guard.ts` y `src/test/seed-import-graph.test.ts`: ningún archivo de producción importa el seed por ninguna ruta.
  - `src/features/empty-store.test.ts` y `src/app/empty-store-screens.test.tsx`: smoke de pantallas con store vacío.

### 11. Seed de pagos en Rust (solo depuración)

- `src-tauri/src/dev_seed_payments.rs`: `#[cfg(debug_assertions)]`, activado desde `seed_for_development` en `setup.rs`, con `SPA_DEV_SEED_PASSWORD`. Solo siembra si la tabla está vacía y después del seed de citas.
- Replica `buildPayments` de `src/lib/mock/seed.ts` sobre las citas 1 a 16. Usa `create_payment_at` y `void_payment_at` (no SQL directo). Incluye el pago anulado, con auditoría `void`.
- `src-tauri/src/dev_seed_payments_test.rs` lo compara con `EXPECTED_DEV_PAYMENTS` (`src/test/ipc/dev-seed-expectations.ts`).

### 12. Acoplamientos

- **Cerrados:** `payments` ya no depende del espejo de citas. `client-history` ya no depende del espejo de citas, ni del cálculo en el front.
- **Cerrado en Fase 7 (ADR 0011):** `metrics` ya no lee los espejos de citas ni de pagos.

## Consecuencias

- Los importes, la fórmula half-up y la tasa copiada tienen una única definición con vectores compartidos. Un cambio en una implementación exige cambiar las otras y sus vectores.
- La inmutabilidad de pagos es una garantía de base de datos (triggers). La anulación es la única forma de "corregir" un pago.
- La validación de caracteres del motivo no está en la base de datos. Cualquier escritura nueva a `void_reason` debe pasar por `valid_void_reason`.
- En producción, las pantallas dependen de los espejos sincronizados desde Rust. Un consumidor que lea `getState()` sin sincronizar mostraría un estado vacío.
- El seed de depuración de pagos depende del seed de citas y de la tabla vacía.

## Límites

- `list_all_payments` no pagina: el espejo completo viaja en cada sincronización. Cerrado en Fase 7 (ADR 0011): el comando se eliminó.
- Métricas sobre espejos (citas y pagos): cerrado en Fase 7 (ADR 0011).
- El simulado de pagos no valida el minuto local. La validación de reloj solo se prueba en Rust.
- `cargo test --release --no-run` no compila. Es deuda preexistente, por `insert_user` y `NewUser` en `features/auth` (36 errores, verificados en esta fase).
- El nombre del test `the_cap_is_one_hundred_million_dollars_in_cents` (`src-tauri/src/features/payments/rules_test.rs`) no coincide con su valor: 10^11 céntimos son 1.000 millones de unidades de moneda, no 100 millones.
