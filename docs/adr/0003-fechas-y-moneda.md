# ADR 0003: Fechas, monedas y tasa de cambio

- **Estado:** Aceptada
- **Fecha:** 2026-11-14
- **Fase:** 1 (slice S0). Diferido: mitigación por retroceso de reloj (D11), Fase 2 (inferida: depende de `audit_log`, Fase 2; `plan-mvp.md` no le asigna fase explícita)
- **Fuentes:** `docs/planeers/plan-mvp.md` (D5, D6, D11, D19), run `run-mwfno8h1-a6fafa9b`

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
   - Mitigación (diferida, no implementada en Fase 1): al arrancar, si la hora del sistema es anterior en más de 5 minutos a la última marca de auditoría, la app muestra una advertencia y registra un evento de seguridad (retroceso de reloj).

## Consecuencias

- **Precisión monetaria exacta.** Montos en enteros (centavos) y tasa en enteros escalados; no hay errores de punto flotante.
- **Pagos históricos estables.** Corregir una tasa no altera el equivalente USD de pagos ya guardados.
- **Pagos en VES dependen de la carga diaria de la tasa.** Sin tasa del día, no se puede registrar el pago; la UI debe avisar.
- **Orden cronológico por texto.** Con formato `YYYY-MM-DDTHH:MM` la comparación lexicográfica coincide con la cronológica dentro de la misma zona local.
- **Marcas no confiables ante cambios de reloj o zona.** Aceptado por D11; la única mitigación (advertencia de retroceso, decisión 4) está diferida.
- **`users.created_at` y `users.updated_at` en minutos.** Decisión tomada: `0001_auth.sql:23-24` usa `strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')`, igual que D11. Los segundos quedan reservados a la auditoría. Como Fase 1 no está liberada, se editó `0001` directamente sin crear una migración nueva. Lo verifica `users_defaults_are_active_with_minute_precision_timestamps` en `db/migrations_test.rs`.
