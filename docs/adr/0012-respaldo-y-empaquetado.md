# ADR 0012: Respaldo `.spabak`, restauración en dos etapas, recuperación al arranque y empaquetado

- **Estado:** Aceptada
- **Fecha:** 2026-11-26
- **Fase:** 8
- **Fuentes:** `docs/adr/0002-cifrado-y-respaldo.md` (puntos 1, 3, 8 y 9), `docs/adr/0004-sesion-y-auditoria.md`, `docs/adr/0005-tiempo-utc-y-hora-local.md`, `docs/adr/0011-metricas.md`, `docs/planeers/plan-mvp.md` (D2, D13, D14, D15, D17, "Respaldo y restauración", Fase 8 y verificación 3 a 9). Código: `src-tauri/src/features/backup/` (`format.rs`, `crypto.rs`, `service.rs`, `restore.rs`, `swap.rs`, `recovery.rs`, `status.rs`, `leftovers.rs`, `naming.rs`, `background.rs`, `dialogs.rs`, `commands.rs`), `src-tauri/src/setup.rs`, `src-tauri/src/keystore.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/errors.rs`, `src-tauri/src/db/connection.rs`, `src-tauri/src/db/snapshot.rs`. Front: `src/features/backup/`, `src/app/(app)/ajustes/respaldo/`, `src/app/(auth)/setup/restaurar/`, `src/components/backup-reminder-banner.tsx`. Empaquetado: `src-tauri/tauri.conf.json`, `.github/workflows/`.

## Contexto

- D14 pide un respaldo cifrado con la frase del usuario que incluya BD, clave y versión de esquema, una restauración atómica que reemplace BD y clave, y un recordatorio semanal. D17 pide instaladores sin firma publicados como release privado con su SHA-256, y guía para SmartScreen y Gatekeeper.
- La BD usa SQLCipher con clave en el keychain (ADR 0002, puntos 1 a 3). Un respaldo debe llevar la clave, porque sin ella el archivo `spa.db` no se abre en otro equipo.
- La BD no activa WAL: el código no emite `PRAGMA journal_mode`, así que SQLite usa el modo por defecto (journal de rollback). Esta decisión es una dependencia, no una opción: ver "Dependencia de no usar WAL".
- `bootstrap_with` llama a `load_or_create(store, database_path.exists())`. Si `spa.db` falta y la clave existe, crea una BD vacía en silencio. Un restore interrumpido entre apartar y reemplazar la BD podía dejar la app con datos vacíos sin aviso. Por eso la recuperación va antes de `load_or_create`.

## Decisión

### DB1. Formato `.spabak` v1 (`features/backup/format.rs`)

Cabecera de 66 bytes, little-endian, usada completa como AAD del cifrado:

| Offset | Campo | Tamaño | Valor |
|---|---|---|---|
| 0 | `MAGIC` | 8 | `b"SPABAK\0\0"` |
| 8 | `FORMAT_VERSION` | u16 | `1` |
| 10 | `schema_version` | u32 | versión de esquema de la BD exportada (≥1) |
| 14 | `kdf.memory_kib` | u32 | m de argon2id |
| 18 | `kdf.iterations` | u32 | t de argon2id |
| 22 | `kdf.parallelism` | u32 | p de argon2id |
| 26 | `salt` | 16 | aleatorio (`getrandom`) |
| 42 | `nonce` | 24 | aleatorio (`getrandom`), XChaCha20 |

- Cuerpo: XChaCha20-Poly1305 sobre `clave_raw[32] || bytes de spa.db`, con tag de 16 bytes al final.
- Exportación: argon2id v0x13 con m=65536 KiB, t=3, p=1, salida de 32 bytes.
- Importación acepta solo parámetros dentro de: m en 19456..=131072 KiB, t en 1..=6, p en 1..=4.
- `FORMAT_VERSION` distinto de 1, magic incorrecto, menos de 66 bytes o `schema_version` 0 dan `NotRecognized`. Un `schema_version` mayor que `supported_version()` da `FromNewerApp`; esta comprobación ocurre antes de ejecutar argon2.
- Tamaño máximo: `MAX_BACKUP_BYTES` = 256 MiB. La importación compara `metadata().len()` antes de leer; si lo supera da `NotRecognized`. La exportación calcula `66 + 32 + tamaño(spa.db) + 16`; si supera el máximo, aborta con `TooLarge` antes de escribir nada.

