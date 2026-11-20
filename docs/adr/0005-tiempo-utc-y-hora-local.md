# ADR 0005: Tiempo: UTC para comparar, local para mostrar

- **Estado:** Aceptada e implementada (implementada en dos pasos durante la Fase 2: conversión a UTC y endurecimiento del formato)
- **Fecha:** 2026-11-17
- **Fase:** 2
- **Fuentes:** `docs/adr/0001-arquitectura.md` (relojes monotónicos), `docs/adr/0003-fechas-y-moneda.md`, `docs/adr/0004-sesion-y-auditoria.md` (Q11, "Límites conocidos")

## Contexto

- Antes de la conversión a UTC, `features/audit/clock.rs` (`detect_clock_rollback`) comparaba `max(occurred_at)` con `strftime('now','localtime')`. `audit_log.occurred_at` se definía con `localtime` (`db/migrations/0003_audit_log.sql`).
- Antes de la conversión a UTC, el bloqueo persistido de login (`login_throttle`) comparaba `locked_until` con la hora local a través de `local_now!` (`features/auth/repository.rs`).
- Motivo (observado en uso): con el cambio de horario (DST) la hora local retrocede una hora aunque el reloj real no retroceda. Resultado: un `clock_rollback` falso y bloqueos de login de 1 h 05 min.

## Decisión

1. Las comparaciones entre instantes (vencimiento del bloqueo persistido y detección de retroceso de reloj) usan UTC. Columnas: `audit_log.occurred_at_utc`, `login_throttle.last_failure_at_utc` y `login_throttle.locked_until_utc`.
2. `audit_log.occurred_at` (hora local) se conserva solo para mostrar y para IPC. No participa en ninguna comparación.
3. La conversión de UTC a hora local ocurre en la capa de presentación, no en SQL de decisión.
4. El reloj monotónico de `Instant` (sesión e inactividad) no cambia: ya es ajeno al cambio de horario (ADR 0001).

## Estado de implementación

Verificado tras la conversión a UTC y endurecido después con el CHECK de formato:

- **Auditoría (`db/migrations/0003_audit_log.sql`):**
  - `occurred_at_utc` TEXT NOT NULL, DEFAULT `strftime('%Y-%m-%dT%H:%M:%fZ','now')`, `CHECK (occurred_at_utc GLOB '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}.[0-9]{3}Z')`: formato ISO 8601 completo con milisegundos y sufijo `Z`. Solo se usa para comparar. (Antes el CHECK era `length = 24`; ahora valida el formato completo.)
  - `occurred_at` sigue siendo TEXT local de 19 caracteres (`CHECK length = 19`) para mostrar.
  - Índice `audit_log_occurred_at_utc` sobre `occurred_at_utc`.
- **Throttle (`db/migrations/0004_login_throttle.sql`):**
  - `last_failure_at_utc` TEXT NOT NULL, `CHECK` con el mismo GLOB de formato completo. Reemplaza a `last_failure_at`.
  - `locked_until_utc` TEXT NULL o con el mismo GLOB de formato completo (`locked_until_utc IS NULL OR ...`). Reemplaza a `locked_until`.
  - `CHECK ((failures = 5) = (locked_until_utc IS NOT NULL))`.
- **Costuras de tiempo (`pub(crate)`, fail-closed):** `detect_clock_rollback_at`, `record_clock_rollback_at`, `find_credentials_by_username_at`, `find_credentials_by_id_at` y `record_persisted_failure_at` son `pub(crate)` y reciben `now` como parámetro SQL (`'now'` por defecto en la API pública). Antes de consultar, llaman a `require_valid_instant` (`db/mod.rs`), que valida el instante con `strftime('%Y-%m-%dT%H:%M:%fZ', ?)`. Si el resultado es NULL, devuelven `DbError::InvalidInstant` y no deciden nada.
- **Detección de retroceso (`features/audit/clock.rs`):** decide la fila con mayor `occurred_at_utc` (desempate por `id` descendente). Hay retroceso si `epoch(occurred_at_utc) - epoch(now) > 300` (`CLOCK_ROLLBACK_TOLERANCE_SECS`), con `strftime('%s', …)` en segundos enteros.
  - `ClockRollback` (IPC) no cambia: sigue exponiendo `{lastRecordedAt, detectedAt}` en hora local para la UI.
  - El `diff` JSON de la fila `clock_rollback` guarda, además, `lastRecordedAtUtc` y `detectedAtUtc` (instantes UTC con milisegundos y `Z`). La auditoría conserva así el instante exacto de la comparación.
- **Bloqueo persistido (`features/auth/repository.rs`):** el bloqueo está activo si `locked_until_utc > now`. Una fila es obsoleta si `locked_until_utc <= now` o `last_failure_at_utc <= now - 300 s`. Al quinto fallo, `locked_until_utc` = now + 300 s. `local_now!` desaparece.
- **Tests:**
  - DST: `features/audit/clock_dst_test.rs` (4 tests) y `features/auth/repository_throttle_dst_test.rs` (9 tests). Tienen instantes UTC fijos y no dependen de la zona del proceso. Sobre el código previo a la conversión a UTC, el rojo se reproduce solo con `TZ=America/New_York`.
  - Formato: `db/utc_format_test.rs` verifica que los CHECK de `audit_log.occurred_at_utc`, `login_throttle.last_failure_at_utc` y `login_throttle.locked_until_utc` rechazan valores de 24 caracteres con formato incorrecto y que `locked_until_utc` admite NULL.

