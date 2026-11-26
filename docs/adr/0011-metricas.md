# ADR 0011: Métricas mensuales en Rust, definiciones D16 y poda de espejos

- **Estado:** Aceptada
- **Fecha:** 2026-11-25
- **Fase:** 7
- **Fuentes:** `docs/planeers/plan-mvp.md` (D16 y Fase 7), `docs/qa/demo-fase0.md` (punto c: métricas pendientes de confirmar), `docs/adr/0003-fechas-y-moneda.md` (moneda sin conversión), `docs/adr/0005-tiempo-utc-y-hora-local.md` (hora local en texto), `docs/adr/0009-citas.md` (sección 9, `list_all_appointments`), `docs/adr/0010-pagos-e-historial.md` (sección 12 y límites), `docs/pr/fase6-pagos.md`.

## Contexto

- Las métricas seguían en el front. `src/features/metrics/compute.ts` calculaba sobre los espejos de citas y de pagos, que `list_all_appointments` y `list_all_payments` llenaban en cada sincronización.
- ADR 0010, sección 12: `metrics` era el último acoplamiento abierto con los espejos de citas y de pagos.
- D16 del plan define las métricas. La lista final sigue pendiente de confirmación por la empleada y la dueña (`docs/qa/demo-fase0.md`, punto c).
- Solo la Propietaria tiene `metrics.read`. Recepción y Solo lectura no ven Métricas (`docs/qa/demo-fase0.md`, punto d).

## Decisión

### 1. Comando y permiso

- `get_monthly_metrics(month: String) -> MonthlyMetrics`, en el slice `src-tauri/src/features/metrics/` (modelo, reglas, repositorio, servicio, comandos).
- Permiso `metrics.read`. Se valida fuera de la transacción (`with_conn_mapped`) y otra vez dentro de `with_tx`. El permiso se decide antes de validar el mes.

### 2. Formato del mes

- `YYYY-MM`: año de 4 dígitos ASCII entre 0001 y 9998, mes de 2 dígitos entre 01 y 12. Solo dígitos ASCII; cualquier otra forma se rechaza con `validation` sobre el campo `month`.
- `0000` queda fuera porque el rango de la app empieza en 0001 (`FIRST_YEAR` en `rules.rs`). El ADR no lo justifica por comparación de texto.
- `9999` queda fuera porque el fin de `9999-12` sería `10000-01-01T00:00`. Ese valor tiene cinco dígitos de año y compara mal como texto con los `starts_at` de cuatro dígitos. `9998-12` es el último mes admitido; su fin es `9999-01-01T00:00`.

### 3. Rango y índices

- Rango semiabierto `[inicio, inicio del mes siguiente)` sobre `starts_at`, en formato local `YYYY-MM-DDTHH:MM`. Un último minuto `23:59` entra; el `00:00` del día 1 del mes siguiente no. Diciembre cierra con enero del año siguiente.
- Índices existentes `appointments_starts_at` y `appointments_client_starts_at` (migración 0011). Fase 7 no añade migración.
- Los tests `EXPLAIN QUERY PLAN` comprueban que las tres consultas filtran por `starts_at` sin `SCAN a`, y que la consulta de recurrencia usa `appointments_client_starts_at`.

### 4. Foto consistente

- `Database` guarda una sola conexión tras un `Mutex`. `with_tx` abre la transacción en modo `Immediate`. Las tres consultas (conteos, clientes, montos) leen el mismo estado y no hay escrituras intermedias.

### 5. Clientes nuevos y recurrentes (D16)

- Cliente activo del mes: tiene al menos una cita `completed` con `starts_at` dentro del rango.
- Recurrente: además tiene otra cita `completed` con `starts_at` anterior al inicio del mes.
- Nuevo: el resto de activos. Equivale a decir que su primera cita completada cae en el mes.
- Solo `completed` cuenta como visita previa. Una cita `cancelled`, `no_show`, `scheduled` o `in_progress` anterior no convierte al cliente en recurrente. Un cliente con una cancelada anterior y su primera completada en el mes es nuevo.
- Un cliente con varias citas completadas en el mes cuenta una sola vez (`GROUP BY client_id`).
- Los clientes con borrado lógico cuentan. Las consultas no hacen `JOIN` con `clients`.

### 6. Citas por estado

- `COUNT(*)` agrupado por `status` dentro del rango. Se cuentan `scheduled`, `inProgress`, `completed`, `cancelled` y `noShow` por separado.
- Un estado desconocido no se descarta: produce `UnknownStatus`, que se traduce a error interno controlado.

### 7. Montos por moneda

Sin conversión. USD y VES se suman por separado. Los pagos anulados (`voided_at IS NOT NULL`) no entran en ningún bucket.

- `revenueByCurrency`: pagos de citas `completed`. Es el ingreso del mes.
- `collectedOnNonCompletedByCurrency`: pagos de citas `cancelled` y `no_show`. No es ingreso.
- `pendingByCurrency`: pagos de citas `scheduled` e `in_progress`. Se muestra como "Cobrado por adelantado (citas pendientes)".