### DB2. Frase de respaldo (`features/backup/crypto.rs`)

- Se normaliza a NFC antes de derivar la clave. Mínimo 12 code points, máximo 1024 bytes UTF-8. Un fallo da `Validation` con `field = "passphrase"`.
- `BackupPassphrase` guarda `Zeroizing<String>`, no implementa `Clone` y su `Debug` es `BackupPassphrase(<redacted>)`.
- La clave derivada y el texto plano del respaldo van en `Zeroizing`.
- El front aplica las mismas reglas con la misma constante (`MIN_BACKUP_PASSPHRASE_CODE_POINTS` = 12, `MAX_BACKUP_PASSPHRASE_BYTES` = 1024 en `src/lib/backup-passphrase.ts`).
- La frase incorrecta y el archivo dañado producen el mismo error (`BackupUnreadable`). Es deliberado: distinguirlos daría un oráculo.

### DB3. Exportación (`features/backup/service.rs`, `commands.rs::export_flow`)

Orden real del flujo:

1. Fuera de cualquier lock: `authorize` (sesión activa, no bloqueada, con `backup.manage`). Validación de la frase. Sugerencia de nombre con la hora local de SQLite. Diálogo nativo de guardado (`BackupDialogs::pick_save`, en `spawn_blocking`). Cancelar devuelve `Ok(None)`.
2. Se añade la extensión `.spabak` si falta (`with_backup_extension`).
3. Dentro de `with_conn_mapped` (mutex de la BD): reautoriza, lee `PRAGMA user_version` (debe estar en `1..=supported_version()`), lee la clave del keychain y copia los bytes de `spa.db` a memoria.
4. Fuera del lock, en `spawn_blocking`: KDF y cifrado (`seal`).
5. Escribe `<destino>.partial-<16 hex>` con `create_new`, permisos 0600 en Unix y `sync_all`.
6. Dentro de `with_tx` (transacción inmediata): reautoriza, inserta la auditoría `backup_created` (actor = usuario de la sesión, entidad `system`, diff `{schemaVersion, fileName}`; sin ruta ni clave), desplaza un destino existente a `<destino>.replaced-<16 hex>` y renombra `.partial` a destino.
7. Liquidación: si la transacción se confirma, borra el `.replaced`. Si falla, borra el `.partial` (si no se movió), restaura el `.replaced` como destino o borra el destino no confirmado. Un archivo parcial nunca queda con el nombre final.

No se usa `sqlcipher_export`. La respuesta IPC es `BackupExported { fileName, createdAt }`.

### DB4. Diálogos nativos (`features/backup/dialogs.rs`)

- Se usa `tauri-plugin-dialog` solo desde Rust: `DialogExt::blocking_save_file` y `blocking_pick_file`, ejecutados en `spawn_blocking` a través de `BackupDialogs`.
- Filtro `Respaldo Spa` con extensión `spabak`. Nombre sugerido `spa-respaldo-YYYY-MM-DD-HHMM.spabak`.
- Sin paquete JS del plugin y sin permisos `dialog:*` ni `fs:*` en `capabilities/default.json`.
- Los comandos reciben un `BackupDialogs` inyectado. En tests se sustituyen los selectores por closures; el mismo patrón se usa en `bootstrap_with`.

### DB5. Restauración en dos etapas (`restore.rs`, `swap.rs`, `commands.rs::restore_flow`)

**Etapa 1: staging, fuera del lock de la BD.** Un fallo aquí no toca `spa.db`, la clave ni el keychain.

