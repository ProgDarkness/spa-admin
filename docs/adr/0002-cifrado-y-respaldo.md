# ADR 0002: Cifrado de la BD, clave en keychain, autenticación y respaldo

- **Estado:** Aceptada
- **Fecha:** 2026-11-14
- **Actualizada:** 2026-11-18 (ITEM-18): punto 11, límite de permisos en Windows. 2026-11-17 (Fase 2, S12): puntos 6, 7, 9 y 10 pasan a implementados; el estado de cada punto indica su fase y slice
- **Fase:** 1 (slice S0). Lockout de login y bloqueo por inactividad implementados en Fase 1. Implementados en Fase 2: detección de reanudación (S4), lockout persistente (S6), código de recuperación D13 (S7, S8), copia previa a migrar (S1) y auditoría de solo inserción D15 (S2, S5, S9, S10). Diferido: D14 (respaldo y restauración) en Fase 8
- **Fuentes:** `docs/planeers/plan-mvp.md` (D2, D12, D13, D14, D15, "Seguridad (offline)", "Respaldo y restauración"), run `run-mwfno8h1-a6fafa9b`; para Fase 2, `docs/adr/0004-sesion-y-auditoria.md`

## Contexto

- Spa offline en un equipo; la BD contiene datos de clientes (cédula, teléfono) y pagos.
- Sin red: la app no abre conexiones (CSP sin allowlist `http`).
- La BD debe cifrarse con SQLCipher (D2) y la clave debe vivir fuera del archivo.
- Requisitos de sesión y recuperación: D12 (intentos y bloqueo), D13 (código de recuperación), D14 (respaldo cifrado).

## Decisión

1. **SQLCipher con clave raw de 32 bytes (D2).** `rusqlite` 0.43.0 con `bundled-sqlcipher-vendored-openssl` (`libsqlite3-sys` 0.40.0, `sqlcipher-src` 420.0.0 = SQLCipher 4.20.0 / SQLite 3.54.1; corrige RUSTSEC-2026-0502). `rusqlite_migration` se descarta: 2.7.0 exige `rusqlite` ^0.41, incompatible. Migrador propio mínimo en `db/migrations.rs`: lista ordenada `(versión, SQL)`, una transacción por migración, `PRAGMA user_version` = cantidad aplicada; una BD con versión mayor que la del binario o negativa falla cerrada (`SchemaNewerThanApp`).
   - `DbKey(Zeroizing<String>)` con 32 bytes aleatorios en hex. Sin `Clone` ni `Serialize`; `Debug` redactado.
   - Apertura: `PRAGMA key = "x'<hex>'"` como primera sentencia vía `execute_batch` (no `pragma_update`), luego `foreign_keys=ON` y verificación con `SELECT count(*) FROM sqlite_master`. Un archivo que no es BD cifrada con esa clave se mapea a `NotADatabase`.
   - La BD vive en el `app_data_dir` del identificador `com.progdarkness.spa`.
2. **Clave en el keychain del SO.** `KeyStore` (struct concreta, ver ADR 0001) guarda la clave con servicio = `com.progdarkness.spa`. Cambiar el identificador deja huérfana la clave.
3. **`load_or_create` nunca regenera una clave si la BD existe.**
   - Sin clave y sin BD: crea clave y BD.
   - Sin clave y con BD: `KeyStoreError::MissingForExistingDb`. No se regenera.
   - La recuperación de esa situación es restaurar un respaldo (Fase 8).
4. **Sin fallback en texto plano.** Si el keychain no está disponible, `setup::init` aborta. No hay modo parcial.
5. **Contraseñas con argon2id** `m=19456 t=2 p=1`, mediante `PasswordPolicy` con hash dummy (`features/auth/password.rs`).
   - `login` siempre verifica. Usuario inexistente, inactivo o clave incorrecta devuelven el mismo `InvalidCredentials`.
   - Sesión en `SessionState(Mutex<Option<ActiveSession>>)` en Rust (`features/auth/service.rs`). Detalle en ADR 0004.
