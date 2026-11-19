# ADR 0002: Cifrado de la BD, clave en keychain, autenticación y respaldo

- **Estado:** Aceptada
- **Fecha:** 2026-11-14
- **Fase:** 1 (slice S0); lockout de login y bloqueo por inactividad implementados en Fase 1. Diferidos: D13, detección de reanudación, D15 (triggers de `audit_log`) y copia de BD previa a migrar en Fase 2; D14 en Fase 8
- **Fuentes:** `docs/planeers/plan-mvp.md` (D2, D12, D13, D14, D15, "Seguridad (offline)", "Respaldo y restauración"), run `run-mwfno8h1-a6fafa9b`

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
5. **Contraseñas con argon2id** `m=19456 t=2 p=1`, mediante `PasswordPolicy` con hash dummy.
   - `login` siempre verifica. Usuario inexistente, inactivo o clave incorrecta devuelven el mismo `InvalidCredentials`.
   - Sesión en `SessionState(Mutex<Option<SessionUser>>)` en Rust.
6. **Intentos fallidos y bloqueo (D12): implementados en Fase 1.** Lockout de login: 5 intentos fallidos y espera de 300 s, con reserva atómica del intento. Bloqueo de sesión a los 10 min de inactividad (`IDLE_TIMEOUT`). Ambos usan `Instant` (reloj monotónico). Queda para Fase 2 la detección de reanudación del equipo (latido con reloj monotónico frente a reloj de pared).
7. **Código de recuperación (D13): diferido a Fase 2; hoy solo existe la columna `users.recovery_code_hash`.** Objetivo fijado: 20 caracteres base32 (100 bits) en grupos de 4, generados con el CSPRNG del SO. Se muestra una vez, exige confirmación y se almacena solo como hash argon2id en `users.recovery_code_hash`. Uso único, sin caducidad, al usarlo se genera uno nuevo. Nunca en auditoría ni logs: solo el evento `recovery_used`.
8. **Respaldo cifrado (D14): diferido a Fase 8.** Archivo `.spabak` con BD, clave y `schema_version`, cifrado con frase del usuario (KDF argon2id + XChaCha20-Poly1305).
   - Restaurar: descifrar a temporal → `integrity_check` → validar versión (acepta igual o menor con migración; rechaza mayor) → intercambio atómico de BD y clave → guardar la clave nueva en el keychain. La BD previa queda como `.bak` hasta confirmar apertura correcta.
   - Recordatorio semanal de respaldo en la app.
9. **Migraciones.** Numeradas y transaccionales: una transacción por migración en `db/migrations.rs`; si falla, la transacción se revierte. **Diferido a Fase 2:** copia del archivo de BD antes de migrar (no implementada en Fase 1).
10. **Auditoría de solo inserción (D15): diferido a Fase 2.** No existe `audit_log` en Fase 1 ni triggers. Diseño objetivo: triggers que prohíben `UPDATE` y `DELETE` en `audit_log`. El diff excluye `password_hash`, `recovery_code_hash` y claves.
11. **Superficie Tauri mínima.**
    - CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src ipc: http://ipc.localhost; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`.
    - Capabilities: `src-tauri/capabilities/default.json` (ventana `main`) con `allow-login`, `allow-logout` y `allow-current-session`. Los permisos por comando se generan en `build.rs` (`AppManifest::commands`: `login`, `logout`, `current_session`). No se usa `core:default`.
12. **Logging.** Solo `Display` de errores. Nunca credenciales, clave ni hashes.
13. **Seed demo.** Solo `cfg(debug_assertions)` y con `SPA_DEV_SEED_PASSWORD` definida; sin contraseña por defecto; nunca en release.

**Límites aceptados**
- La clave derivada en hex vive en memoria mientras SQLCipher la usa.
- Copias intermedias de `serde` en el IPC no se pueden poner a cero; `zeroize` solo cubre `LoginCredentials` y `DbKey`.

## Consecuencias

- **Pérdida de la clave del keychain** (o cambio del identificador) deja la BD irrecuperable sin respaldo. Por eso `load_or_create` nunca regenera.
- **Tests:** keychain con `keyring-core::mock::Store` (inyección de fallos). El keychain real (`--features real-keyring`) se prueba en CI en Windows, macOS y Ubuntu (Ubuntu con `gnome-keyring-daemon` bajo `dbus-run-session` y `xvfb-run`). WSL local no ejecuta esa prueba sin Secret Service.
- **Abrir el `.db` con un cliente SQLite normal debe fallar** (criterio de verificación del plan).
- **Recuperación de contraseña (D13), detección de reanudación del equipo y respaldo (D14) quedan fuera de Fase 1.** El lockout de login y el bloqueo por inactividad ya están implementados. Sin D13, un usuario que olvide su clave depende de la Propietaria o de restaurar respaldo hasta Fase 2 y 8.
- **Verificado en Linux** (`cargo test --locked`, clippy y `cargo check --locked --features real-keyring`, 2026-11-16): `init_native_store`, `delete`/`NoEntry` en keyring 4 y API de `argon2` 0.6.
- **Pendiente de verificación:** OpenSSL vendored en Windows (CI Windows).