1. Validación previa de la frase. Diálogo de apertura (`pick_open`). Cancelar devuelve `Ok(None)`.
2. `stage_restore` en `spawn_blocking`: comprueba el tamaño, lee el archivo con límite (`read_bounded`), valida la cabecera (sin KDF para versión futura), ejecuta argon2 y el descifrado. Un fallo de AEAD da `Unreadable`.
3. Separa los primeros 32 bytes como clave y el resto como BD. Escribe `spa.db.<16 dígitos de milisegundos>.restoring` con permisos privados.
4. Verifica el temporal con `open_for_verification` (`SQLITE_DBCONFIG_DEFENSIVE` activo, `TRUSTED_SCHEMA` desactivado): `PRAGMA integrity_check` debe devolver exactamente `ok`, `PRAGMA cipher_integrity_check` no debe devolver filas, `user_version` no puede superar la versión soportada (`FromNewerApp`) y debe coincidir con `schema_version` de la cabecera (`Unreadable` si no).
5. Migra el temporal al esquema actual (`migrate`) y lo cierra. Si algo falla, descarta el temporal con sus sidecars.
6. Guarda huella (longitud y fecha de modificación) para comprobar después que el archivo no cambió.

**Etapa 2: intercambio, con el mutex de la BD tomado (`Database::with_conn_mut`).** Pasos y mensajes de inyección en `SwapStep`:

| Paso | Acción |
|---|---|
| S0 | Reautoriza: si `needs_owner` es verdadero, pasa (primer arranque); si no, exige sesión activa con `backup.manage`. Comprueba la huella del temporal. Lee la clave anterior (`MissingForExistingDb` si falta). |
| S1 `SavePendingKey` | Guarda la clave del respaldo en el keychain con cuenta `sqlcipher-db-key-pending`. |
| S2 `CloseLiveConnection` | Sustituye la conexión viva por una en memoria y cierra la conexión a `spa.db`. |
| S3 `MoveCurrentAside` | Renombra `spa.db` a `spa.db.<stamp>.prev`. |
| S4 `InstallRestored` | Renombra el `.restoring` a `spa.db`. |
| S5 `VerifyAndAudit` | Abre `spa.db` con la clave del respaldo, exige `user_version` igual a la versión soportada y registra `backup_restored` en la BD nueva (actor NULL; diff `{restoredBy, sourceSchemaVersion, schemaVersion}`; `restoredBy` es el nombre de usuario de la sesión o `null` en primer arranque). |
| S6 `PromoteKey` | Promueve la clave pending a la cuenta principal `sqlcipher-db-key` y borra pending. |

Tras S6: instala la conexión nueva en el mutex, termina la sesión (`session.end()`) y ejecuta la limpieza best-effort: borra `.prev` (con sidecars), la cuenta pending y todos los `spa.db.*.v<n>.bak` (`all_snapshots`). La respuesta es `RestoreResult { sourceSchemaVersion, schemaVersion }`.

**Deshacer.** Si falla cualquier paso de S1 a S6 (o hay panic, capturado con `catch_unwind`), `rollback` intenta, en este orden: restaurar la clave anterior (solo si S6 se intentó); devolver `.prev` a `spa.db` (quitando antes la BD nueva con sidecars); reabrir la conexión viva con la clave anterior (si no abre, con la del respaldo); borrar la clave pending. Cada paso lleva un `RollbackTally`: se intentan todos y se reporta el primer fallo. Si el deshacer falla, la app devuelve `BackupError::RollbackFailed`, termina la sesión, deja pending y `.prev` para la recuperación de DB6, y responde con el mensaje de restauración a medias.

La clave anterior vive en memoria solo durante la operación para poder deshacer. Tras el éxito no se conserva en ningún sitio (ver M3 en Consecuencias).

### DB6. Recuperación al arrancar (`features/backup/recovery.rs`)

`recover_interrupted_restore` se ejecuta en `bootstrap_with` antes de `load_or_create`. Leftovers con nombre `spa.db.<16 dígitos>.prev|.restoring|.failed`. Estos nombres no coinciden con el patrón de snapshot (`spa.db.<16 dígitos>.v<n>.bak`), y `is_snapshot_name` lo fija.

1. **(a) `spa.db` no existe y hay `.prev`:** descarta sidecars de `spa.db` y renombra el `.prev` más reciente a `spa.db`.
2. **(b) La clave principal abre `spa.db`:** limpieza (`clean_up`) y fin.
3. **(c) La clave pending abre `spa.db`:** promueve pending y limpieza.
4. **(d) Ninguna abre y hay `.prev`:** solo si el `.prev` abre con la clave principal, renombra `spa.db` a `spa.db.<stamp>.failed`, descarta sidecars, renombra `.prev` a `spa.db`, borra pending y limpia. Si el `.prev` no abre con la clave principal, devuelve `NotADatabase` y el arranque falla (ver DB12).
5. Sin `.prev` y sin clave que abra: no hace nada; `open_encrypted` falla después y el arranque falla.
6. Una clave pending malformada se borra y se trata como ausente.

