# ADR 0003: Fechas, monedas y tasa de cambio

- **Estado:** Aceptada
- **Fecha:** 2026-11-14
- **Actualizada:** 2026-11-17 (Fase 2, S12): mitigación por retroceso de reloj (D11) implementada
- **Fase:** 1 (slice S0). Mitigación por retroceso de reloj (D11): implementada en Fase 2 (S10). `plan-mvp.md` no le asignaba fase explícita; se implementó junto a `audit_log` (S2)
- **Fuentes:** `docs/planeers/plan-mvp.md` (D5, D6, D11, D19), run `run-mwfno8h1-a6fafa9b`; para Fase 2, `docs/adr/0002-cifrado-y-respaldo.md` (punto 10) y `docs/adr/0004-sesion-y-auditoria.md`

## Contexto

- El spa cobra en USD y en VES (bolívares). La tasa Bs/USD cambia y se ingresa a mano cada día.
- La operación es local: no hay zona horaria de servidor ni sincronización.
- El reloj del equipo define las marcas de auditoría.

## Decisión

1. **Monedas (D6).** Dos monedas: `USD` (base del catálogo) y `VES`.
   - Un pago se captura en la moneda en que se recibió.
   - Pago en USD: no usa tasa.
   - Pago en VES: guarda el monto en bolívares y la tasa usada. Por defecto es la del día; se puede editar en el pago.
   - Sin tasa disponible, un pago en VES no se guarda.
   - Equivalente USD = monto VES / tasa, redondeado half-up a centavos. Se calcula al guardar y se almacena.
2. **Tasa escalada a entero (D19).** `rateBsPerUsdE4` es el entero de la tasa Bs/USD multiplicado por 10^4.
   - Aritmética entera con redondeo half-up. No se usan floats.
3. **Tasas.** Una tasa por fecha. Corregirla es un `update` auditado con diff. Los pagos ya guardados conservan la tasa que usaron (D5).
4. **Fechas (D11).** Hora local sin zona, en texto `YYYY-MM-DDTHH:MM`. La auditoría guarda también segundos.
   - Sin conversión entre zonas. Referencia operativa: `America/Caracas` (UTC-4, sin horario de verano). La app usa el reloj del equipo.
   - Riesgo aceptado: si se cambia el reloj o la zona, cambian las marcas.
   - Mitigación (implementada en Fase 2, S10): `detect_clock_rollback` (`features/audit/clock.rs`) compara la marca de mayor `audit_log.occurred_at_utc` (desempate por `id`) con el instante UTC actual. Si esa marca supera al instante actual en más de `CLOCK_ROLLBACK_TOLERANCE_SECS` = 300 s, devuelve `ClockRollback { lastRecordedAt, detectedAt }` con horas locales para mostrar. La comparación convierte ambos textos a entero con `CAST(strftime('%s', …) AS INTEGER)`. Desde la conversión a UTC no se compara hora local (ADR 0005).
   - Al arrancar, `setup::bootstrap` ejecuta `record_clock_rollback` después de migrar. Si la condición se cumple, registra un evento `clock_rollback` (entidad `system`, sin actor). Mientras la condición persista, se registra un evento por arranque.
   - El resultado se guarda en `ClockRollbackNotice` (estado de Tauri), se expone en `setup_status` como `clockRollback` y el login lo muestra en `clock-rollback-banner.tsx`.
   - Marca de auditoría: `audit_log.occurred_at` (no `at`) tiene DEFAULT `strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')`, con segundos, solo para mostrar. Para comparar, `audit_log.occurred_at_utc` tiene DEFAULT `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` (`db/migrations/0003_audit_log.sql`; ADR 0005).

## Consecuencias

- **Precisión monetaria exacta.** Montos en enteros (centavos) y tasa en enteros escalados; no hay errores de punto flotante.
- **Pagos históricos estables.** Corregir una tasa no altera el equivalente USD de pagos ya guardados.
- **Pagos en VES dependen de la carga diaria de la tasa.** Sin tasa del día, no se puede registrar el pago; la UI debe avisar.
- **Orden cronológico por texto.** Con formato `YYYY-MM-DDTHH:MM` la comparación lexicográfica coincide con la cronológica dentro de la misma zona local.
- **Marcas no confiables ante cambios de reloj o zona.** Aceptado por D11. La mitigación (advertencia de retroceso, decisión 4) está implementada en Fase 2 y solo detecta retrocesos mayores de 300 s; no impide que el reloj se cambie ni detecta cambios menores o de zona.
- **`users.created_at` y `users.updated_at` en minutos.** Decisión tomada: `0001_auth.sql:23-24` usa `strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')`, igual que D11. Los segundos quedan reservados a la auditoría. Como Fase 1 no está liberada, se editó `0001` directamente sin crear una migración nueva. Lo verifica `users_defaults_are_active_with_minute_precision_timestamps` en `db/migrations_test.rs`.