6. **Intentos fallidos y bloqueo (D12): implementado.** Estado: lockout en memoria y bloqueo por inactividad en Fase 1; reanudación del equipo y lockout persistente en Fase 2 (S4, S6).
   - **Bloqueo por inactividad:** `IDLE_TIMEOUT` = 10 min (`features/auth/service.rs`), medido con `Instant` (monotónico).
   - **Reanudación del equipo (S4, `features/auth/heartbeat.rs`):** cada latido compara el avance del reloj monotónico (`Beat.mono`) y del de pared (`Beat.wall`) desde el latido anterior. `resumed_between` devuelve `true` si:
     - el avance de pared supera al monotónico en más de `HEARTBEAT_SLACK` = 30 s (criterio de pared), o
     - el avance monotónico supera `MAX_HEARTBEAT_GAP` = 120 s (criterio monotónico).
     - Si el reloj de pared retrocede (`duration_since` falla), solo aplica el criterio monotónico.
   - **Latido:** hilo `spawn_heartbeat` que ejecuta `run_tick` cada `HEARTBEAT_INTERVAL` = 15 s dentro de `Database::with_tx`. `SessionState::observe` también evalúa la reanudación en cada consulta, así que la detección puede dispararse en una llamada del front antes del siguiente latido. Si bloquea, se audita `session_locked` con motivo `resume`.
   - **Comportamiento por SO (propiedad de plataforma de `std::time::Instant`; no hay test de suspensión real en el repo):**
     - Linux y macOS: el monotónico no avanza durante la suspensión. Cualquier suspensión que el reloj de pared mida con más de 30 s de diferencia se detecta por el criterio de pared.
     - Windows: el monotónico sí avanza durante la suspensión. El criterio de pared no dispara y solo se detecta la suspensión cuando el avance monotónico supera 120 s; una suspensión más corta no se detecta.
   - **Falsos positivos aceptados:** un ajuste hacia adelante del reloj de pared de más de 30 s (NTP o cambio manual) bloquea sin suspensión; un latido que no corre durante más de 120 s (bloqueo del proceso o carga extrema) también bloquea.
   - **Lockout persistente de login (S6):** tabla `login_throttle` (`db/migrations/0004_login_throttle.sql`): clave `user_id`, `failures` entre 1 y 5, `last_failure_at_utc`, `locked_until_utc` (ISO UTC con ms y `Z`); `CHECK ((failures = 5) = (locked_until_utc IS NOT NULL))`. Cinco fallos fijan `locked_until_utc` a +300 s (`MAX_PERSISTED_FAILURES` = 5 en `features/auth/repository.rs`). Solo se persisten usuarios existentes: el nombre inexistente no genera fila. Su base temporal es el reloj de pared en UTC (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`, ADR 0005), no el monotónico ni la hora local.
   - **Throttle en memoria compartido (`features/auth/throttle.rs`):** `MAX_FAILURES` = 5, `LOCKOUT` = 300 s, clave = nombre de usuario en minúsculas, `MAX_TRACKED` = 1024. Lo comparten login, unlock y recuperación, y cubre también nombres inexistentes.
7. **Código de recuperación (D13): implementado (S7, S8).**
   - **Generación (`features/auth/recovery.rs`):** 20 símbolos del alfabeto base32 RFC 4648 (`RECOVERY_ALPHABET`, A-Z y 2-7), 100 bits. Cada símbolo usa 5 bits de un byte de `getrandom::fill` con máscara `SYMBOL_MASK` = 0x1F (32 símbolos exactos, sin sesgo de módulo). El alfabeto se implementa a mano sobre `getrandom`, sin crate de base32 (H4).
   - **Presentación:** `formatted()` en grupos de `RECOVERY_GROUP` = 4 separados por `-`. Al leer, `parse` ignora guiones y espacios, pasa a mayúsculas y exige `RECOVERY_CODE_CHARS` = 20 símbolos del alfabeto.
   - **Almacenamiento:** solo el hash argon2id del código canónico en `users.recovery_code_hash` (`prepare_credentials` en `features/auth/owner_setup.rs`; `prepare_rotation` en `features/auth/recover.rs`).
   - **Un solo uso con rotación por CAS:** `recover_password` verifica el código contra el hash almacenado. Si coincide, `rotate_credentials` ejecuta `UPDATE users ... WHERE id = ?3 AND recovery_code_hash = ?4` con el hash verificado; si no cambia exactamente una fila, responde `InvalidCredentials`. Se genera un código nuevo, que se devuelve una vez. El anterior deja de valer por construcción. Sin caducidad.
   - **Solo Propietaria (DN5):** `insert_owner` (rol `OWNER_ROLE_ID` = 1) es el único punto que escribe `recovery_code_hash`; `create_user` no lo escribe. Un usuario sin hash recibe `InvalidCredentials` (test `user_without_recovery_hash_gets_invalid_credentials`). `recover_with` no comprueba el rol explícitamente; ver límites en ADR 0004. Para el resto de usuarios, la recuperación es `reset_user_password` (`features/users/commands.rs`), que puede ejecutar cualquier cuenta activa con `users.manage` y no solo la Propietaria, como dice D13 ("otros usuarios los restablece la Propietaria").
   - **Sin sesión:** `recover_password` no exige sesión. Al rotar, termina solo la sesión del usuario afectado (`session.end_if_user`).
   - **Política de contraseña nueva (`validate_new_password`, `features/auth/password.rs`):** mínimo `MIN_NEW_PASSWORD_CHARS` = 10 code points (`chars().count()`), máximo 1024 bytes. Sin reglas de composición (Q7). El front usa la misma constante `MIN_NEW_PASSWORD_CHARS` = 10 en `src/features/auth/schemas.ts`, contada por code points.
   - **Intentos:** el código erróneo cuenta como fallo en el throttle compartido (punto 6) y en `login_throttle`; al quinto fallo, bloqueo de 300 s que también rechaza un código correcto. Se audita `recovery_failed` (actor NULL) solo si el usuario existe.
   - **Auditoría:** `recovery_used` (actor = usuario) al rotar; nunca código ni hash. El evento de creación `owner_created` no contiene el código.
   - **Primer arranque (S7):** `setup_owner` crea la Propietaria y devuelve el código una vez. `RecoveryCodePanel` (`src/features/auth/components/recovery-code-panel.tsx`) exige marcar que se guardó antes de continuar. Discrepancia con D13: el plan dice que el código se confirma "impreso"; el código exige un checkbox de confirmación y no tiene acción de imprimir.
   - **LÍMITE CONOCIDO:** el código viaja como `String` serializada por IPC, tanto en la salida (`OwnerSetupResult.recoveryCode`, `RecoveryResult.recoveryCode`) como en la entrada de `recover_password` (`RecoveryRequest.recoveryCode`). Una vez cruzado el IPC no se puede poner a cero. En Rust solo se cubren con `Zeroizing` las copias propias. En el front el código vive en estado de componente de vida corta (`useState` en `setup-owner-form.tsx` y `recover-form.tsx`).
8. **Respaldo cifrado (D14): diferido a Fase 8.** Archivo `.spabak` con BD, clave y `schema_version`, cifrado con frase del usuario (KDF argon2id + XChaCha20-Poly1305).
   - Restaurar: descifrar a temporal → `integrity_check` → validar versión (acepta igual o menor con migración; rechaza mayor) → intercambio atómico de BD y clave → guardar la clave nueva en el keychain. La BD previa queda como `.bak` hasta confirmar apertura correcta.
   - Recordatorio semanal de respaldo en la app.
   - Fase 2 no implementa exportación ni importación; la copia previa a migrar (punto 9) es un mecanismo distinto.
9. **Copia previa a migrar: implementado (S1, `db/snapshot.rs`).**
   - Antes de `migrate`, si `PRAGMA user_version` está en el rango `[1, versión soportada)` (`pending_from`), `snapshot_before_migrate` copia el archivo de BD a `spa.db.{epoch_millis:016}.v{from}.bak`, por ejemplo `spa.db.0001763412345678.v2.bak`. Una BD nueva (versión 0) no genera copia.
   - La copia es exclusiva (`create_new`) y se sincroniza a disco antes de devolver la ruta. Si la copia falla a medio camino, se elimina el destino parcial (`copy_exclusive`).
   - Permisos `0600` en Unix (`SNAPSHOT_MODE`, `create_private`). En otros SO no hay restricción de modo (`#[cfg(not(unix))]`).
   - **Fail-closed:** si la copia falla, `bootstrap` devuelve `SetupError::Snapshot` (`setup.rs`) y el arranque aborta antes de `migrate`; la BD original queda intacta.
   - **Retención:** `SNAPSHOT_RETENTION` = 3 copias del mismo archivo, ordenadas por nombre; la poda elimina las más antiguas (Q6).
   - **Poda no bloqueante (DN4):** si la poda falla, se registra con `eprintln` y el arranque continúa.
   - **Cifrada con la clave actual:** la copia es byte a byte del archivo SQLCipher; no se re-cifra y la clave no aparece en el nombre. Solo la clave vigente en el keychain la abre.
   - No hay comando de restauración en Fase 2; el flujo de restauración pertenece a D14 (Fase 8).
10. **Auditoría de solo inserción (D15): implementado (S2, S5, S9, S10).**
    - Tabla `audit_log` (`db/migrations/0003_audit_log.sql`): `id`, `occurred_at` (local, para mostrar: DEFAULT `strftime('%Y-%m-%dT%H:%M:%S','now','localtime')`, CHECK de 19 caracteres), `occurred_at_utc` (para comparar: DEFAULT `strftime('%Y-%m-%dT%H:%M:%fZ','now')`, CHECK de 24 caracteres, índice `audit_log_occurred_at_utc`; ADR 0005), `actor_user_id` (NULL cuando no hay actor autenticado), `action` (CHECK con 16 acciones fijas), `entity` (CHECK `user|role|system`), `entity_id` y `diff` (CHECK `json_valid` o NULL).
    - Triggers `audit_log_no_update` y `audit_log_no_delete`: `BEFORE UPDATE` / `BEFORE DELETE` con `RAISE(ABORT, 'audit_log is append-only')`.
    - Nombres reales frente al diseño inicial del plan: no existe columna `kind`; `at` es `occurred_at`; `user_id` es `actor_user_id`; `diff_json` es `diff`.
    - **Diff (`features/audit/model.rs`):** `Diff::between`, `Diff::created` y `Diff::note`. Toda clave de `FORBIDDEN_DIFF_KEYS` se descarta en cualquier nivel anidado. La comparación normaliza la clave a minúsculas y sin `_` ni `-`. Las claves prohibidas son `password`, `passwordhash`, `recoverycode`, `recoverycodehash`, `key`, `dbkey`, `secret` y `token`.
    - **Atomicidad:** `audit::record` se invoca dentro de la misma `Database::with_tx` que la acción auditada. Si la auditoría falla, la acción se revierte (ADR 0004).
    - **Alcance de Fase 2:** audita autenticación, sesión, usuarios, roles y reloj. Las entidades de negocio (clientes, catálogo, citas, pagos, tasas) no existen todavía y quedan para sus fases.

11. **Permisos del directorio de datos y de la BD en Windows: sin ACL explícita (límite aceptado, ITEM-18).**
   - `restrict_to_owner` (`src-tauri/src/setup.rs`) aplica `0700` al directorio de datos y `0600` a `spa.db` solo en Unix (`cfg(unix)`, `fs::set_permissions`). En Windows (`cfg(not(unix))`) devuelve `Ok(())` y no altera permisos. No falla cerrado y no restringe.
   - Protección que queda en Windows: la ACL heredada del `app_data_dir` de Tauri, que cuelga de `%APPDATA%` (perfil del usuario), y el cifrado SQLCipher de `spa.db` (punto 1). Supuesto de plataforma: ningún código ni test establece ni verifica esa ACL, y CI no la comprueba.
   - Contrato fijado por `restrict_to_owner_leaves_the_platform_permissions_untouched` (`src-tauri/src/setup_test.rs`, `cfg(not(unix))`, ejecutado por el job Windows de CI): los permisos del directorio y del archivo quedan idénticos tras llamar a `restrict_to_owner`, el archivo no pasa a solo lectura y su contenido no cambia.
   - Los respaldos `.bak` (punto 9) siguen la misma regla. `create_private` (`src-tauri/src/db/snapshot.rs`) fija `mode(0o600)` solo en `cfg(unix)`; en `cfg(not(unix))` crea el archivo con `create_new` sin modo. El test `copy_is_0600` (`src-tauri/src/db/snapshot_test.rs`) es `cfg(unix)`; no existe test de permisos de `.bak` en Windows.
   - Amenaza abierta: otro usuario local con acceso al perfil del usuario (lectura de `%APPDATA%`, copias de perfil) puede leer `spa.db` y los `.bak`. Ambos siguen cifrados con SQLCipher, y la clave reside en el Credential Manager de la cuenta que la creó (punto 2).
   - Condición para endurecer: (a) la instalación pasa a un equipo compartido entre cuentas de Windows, o (b) un requisito de cumplimiento exige control de acceso explícito. Implementación: en `restrict_to_owner` para `cfg(not(unix))`, fijar una DACL explícita con la API de Windows (herencia desactivada, ACE solo para el SID del usuario actual) sobre el directorio, `spa.db` y los `.bak`; `create_private` debe crear los `.bak` ya con esa DACL. El test `restrict_to_owner_leaves_the_platform_permissions_untouched` se reemplaza en ese mismo cambio por uno que lea la DACL resultante.

## Consecuencias

- **Pérdida de la clave del keychain** (o cambio del identificador) deja la BD irrecuperable sin respaldo. Por eso `load_or_create` nunca regenera.
- **Código de recuperación perdido junto con la contraseña de la Propietaria:** el código solo se muestra una vez. La salida operativa es que otra cuenta activa con `users.manage` use `reset_user_password` sobre la Propietaria. Si no existe otra cuenta con ese permiso, solo queda restaurar un respaldo (Fase 8).
- **Tests:** keychain con `keyring-core::mock::Store` (inyección de fallos). El keychain real (`--features real-keyring`) se prueba en CI en Windows, macOS y Ubuntu (Ubuntu con `gnome-keyring-daemon` bajo `dbus-run-session` y `xvfb-run`). WSL local no ejecuta esa prueba sin Secret Service.
- **Abrir el `.db` con un cliente SQLite normal debe fallar** (criterio de verificación del plan).
- **Pendiente tras Fase 2:** respaldo y restauración cifrados (D14, Fase 8). El resto de D12 a D15 queda implementado según los puntos 6 a 10.
- **Verificado en Linux** (`cargo test --locked`, clippy y `cargo check --locked --features real-keyring`, 2026-11-16): `init_native_store`, `delete`/`NoEntry` en keyring 4 y API de `argon2` 0.6. Las verificaciones de Fase 2 se registran en la fase TEST del run.
- **Verificado en CI:** OpenSSL vendored en Windows: el job `rust (windows-latest)` instala NASM y Perl y ejecuta `cargo test --features real-keyring` en verde.

**Límites aceptados**
- La clave derivada en hex vive en memoria mientras SQLCipher la usa.
- Copias intermedias de `serde` en el IPC no se pueden poner a cero; `zeroize` solo cubre `LoginCredentials`, `DbKey`, `RecoveryRequest`, `UnlockCredentials`, `OwnerSetup` y `NewUserInput`/`PasswordReset` en su parte de entrada.
- El código de recuperación cruza el IPC como `String` (punto 7).
- Detección de reanudación con falsos positivos y, en Windows, sin detección de suspensiones menores de 120 s (punto 6).
- Windows: permisos del directorio, de `spa.db` y de los `.bak` sin ACL explícita; la protección descansa en la ACL heredada de `%APPDATA%` y en el cifrado SQLCipher (punto 11).