La limpieza borra pending, `.prev` y `.restoring` (con sidecars). No toca `.failed`.

### DB7. Quién puede restaurar y exportar

- Exportar exige sesión activa, no bloqueada, con `backup.manage`, siempre. Sin sesión: `Unauthenticated`. Rol Recepción: `Forbidden`.
- Restaurar exige una de estas dos condiciones, reverificadas dentro del lock: primer arranque (`needs_owner == true`), o sesión activa no bloqueada con `backup.manage` (solo Propietaria en el seed).

### DB8. Estado del respaldo (`features/backup/status.rs`)

- `get_backup_status` exige `backup.manage` y se calcula desde la auditoría, no desde una tabla `settings`. Toma la última fila de `audit_log` con `action IN ('backup_created', 'backup_restored')` ordenada por `occurred_at_utc` descendente.
- `lastBackupAt` es `occurred_at` (hora local, 19 caracteres). `isDue` es verdadero si no hay filas o si `now_utc - last_utc >= 604800` segundos (`BACKUP_REMINDER_INTERVAL_SECONDS` = 7 días). `now` es `strftime('%Y-%m-%dT%H:%M:%fZ','now')`, UTC según ADR 0005.
- Front: `useBackupStatus` con `staleTime` de 5 min y `refetchInterval` de 60 min. `BackupReminderBanner` se monta en `shell-banners.tsx`, solo para usuarios con `backup.manage`, y no se muestra en la pantalla de respaldo. El texto cambia entre "Aún no has exportado ningún respaldo" (sin filas) y "Hace más de 7 días que no exportas un respaldo".

### DB9. Errores nuevos (`features/backup/errors.rs`, `src-tauri/src/errors.rs`)

Códigos `AppErrorCode` nuevos: `backupUnreadable`, `backupNotRecognized`, `backupFromNewerApp`. Los demás fallos de respaldo se asignan a `internal`.

| Origen | Código | Mensaje exacto |
|---|---|---|
| AEAD falla; cabecera completa pero sin tag; `integrity_check` distinto de `ok`; `cipher_integrity_check` con filas; BD no abre con la clave; `user_version` distinto de la cabecera | `backupUnreadable` | `La frase no coincide o el archivo está dañado` |
| Magic incorrecto; menos de 66 bytes; `FORMAT_VERSION` distinto de 1; KDF fuera de rango; `schema_version` 0; tamaño mayor de 256 MiB | `backupNotRecognized` | `El archivo no es un respaldo reconocido` |
| `schema_version` de cabecera o `user_version` mayor que la versión soportada | `backupFromNewerApp` | `El respaldo fue creado con una versión más nueva de la aplicación` |
| Frase fuera de límites | `validation` (campo `passphrase`) | `Revisa el dato ingresado` |
| Deshacer falló (`RollbackFailed`) | `internal` | `La restauración quedó a medias; reinicia la aplicación para completarla o recuperar el estado anterior` |
| Exportación supera el tamaño (`TooLarge`) | `internal` | `La base de datos supera el tamaño máximo admitido para un respaldo` |
| Cualquier otro fallo | `internal` | `No se pudo completar la operación` (con registro en log) |

### DB10. Empaquetado (estado en la rama)

- Decisión: `bundle.targets` = `["nsis", "msi", "dmg"]` (Q1: NSIS y MSI). NSIS con `installMode: currentUser`. `webviewInstallMode: downloadBootstrapper` en Windows (Q3, supuesto por confirmar). macOS con `signingIdentity: "-"` (firma ad-hoc, ver DB10b). `publisher` `ProgDarkness`, `category` `Business`.
- Versión `0.1.0` en `tauri.conf.json`, `Cargo.toml` y `package.json`, con tag `v0.1.0`.
- Estado: en el momento de este ADR, las cuatro entradas están modificadas en el árbol de trabajo (sin commit) por el slice de empaquetado. Este ADR no verifica un build de release; ver Límites.