El bucket depende del estado actual de la cita. Una seña en una cita programada queda en pendiente; cuando la cita se completa, el mismo pago pasa a ingreso.

### 8. Atribución de pagos al mes de la cita

- Un pago cuenta en el mes de `starts_at` de su cita, no en el mes de `paid_at`. Es coherente con D16, que cuenta las citas por mes.
- Ejemplo: una seña de USD 5,00 cobrada el 2026-10-28 para una cita del 2026-11-03 cuenta en noviembre (en pendiente, cobros no completados o ingreso según el estado de la cita) y no en octubre.
- Un cobro de noviembre de una cita de octubre no suma en noviembre.

### 9. Topes y errores

- Cada suma de bucket y moneda debe estar entre 0 y `MAX_JS_SAFE_INTEGER` (2^53 − 1). Si no, se devuelve `TotalExceedsSafeRange`, que se traduce a `internal` con registro en el log.
- Un `integer overflow` de SQLite durante la suma se traduce al mismo error controlado. Otros fallos de base de datos siguen siendo `DbError` sin datos sensibles.
- `AmountsByCurrency` pasa de `client_history::model` a `payments::model`, que ahora lo usan `payments`, `client_history` y `metrics`. `require_safe_totals` se duplica en `metrics` (decisión VSA: no se extrae un módulo compartido todavía).

### 10. Front

- `src/features/metrics/api.ts`: `settle(() => commands.getMonthlyMetrics(month))`. Sin autorización local, sin `getState` y sin espejos.
- Eliminados `src/features/metrics/compute.ts` y `src/features/metrics/schemas.ts`. El mes lo acota el selector y lo valida Rust.
- `month-picker`: cotas `0001-01` a `9998-12` (`min` y `max`). Los botones de navegación se deshabilitan en los extremos.
- `revenue-by-currency.tsx` muestra el tercer bloque "Cobrado por adelantado (citas pendientes)".

### 11. Poda

- Comandos eliminados: `list_all_appointments` y `list_all_payments`, con sus entradas en `lib.rs`, `build.rs`, `capabilities/default.json`, `permissions/autogenerated/` y `src/lib/bindings.ts`. Total: **46 comandos** (47 de la Fase 6, más `get_monthly_metrics`, menos los dos eliminados).
- Eliminados en el front: `syncAppointmentsMirror`, `syncPaymentsMirror`, `listUntilApplied` y sus constantes de reintento en `mirror-sync.ts`, y las funciones `replace*`/`mirror*` de citas y pagos. `createMirrorSync` se conserva para clientes, catálogo, tasas, recursos y métodos de pago.
- `StoreState` (`src/lib/mock/store.ts`) ya no tiene `appointments` ni `payments`.
- `createSeed` devuelve `SeedData` (store más citas y pagos). `stateOf` extrae el store. El backend simulado de desarrollo recibe citas y pagos por parámetro, no desde el store.
- `DEV_BROWSER_BACKEND_CACHE`: el backend simulado de `next dev` (`NODE_ENV === 'development'`) se guarda en `window` para reutilizarlo al reinstalar. Vive solo en memoria de la pestaña.
- Sin seed de depuración para métricas: no existe `dev_seed_metrics`. Las métricas se derivan de las citas y los pagos ya sembrados (`dev_seed_appointments`, `dev_seed_payments`).

### 12. Lo que no se hace (YAGNI)

- No se añaden: rango libre de fechas, comparativa entre meses, ingreso convertido a USD, desgloses por servicio, recurso o método de pago, rankings de clientes, gráficos, exportación, caché ni tabla materializada.
- "Lista ampliable" significa que el DTO admite campos nuevos cuando la empleada y la dueña cierren su lista (`docs/qa/demo-fase0.md`, punto c). Hasta entonces no se añade ningún campo.

## Consecuencias

- Las definiciones de D16 viven en un único lugar (`src-tauri/src/features/metrics/repository.rs`). El front solo presenta.
- Cambiar la fecha de una cita mueve sus pagos entre meses, porque la atribución sigue a la cita.
- Se cierra el acoplamiento de `metrics` del ADR 0010, sección 12. Ningún consumidor del front lee `appointments` ni `payments` del store.
- No hay caché: cada lectura recalcula las tres consultas del mes pedido.

## Límites

- El coste de las tres consultas por llamada está acotado por índices. No se midió con un volumen real de datos.
- La atribución por mes de cita es una decisión, no un defecto: un pago cobrado en un mes posterior a la cita no aparece en el mes del cobro.
- El simulado de desarrollo no vuelve a comprobar el permiso dentro de la transacción y rechaza un mes que no es texto con un `Error` de JavaScript, no con `AppError`. Son diferencias aceptadas del simulado frente a Rust.
- La lista de métricas es la de D16. La confirmación de la empleada y la dueña sigue pendiente (`docs/qa/demo-fase0.md`, punto c).