## Consecuencias

- Las migraciones 0003 y 0004 se editaron en su lugar porque Fase 2 no está liberada, y el endurecimiento posterior volvió a editarlas (CHECK de formato). El runner (`db/migrations.rs`) omite versiones ya aplicadas según `user_version`: una BD de desarrollo ya migrada a v3/v4 con cualquiera de las versiones anteriores no recibe el esquema actual y debe recrearse. No hay bases de desarrollo en v3/v4 en la máquina del autor: el `spa.db` local es anterior a 0003.
- No hay backfill de `occurred_at_utc` ni de las columnas UTC del throttle. Las filas creadas con el esquema previo solo tienen `occurred_at` (local). En la hora repetida del cambio de horario no hay conversión inequívoca a UTC, así que no se inventa un instante exacto para esas filas.
- `ClockRollbackBanner` (`lastRecordedAt`, `detectedAt`) sigue mostrando hora local.
- La tolerancia de retroceso (`CLOCK_ROLLBACK_TOLERANCE_SECS` = 300) no cambia.

## Límites

- UTC no protege frente a un cambio manual del reloj del sistema. Ese caso sigue cubierto solo por la detección de `clock_rollback` (ADR 0004, "Límites conocidos").
- Modelo de confianza en el reloj local (decisión de alcance, aceptada):
  - La detección de `clock_rollback` corre solo al arranque (`setup::bootstrap`, única llamada a `record_clock_rollback`).
  - Solo mira `audit_log` (la fila con mayor `occurred_at_utc`); no compara contra `login_throttle` ni contra otras marcas.
  - Tolera 300 s de diferencia.
  - Adelantar el reloj del sistema para vencer un bloqueo persistido de login no se detecta.
- Esto no es un pendiente de implementación. Quien controla el reloj del sistema operativo ya tiene acceso local al equipo y a la BD, de modo que el modelo de amenazas de la aplicación no lo cubre. Cualquier cambio de este alcance requiere una decisión nueva con su propio ADR.

## Decisiones de la auditoría de Fase 2

### Migraciones 0003 y 0004 editadas en sitio (ITEM-28)

- `db/migrations/0003_audit_log.sql` y `db/migrations/0004_login_throttle.sql` se editaron en sitio mientras Fase 2 no esté publicada. El runner (`db/migrations.rs`) decide con `PRAGMA user_version` qué versiones aplicar; una BD ya en v3 o v4 no recibe cambios posteriores de esos archivos.
- Condición que sostiene la decisión: no existe una BD en `user_version` 3 o 4 fuera de desarrollo.
- Reevaluación: si una build distribuida incluye una BD en v3 o v4, cualquier cambio de esquema requiere una migración nueva (`0005_...`) y no vuelve a editarse ninguna migración ya aplicada. Hay que añadir la migración nueva al array de `db/migrations.rs` y verificar con una BD copiada en v4.

### Costuras `*_at` con `&str` validado, sin newtype `Instant` (ITEM-27)

- **Forma actual.** `find_credentials_by_username_at`, `find_credentials_by_id_at` y `record_persisted_failure_at` (`features/auth/repository.rs`), y `detect_clock_rollback_at` y `record_clock_rollback_at` (`features/audit/clock.rs`), son `pub(crate)` y reciben `now: &str`. Los wrappers públicos pasan `SQLITE_NOW` = `"now"` (`features/auth/repository.rs`, línea 72).
- **Validación.** Antes de consultar, cada costura llama a `require_valid_instant` (`db/mod.rs`), que evalúa `strftime('%Y-%m-%dT%H:%M:%fZ', ?1) IS NOT NULL`. Si la cadena no es un instante válido, devuelve `DbError::InvalidInstant` y no decide nada. Falla cerrado.
- **Decisión.** No se introduce un newtype `Instant` o `UtcInstant`. Motivo (YAGNI, `rules/common/coding-style.md`): la costura es interna al crate, hay un único productor en producción (`SQLITE_NOW`) y los demás llamadores son tests con literales. Un newtype añadiría un tipo sin un segundo implementador.
- **Señal para cambiar.** Cualquiera de estas dos: (a) un segundo origen de instantes fuera de SQLite (instantes recibidos por IPC, o una lectura de reloj de pared en Rust que se pase a la BD), o (b) un defecto de formato que llegue a BD a pesar de la validación. Con cualquiera de las dos, el tipo `UtcInstant` con constructor validado pasa a justificarse.
- **Coste de `require_valid_instant` (aceptado, ITEM-27).** Cada costura ejecuta una consulta `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', ?1) IS NOT NULL` sobre la conexión abierta, antes de su consulta de decisión. Esa consulta no lee tablas y se resuelve en memoria. Llamadores directos: `detect_clock_rollback_at` (`features/audit/clock.rs`), y `find_credentials_by_username_at`, `find_credentials_by_id_at` y `record_persisted_failure_at` (`features/auth/repository.rs`). `record_clock_rollback_at` valida a través de `detect_clock_rollback_at`.
  - Se mantiene la consulta por dos motivos: eliminarla exigiría reescribir el SQL de varios llamadores para que validen `now` de otro modo, y se perdería el fallo cerrado ante instantes inválidos (`DbError::InvalidInstant`).
  - Coherente con la decisión anterior: la validación vive en la frontera SQL y no en un tipo Rust.