**DB10b. Firma ad-hoc en macOS frente a D17.** D17 dice "firma queda para después" y la Fase 8 pide instalar "sin firma". La firma ad-hoc (`signingIdentity "-"`) no es una firma de desarrollador: no hay certificado Developer ID ni notarización, y Gatekeeper sigue bloqueando la primera apertura. Se acepta como no-firma a efectos de D17. El binario universal para Apple Silicon necesita al menos una firma (propiedad de la plataforma), por eso no se publica sin ella.

### DB11. Flujo de release (estado: pendiente de verificar)

- No es `tauri-action`. Motivo: el job de build no debe tener token de escritura; solo el job `publish` (ubuntu-24.04, `contents: write`, `environment: release`) crea el release con `gh`.
- Diseño: `permissions: {}` global; runners fijados (`windows-2025`, `macos-15`, `ubuntu-24.04`); push de etiquetas `v*.*.*` publica como draft; `workflow_dispatch` construye y ensambla sin publicar; job `verify` compara las tres versiones con la etiqueta y comprueba que `GITHUB_SHA` es ancestro de `origin/main`; build Windows con `--bundles nsis,msi`; build macOS con `--target universal-apple-darwin --bundles dmg` y verificación `lipo -archs` (palabras completas `x86_64` y `arm64`); el job de build no usa caché de dependencias; job `assemble` (push y dispatch) exige exactamente un `.exe`, un `.msi` y un `.dmg`, los copia a una carpeta plana y genera `SHA256SUMS` con lista explícita de archivos y rutas relativas planas; sube el artifact `release-assets`; `publish` (solo push, depende de `assemble`) ejecuta `gh release create v<versión> --draft --verify-tag --target $GITHUB_SHA` con esos archivos.
- Estado en el repositorio: en la rama, `.github/workflows/` solo contiene `ci.yml`; el `release.yml`, `scripts/release-version.ts` (en árbol de trabajo, sin commit) y las acciones pinneadas aún no están verificadas con una ejecución real.
- Repo público: el release se crea siempre como draft. Nunca se publica desde el flujo automatizado. La publicación es una acción manual del propietario.

#### Endurecimiento del release

- **Environment `release` (M1).** `publish` declara `environment: release`; GitHub lo crea solo en la primera ejecución. El workflow no configura protecciones. Acción pendiente del usuario: crear un ruleset de etiquetas `v*` (restringir creación, actualización y borrado) y añadir required reviewers al environment `release`, de modo que ningún push de etiqueta publique sin aprobación humana.
- **Sin caché de dependencias en build (M2).** Se quitó `Swatinem/rust-cache` del job `build` de release: una caché de rama por defecto envenenada podría terminar en los instaladores publicados.
- **Estructura del artefacto (L2).** `assemble` valida el conjunto exacto de instaladores y `SHA256SUMS` también en `workflow_dispatch`, así el dry run ejercita todo menos `gh release create`.
- **`--verify-tag` (L3).** `gh release create` falla si la etiqueta no existe en el remoto, en lugar de crearla.
- **Artefactos de dispatch.** Los artifacts de una ejecución por `workflow_dispatch` (`installers-*`, `release-assets`) son descargables por cualquier usuario autenticado con acceso de lectura al repositorio durante 7 días de retención.
- **Sin attestations.** No se usan attestations de procedencia (`actions/attest-build-provenance`): sin firma de código ni verificación del lado del usuario en la guía, añadirían una garantía que nadie comprobaría; queda fuera de alcance y se reconsiderará junto con la firma de desarrollador (D17).

### DB12. Fallo de arranque (`src-tauri/src/lib.rs`, `setup.rs`)

- `run()` envuelve `setup::init` con `guarded_setup`. Si el arranque falla: `eprintln!("application setup failed: …")` y se llama a `report_startup_failure`.
- `report_startup_failure` lanza un hilo (`present_then_exit`) que muestra un diálogo nativo de tipo error con `blocking_show`, título `Spa no pudo iniciar` y mensaje `La aplicación no pudo abrir sus datos y se cerrará. Abre el Manual de usuario que recibiste con el instalador: en la sección "Si la aplicación no abre" se explica cómo apartar la carpeta de datos y restaurar un respaldo en el primer arranque.` El mensaje no cita rutas del repositorio porque quien instala la app no las tiene: el Manual de usuario debe entregarse junto al instalador (USB). Después llama a `exit(1)`. Si el diálogo entra en pánico, se registra y el hilo sale igualmente.
- Si la construcción de Tauri falla (`start` devuelve error), no hay diálogo: `eprintln!` y `exit(1)`.
- Causas que llegan a este diálogo: directorio de datos no creable, keychain no disponible (`init_native_store`), `MissingForExistingDb`, BD no abre con la clave (`NotADatabase` u otro), fallo de la copia previa a migrar (`SnapshotError`), fallo de migración, fallo de recuperación de DB6.

### Dependencia de no usar WAL

- La exportación copia `spa.db` bajo el mutex, sin sqlcipher_export. Es consistente solo si todas las escrituras están confirmadas en `spa.db` cuando el mutex está tomado.
- Con journal de rollback (modo por defecto, sin `journal_mode` en el código), cada transacción confirmada está en el archivo principal. Un `-journal` caliente solo existe durante una escritura o tras un corte; `open_encrypted` lo resuelve al abrir.
- Si alguien activa WAL (`PRAGMA journal_mode=WAL`), las páginas confirmadas pueden quedar en `spa.db-wal` y la copia de `spa.db` sería incompleta. Cambiar a WAL requiere revisar `read_export_snapshot`, `swap` y `recovery`, y añadir una prueba que lo detecte. Los sidecars `-journal`, `-wal` y `-shm` se tratan en `discard_with_sidecars` por esta razón.

## Consecuencias

- **M3, restauración reemplaza todo.** La restauración sustituye todos los datos y la clave actual. La UI muestra el aviso "Atención: acción irreversible", el aviso de que se recomienda exportar antes (con enlace a "Exportar respaldo") y exige marcar "Entiendo que se reemplazarán todos los datos actuales". Tras el éxito se borran `.prev` y los snapshots `spa.db.*.v<n>.bak`. La clave anterior no se conserva. No hay forma de volver al estado previo una vez confirmado el éxito.
- **Restauración sin sesión en primer arranque.** La ruta `/setup/restaurar` se enlaza desde el formulario de creación de Propietaria ("Restaurar desde un respaldo"). Tras el éxito, el front limpia la caché (`queryClient.clear()`) y redirige a `/login?restored=1`. El aviso "Respaldo restaurado. Inicia sesión con una cuenta del respaldo." depende de un flag en memoria del proveedor de sesión (`markRestored`); no se persiste. Si la página se recarga antes de llegar al login, el aviso no aparece.
- **Auditoría.** `backup_created` y `backup_restored` son las únicas fuentes del estado del banner. Un respaldo exportado o una restauración exitosa reinician el ciclo de 7 días.
- **Nuevos comandos IPC.** `export_backup`, `restore_backup` y `get_backup_status`: 49 comandos en total (46 de la Fase 7 más 3).
- **Permisos.** Sin migración nueva: `backup.manage` y las acciones `backup_created` y `backup_restored` ya existían desde la Fase 2 (migración 0001 y CHECK de 0005).
- **Dependencias Rust nuevas:** `chacha20poly1305` `=0.11.0` y `tauri-plugin-dialog` `=2.8.4`. `argon2`, `zeroize`, `getrandom` y `unicode-normalization` ya estaban fijadas y ahora se usan con las features `password-hash`, `getrandom` y `zeroize`.
- **Pins verificados por test:** `src-tauri/tests/manifest_pins.rs` cuenta los pins exactos; la suite de integración pasa con las dos dependencias nuevas (ejecución de `cargo test --locked` de esta sesión).

## Límites

- **L1. Dependencia de no WAL.** Ver sección anterior. Un cambio de modo de journal invalida la exportación sin que el compilador lo avise.
- **L2. Frase y corrupción indistinguibles.** `BackupUnreadable` cubre frase incorrecta y archivo dañado. Es intencional (DB9).
- **L3. Sin límite de intentos ni throttle sobre la frase del respaldo.** Un archivo robado puede someterse a fuerza bruta offline, limitada solo por argon2id (m hasta 131072 KiB, t hasta 6 en importación, m=65536 y t=3 en exportación). La frase mínima (12 code points) es el único freno; no hay medición de su fortaleza real.
- **L4. Restauración cortada tras instalar con clave nueva igual a la vieja.** Si el proceso se corta después de S4 y la clave del respaldo coincide con la clave actual (p. ej. restaurar un respaldo del mismo equipo), al siguiente arranque `recover_interrupted_restore` ve que la clave principal abre `spa.db` y limpia sin registrar `backup_restored`. El estado queda como completado, pero sin la auditoría de restauración.
- **L5. Diálogo nativo y bloqueo de sesión.** Si el diálogo nativo permanece abierto más de 10 minutos sin actividad, la sesión se bloquea. Rust reautoriza al entrar a `with_conn`, la operación falla con `sessionLocked` y el panel se desmonta, perdiendo el mensaje de resultado. Nada se filtra ni queda a medias. El usuario desbloquea y repite, y el banner y el estado del respaldo reflejan el resultado real. El front no puede mantener viva la sesión durante un diálogo nativo sin una API de latido dedicada.
- **L6. Archivos sobrantes de exportación no se limpian al arrancar.** `recover_interrupted_restore` solo revisa `.prev` y `.restoring`. Quedan sin limpieza automática: `<destino>.partial-*` y `<destino>.replaced-*` tras un corte del proceso durante la exportación, y `spa.db.<stamp>.failed` (la BD fallida de DB6 d) que se conserva para diagnóstico.
- **L7. Restaurar un respaldo no garantiza el estado previo.** Tras el éxito no hay rollback (M3).
- **L8. Límite de tamaño.** 256 MiB por respaldo. Una BD mayor no se puede exportar (`TooLarge`, `internal`).
- **L9. `get_backup_status` depende de la auditoría.** Si alguien purgara `audit_log` (no existe comando para ello; el trigger lo impide), el banner volvería a mostrar "nunca exportado".
- **L10. WebView2 con `downloadBootstrapper`.** Si el equipo no tiene WebView2, el instalador lo descarga y necesita internet durante la instalación. Ese supuesto se confirma en la prueba en máquina limpia. En Windows 11 el runtime suele estar presente (supuesto; no verificado en esta sesión). Este requisito de red es solo del instalador, no de la app en uso.
- **L11. Instaladores MSI y NSIS.** Ambos se publican porque el usuario lo eligió (Q1). Duplican el mantenimiento de instalación y el número de hashes a verificar.
- **L12. Release en draft en repo público.** El release es visible para quien vea el repositorio. Los instaladores y `SHA256SUMS` son públicos cuando el draft se publica; la publicación es manual. El repositorio es público, así que cualquiera con acceso puede descargar un draft publicado.
- **L13. Gatekeeper en macOS 15 y posterior.** Desde macOS 15, clic derecho → Abrir ya no permite la primera apertura de una app sin notarizar. Hay que usar Ajustes del Sistema > Privacidad y seguridad > "Abrir igualmente", o `xattr -dr com.apple.quarantine <ruta de Spa.app>`. El criterio de salida de la Fase 8 en `docs/planeers/plan-mvp.md` se corrigió en consecuencia.
- **L14. Desviación de `tauri-action`.** El flujo propio (DB11) implica mantener las acciones pinneadas por SHA y el script de verificación de versiones. Si `tauri-action` cambia su contrato de release, no se recibe la actualización automáticamente.
- **L15. Lo que este ADR no verifica.** Instalación en máquinas limpias Windows 10/11 y macOS, comportamiento real de SmartScreen y Gatekeeper, firma ad-hoc en un Mac real, release real en draft, restauración entre sistemas operativos (Windows a macOS y viceversa), comportamiento de la app sin red. Estas pruebas dependen de máquinas físicas o de un Mac y figuran en `docs/qa/checklist-instalacion.md`.
- **L16. Fallos de keychain no resueltos por el procedimiento del diálogo.** Si el keychain del sistema no está disponible, el arranque falla con el mismo diálogo, pero apartar la carpeta de datos no lo soluciona. Ver la sección "Si la aplicación no abre" del Manual de usuario (`docs/manual-usuario.md` en el repositorio).
