# ADR 0004: Sesión bloqueable, autorización, auditoría de solo inserción y slices de usuarios

- **Estado:** Aceptada
- **Fecha:** 2026-11-17
- **Fase:** 2 (slices S0 a S11; este ADR se redacta en S12)
- **Fuentes:** `docs/planeers/plan-mvp.md` (D4, D12, D13, D15, "Seguridad (offline)"), `docs/adr/0001-arquitectura.md`, `docs/adr/0002-cifrado-y-respaldo.md` (puntos 6, 7, 9, 10), `docs/adr/0003-fechas-y-moneda.md` (D11). Decisiones Q, H y DN: run `run-mwl82rzf-9e36e59e` (plan de Fase 2) y confirmaciones del humano en el run `run-mwl97chk-34401dcd`

## Contexto

- La sesión vive en memoria de Rust (`SessionState`), no en el webview. D12 exige que el bloqueo invalide la sesión en Rust y no solo la pantalla.
- Fase 2 añade bloqueo por inactividad y por reanudación del equipo, auditoría de solo inserción, gestión de usuarios y roles, primer arranque con Propietaria y recuperación de contraseña.
- Fuera de Fase 2: visor de auditoría en la UI (el comando `list_audit` existe, sin pantalla), administración de usuarios y roles en la UI, respaldo y restauración (D14, Fase 8), y auditoría de entidades de negocio.

## Decisión

1. **Estado de sesión en Rust (`features/auth/service.rs`).**
   - `SessionState(Mutex<Option<ActiveSession>>)`. `ActiveSession` guarda `user`, `last_activity: Instant`, `last_beat: Beat` y `locked: bool`.
   - `Beat { mono: Instant, wall: SystemTime }` es la entrada temporal de cada observación.
   - `SessionView { status: active | locked, user? }` es lo que devuelven los comandos. Una vista `locked` lleva `user = None` (DN1). `Observation { view, locked_now: Option<LockReason> }` indica si la observación acaba de bloquear y por qué. `LockReason` es `Idle` o `Resume`.
   - Bloqueo por inactividad: `IDLE_TIMEOUT` = 10 min medidos con el reloj monotónico desde `last_activity`.
   - Bloqueo por reanudación: `resumed_between(last_beat, beat)` (ADR 0002, punto 6). Tiene prioridad sobre el bloqueo por inactividad (`lock_if_resumed` se evalúa antes).
   - `observe` no extiende la actividad. Solo `record_activity` la extiende, y únicamente si tras observar la sesión sigue `Active` (DN10). Los comandos protegidos tampoco extienden la inactividad.
   - Una sesión `locked` solo sale del estado con `unlock` (reautenticación del mismo usuario) o con `end`.
2. **Disparadores del estado (Q3, Q4, Q5).**
   - Latido de Rust: hilo `spawn_heartbeat` cada 15 s (`HEARTBEAT_INTERVAL`), dentro de `Database::with_tx`.
   - Front: `SESSION_POLL_INTERVAL_MS` = 15 s en `src/lib/session.tsx`, solo con estado `signedIn`. No hay eventos push desde Rust.
   - Actividad: `record_activity` desde `useActivityTracker` (`src/features/auth/hooks/use-activity-tracker.ts`), escuchando `pointerdown` y `keydown`, con throttle `ACTIVITY_THROTTLE_MS` = 30 s.
3. **Desbloqueo (`unlock`, `features/auth/commands.rs`).**
   - `locked_user_for_unlock` exige una sesión `locked`. Si la sesión está activa, responde `Validation("password")`. Si no hay sesión, responde `Unauthenticated`.
   - `authenticate_unlock` usa el mismo `LoginThrottle` en memoria y la misma tabla `login_throttle` que el login. Un usuario inactivo o inexistente termina la sesión.
   - Éxito: `complete_unlock` limpia los fallos persistidos, audita `session_unlocked` y reinicia `last_activity` y `last_beat`.
4. **Autorización (`require_permission`, `features/auth/service.rs`).**
   - `active_user` observa la sesión, audita `session_locked` si la observación bloqueó, vuelve a leer el usuario activo y sus permisos desde la BD, y refresca la sesión en memoria.
   - En todos los comandos protegidos, `require_permission` se invoca con `Database::with_conn` **antes** de cualquier `with_tx`:
     - Usuarios (`features/users/commands.rs`): `authorize` y después la escritura en `Database::with_tx`.
     - Auditoría (`features/auth/audit_commands.rs`): `list_audit` llama a `read_page` dentro de `with_conn` (sin transacción) y solo después lee.
   - `current_session`, `record_activity` y `unlock` (`locked_user_for_unlock`) usan `with_tx` a propósito: son los comandos que observan la sesión y auditan el bloqueo. Devuelven `Ok(Some(locked))` en lugar de error cuando la sesión está bloqueada, para que la transacción haga commit y la fila `session_locked` se conserve.
   - `Database::with_tx` abre transacciones `IMMEDIATE`. Si el closure entra en pánico, `abandon_open_transaction` hace `ROLLBACK` y devuelve `DbError::OperationPanicked`.
   - Los permisos son `PermissionKey` (15 claves, `features/auth/model.rs`). Se validan en Rust en cada comando.
5. **Auditoría (`features/audit/`).**
   - `audit::record(conn: &Connection, &NewAuditEntry)` es una función libre que inserta una fila. No abre transacción propia: la atomicidad viene de llamarla dentro de la `with_tx` de la acción que audita (Q2).
   - Catálogo: 16 acciones fijas (`AuditAction::ALL`, mismas que el CHECK de `0003_audit_log.sql`): `login_succeeded`, `logout`, `login_failed`, `login_locked_out`, `session_locked`, `session_unlocked`, `unlock_failed`, `owner_created`, `recovery_used`, `recovery_failed`, `user_created`, `user_updated`, `password_reset`, `role_created`, `role_permissions_changed`, `clock_rollback`.
   - Entidades: `user`, `role`, `system`.
   - Diff: `Diff::between` (antes y después por campo), `Diff::created` (snapshot de alta) y `Diff::note` (texto corto). Toda clave de `FORBIDDEN_DIFF_KEYS` se filtra en cualquier nivel (ADR 0002, punto 10).
   - `AuditEntry.diff` viaja como `Option<String>` con el JSON crudo (DN3). Así no se activa la feature `serde_json` de specta.
   - Paginación de `list_audit`: tamaño máximo `MAX_AUDIT_PAGE` = 200 (DN8).
6. **Qué se audita y qué no (Q9).**
   - Se audita: éxitos y fallos de login, unlock y recuperación; bloqueos (`login_locked_out` cuando se alcanza el umbral persistido); bloqueos de sesión; logout; alta de la Propietaria; cambios de usuarios y roles; reinicios de contraseña por un administrador; y `clock_rollback`.
   - No se audita:
     - `forbidden` (`AuthError::Forbidden` de `require_permission`).
     - Login con un nombre de usuario desconocido: ni se audita `login_failed` ni se persiste fallo alguno (DN9). `reject_login` solo actúa si existe `known_user_id`. Consecuencia: se pierde trazabilidad forense a cambio de no guardar en la BD lo tecleado en el campo de usuario, que podría ser una contraseña. `recover_with` tampoco audita nombres inexistentes.
     - Intentos durante un bloqueo persistido: en login, unlock y recuperación el bloqueo se comprueba antes del intento y responde sin auditar.
     - Intentos rechazados por el throttle en memoria (`reserve_attempt` devuelve `Denied`): responden `InvalidCredentials` sin fila de auditoría.
7. **Catálogo de eventos auditados.** Actor = `actor_user_id`; entidad = `entity` / `entity_id`.

| Acción | Actor | Entidad (`entity_id`) | Diff | Origen |
|---|---|---|---|---|
| `login_succeeded` | usuario | `user` (id del usuario) | ninguno | `login` (transacción `sign_in_audited`) |
| `login_failed` | NULL | `user` (id, solo usuario existente) | ninguno | `login` (`reject_login`) |
| `login_locked_out` | NULL | `user` (id) | ninguno | al alcanzar el umbral en login, unlock o recuperación |
| `logout` | usuario | `user` (id) | ninguno | `logout` |
| `session_locked` | usuario | `user` (id) | `note`: `idle` o `resume` | `observe` (`session_locked_if_new`) |
| `session_unlocked` | usuario | `user` (id) | ninguno | `unlock` |
| `unlock_failed` | usuario | `user` (id) | ninguno | `unlock` |
| `owner_created` | usuario (la propia Propietaria) | `user` (id) | creado: `username`, `roleId` | `setup_owner` |
| `recovery_used` | usuario | `user` (id) | ninguno | `recover_password` |
| `recovery_failed` | NULL | `user` (id, solo usuario existente) | ninguno | `recover_password` |
| `user_created` | administrador | `user` (id nuevo) | creado: `username`, `roleId`, `active` | `create_user` |
| `user_updated` | administrador | `user` (id) | diff de `username`, `roleId`, `active` | `update_user` |
| `password_reset` | administrador | `user` (id del objetivo) | ninguno | `reset_user_password` |
| `role_created` | administrador | `role` (id) | creado: `name`, `permissions` | `create_role` |
| `role_permissions_changed` | administrador | `role` (id) | diff de `permissions` | `set_role_permissions` |
| `clock_rollback` | NULL | `system` (sin id) | creado: `lastRecordedAt`, `detectedAt` (locales) y `lastRecordedAtUtc`, `detectedAtUtc` (UTC, ADR 0005) | arranque (`setup::bootstrap`) |

8. **Slices separados (Q1).** `features/users/` (`commands`, `service`, `repository`, `model`) y `features/audit/` (`commands`, `model`, `repository`, `clock`) son slices propios. `features/auth/` no contiene gestión de usuarios.
9. **Guarda del último administrador (postcondición).** `ensure_admin_remains` cuenta usuarios activos con un rol que tenga `users.manage` (`count_active_admins`). Se ejecuta **después** de aplicar el cambio y **dentro** de la misma transacción. Si la cuenta queda en cero, devuelve `UsersError::LastAdmin` y la transacción no se confirma. Aplica a `update_user` (desactivar o cambiar de rol) y a `set_role_permissions`.
   - `set_role_permissions` no permite quitar `users.manage` al rol de la Propietaria (`OWNER_ROLE_ID` = 1).
   - Un usuario inexistente en `update_user`, `reset_user_password` u otras operaciones del slice se reporta como `validation` con `field` (`userId`), sin código `notFound` (DN2).
10. **Primer arranque (`features/auth/owner_setup.rs`).**
    - `ensure_setup_open` comprueba `count_users == 0` con `with_conn`.
    - `register_owner` vuelve a comprobar `count_users` **dentro** de `with_tx`. Si ya hay usuarios, responde `SetupClosed` (mapeado a `forbidden`).
    - Hash de la contraseña y del código de recuperación en `spawn_blocking`, fuera del lock de la BD.
    - Tras el alta, la sesión queda iniciada con `session.start`.
11. **Datos de desarrollo (`dev_seed.rs`).** Solo en `cfg(debug_assertions)`, y solo si `SPA_DEV_SEED_PASSWORD` está definida (mínimo 12 caracteres). Crea `propietaria`, `recepcion` y `lectura` si no hay usuarios. Con esos usuarios `needsOwner` es `false`. La cuenta sembrada no tiene código de recuperación.
12. **Contrato IPC (tauri-specta, `lib.rs`).**
    - 16 comandos: `login`, `logout`, `current_session`, `record_activity`, `unlock`, `setup_status`, `setup_owner`, `recover_password`, `list_users`, `create_user`, `update_user`, `reset_user_password`, `list_roles`, `create_role`, `set_role_permissions`, `list_audit`.
    - Cambio incompatible: `current_session` devolvía `Option<SessionUser>` en `main` y ahora devuelve `Option<SessionView>`. Consumidores actualizados en S11: `src/lib/session.tsx`, `src/features/auth/api.ts`, shim IPC y e2e.
    - `AppErrorCode` suma `SessionLocked` (serializado como `sessionLocked`). Los errores de validación llevan `field` y un mensaje genérico.
13. **Front (S11).**
    - `src/lib/session.tsx`: estados `loading | signedIn | locked | signedOut`. Al salir de `signedIn` vacía la caché de consultas con `queryClient.clear()`.
    - `src/features/auth/api.ts`: `syncMockSession` mantiene el mock sincronizado con la sesión de Rust. Si el usuario de Rust no está en el mock, `registerInMock` lo da de alta. Una vista `locked` no sincroniza el mock.
    - Pantallas: `src/features/auth/components/lock-screen.tsx`, `setup-owner-form.tsx`, `recover-form.tsx`, `recovery-code-panel.tsx`, `clock-rollback-banner.tsx`; rutas `src/app/(auth)/setup`, `src/app/(auth)/recover` y `src/app/(auth)/login`.
    - Tras `recover_password` con éxito, el front navega a la pantalla de login (`router.replace(ROUTES.login)`) y no inicia sesión (DN6).
    - `ClockRollbackBanner` mínimo en la pantalla de login (DN7).
    - Sin pantalla de administración de usuarios ni visor de auditoría (Q10).
14. **Decisiones confirmadas por el humano.** Elecciones registradas en el plan del run (Q, H) y en la conversación del run `run-mwl97chk-34401dcd` (DN).

| Id | Tema | Elección |
|---|---|---|
| Q1 | Slice de usuarios | `features/users/` separado de `features/auth/` |
| Q2 | Auditoría | `audit::record` libre, dentro de `Database::with_tx` |
| Q3 | Bloqueo de sesión | Estado `Locked` en Rust y polling de 15 s sin eventos push |
| Q4 | Reanudación | Latido con reloj monotónico y de pared |
| Q5 | Actividad | `record_activity` explícito; `observe` no extiende |
| Q6 | Copias previas a migrar | Retención de 3 |
| Q7 | Contraseña | Mínimo 10 caracteres, sin reglas de composición |
| Q8 | Lockout | Persistente para usuarios existentes |
| Q9 | Forbidden | No se audita |
| Q10 | Front | Solo pantallas de bloqueo, primer arranque y recuperación |
| Q11 | Marcas de auditoría | `occurred_at` local con segundos (solo mostrar) y `occurred_at_utc` ISO UTC con ms y `Z` (comparar); ADR 0005 |
| H4 | Código de recuperación | Base32 manual sobre `getrandom`, sin crate |
| DN1 | Vista de sesión bloqueada | `SessionView` locked con `user = None`; la pantalla de bloqueo no muestra el nombre |
| DN2 | Usuario no encontrado en `users` | Se reporta como `validation` con `field`, sin código `notFound` |
| DN3 | Diff en la lectura de auditoría | `AuditEntry.diff` viaja como `Option<String>` con JSON crudo; no se activa la feature `serde_json` de specta |
| DN4 | Poda de copias `.bak` | Un fallo al podar copias viejas no bloquea (`eprintln`); la copia nueva sí es fail-closed |
| DN5 | Código de recuperación | Existe solo para la Propietaria; los demás usuarios se recuperan con `reset_user_password` de un administrador |
| DN6 | `recover_password` | Sin sesión; devuelve el código nuevo; el front lleva al login |
| DN7 | Aviso de retroceso de reloj | Banner mínimo `clockRollback` en la pantalla de login |
| DN8 | Constantes | `HEARTBEAT_SLACK` = 30 s, `MAX_HEARTBEAT_GAP` = 120 s, `ACTIVITY_THROTTLE_MS` = 30 s, `MAX_AUDIT_PAGE` = 200 |
| DN9 | Login con usuario desconocido | No se audita `login_failed` ni se persiste fallo; se acepta perder trazabilidad forense para no guardar lo tecleado en el campo de usuario |
| DN10 | Inactividad | Solo `record_activity` extiende la inactividad; los comandos protegidos no la extienden |

## Alternativas descartadas

- **Eventos push de Rust al front para bloqueo (Q3).** Descartado: el front consulta cada 15 s. El bloqueo sigue siendo efectivo en Rust aunque el front no consulte, porque el latido corre en Rust.
- **Bloqueo solo por reloj de pared o solo por monotónico (Q4).** Se usan los dos criterios (ADR 0002, punto 6). Cada reloj falla en un caso distinto.
- **Extender la actividad en cada observación (Q5).** Descartado: cualquier consulta del front extendería la sesión, incluido el polling de 15 s. Solo `record_activity` la extiende.
- **Auditoría con transacción propia (Q2).** Descartado en favor de `audit::record` libre dentro de la transacción de la acción: la auditoría y la acción se confirman o se revierten juntas.
- **Gestión de usuarios dentro de `features/auth/` (Q1).** Descartado: `auth` ya concentra login, sesión, recuperación y primer arranque.
- **Bloqueo solo en memoria para usuarios existentes (Q8).** Descartado: se pierde al reiniciar. Se persiste en `login_throttle`.
- **Auditar `forbidden` (Q9).** Descartado: genera ruido sin cambio de datos.
- **Validar el bloqueo de sesión solo en el front.** Descartado por D12: el bloqueo debe invalidar la sesión en Rust.
- **Reglas de composición de contraseña (Q7).** Descartado: solo longitud mínima.
- **Crate de base32 para el código de recuperación (H4).** Descartado: el alfabeto son 32 símbolos y 5 bits por símbolo sobre `getrandom`.

El run registra la elección de cada decisión, no el motivo del descarte. Las alternativas anteriores se infieren de la formulación de cada decisión.

## Consecuencias

- Una sesión bloqueada responde `sessionLocked` en los comandos protegidos y el front muestra la pantalla de bloqueo. El bloqueo no depende de que el front esté activo.
- El polling de 15 s y el latido de 15 s hacen que el bloqueo por inactividad se aplique con hasta 15 s de retraso.
- Los permisos se comprueban antes de la escritura y no se revalidan dentro de ella (ver límites).
- La auditoría de un cambio y el cambio son atómicos: si la auditoría falla, el cambio se revierte.
- La guarda del último administrador es atómica con el cambio que la podría violar.
- `current_session` cambia de forma. Cualquier consumidor externo de `bindings.ts` debe actualizarse.
- La Propietaria puede quedar sin acceso si pierde contraseña y código; la salida es que otra cuenta con `users.manage` la restablezca (ADR 0002, consecuencias).
- Los datos del run (Q, H, DN) están en este ADR para que el razonamiento sobreviva a la conversación.

## Límites conocidos

- **Ventana entre `authorize` y `with_tx`.** En los comandos de usuarios, la comprobación de permisos y la escritura son transacciones distintas. Un cambio concurrente de permisos del actor no se revalida dentro de la escritura. La postcondición de último administrador sí es atómica con su cambio.
- **Transición de bloqueo con auditoría fallida.** Si `audit::record` falla en el momento en que la sesión pasa a `Locked`, la transición ya está aplicada en memoria, el comando devuelve `Internal` (fail-closed) y la fila `session_locked` no se escribe. El motivo queda en `audit_pending` y la siguiente observación de la misma sesión lo reintenta (ver notas de revisión).
- **Auditoría en autocommit fuera de transacción.** `require_permission` corre con `with_conn` en `authorize` (usuarios) y en `list_audit`, sin transacción. Una fila `session_locked` escrita ahí se confirma sola y se conserva aunque el comando devuelva `sessionLocked`. No comparte transacción con la acción posterior. Cubierto por `list_audit_locked_session_audits_session_locked_once_and_keeps_the_row` y `list_audit_second_call_while_locked_does_not_duplicate_the_audit_row` (`features/auth/audit_commands_test.rs`).
- **Un `clock_rollback` por arranque.** Mientras el retroceso persista, cada arranque registra otro evento. No hay deduplicación.
- **La auditoría no es a prueba de manipulación.** Quien tenga la clave de la BD puede abrirla con SQLCipher y eliminar los triggers o reescribir filas. Los triggers protegen frente a SQL ordinario, no frente a quien controla el archivo y la clave. Es un control de integridad, no anti-manipulación.
- **Lockout persistente con reloj de pared (UTC).** `login_throttle` compara `locked_until_utc` y `last_failure_at_utc` en UTC (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`, ADR 0005). El cambio de horario (DST) no altera el vencimiento. Un cambio manual del reloj del sistema sí lo altera: adelantar el reloj para vencer un bloqueo persistido no se detecta (la detección de `clock_rollback` corre solo al arranque y solo mira `audit_log`, con tolerancia de 300 s). Es una decisión de alcance del modelo de amenazas: quien controla el reloj del sistema ya tiene acceso local (ADR 0005, "Límites"). El throttle en memoria usa `Instant` y no tiene ese problema.
- **Throttle en memoria con capacidad limitada.** Con `MAX_TRACKED` = 1024 claves, si la tabla está llena se evicta la entrada no bloqueada con menos fallos (ver notas de revisión). No es un límite global de intentos.
- **Intentos rechazados por el throttle en memoria no se auditan** (decisión 6).
- **"Solo Propietaria" es por datos, no por comprobación de rol.** `recover_with` no valida el rol. Una Propietaria que cambie de rol conserva la posibilidad de recuperación, porque conserva su `recovery_code_hash`.
- **`reset_user_password` no está limitado a la Propietaria.** Lo puede ejecutar cualquier cuenta activa con `users.manage` (por defecto solo la Propietaria). D13 dice "otros usuarios los restablece la Propietaria"; el código aplica el permiso, no el rol.
- **Filtro de diff por claves exactas.** La comparación es sobre la clave normalizada completa. Una clave como `keyId` no se filtra.
- **Latido sin test de hilo.** `spawn_heartbeat` no tiene test de integración. Cubren `tick`, `run_tick` y `resumed_between` (`features/auth/heartbeat_test.rs`).
- **Mensaje de validación por campo.** `AppError` de validación lleva `field` y un mensaje genérico. El texto por campo se resuelve en la UI a partir de `field`.
- **Cobertura de auditoría.** Solo auth, sesión, usuarios, roles y reloj. Las entidades de negocio no tienen auditoría todavía.
- **Código de recuperación como `String` en IPC** (ADR 0002, punto 7).
- **Permisos en Windows.** `restrict_to_owner` no restringe permisos fuera de Unix, y los `.bak` tampoco reciben modo `0600`. La protección depende de la ACL heredada del perfil y del cifrado SQLCipher. Límite, condición para endurecer y amenaza abierta en ADR 0002, punto 11.

## Notas de revisión y límites residuales

- **Orden de capas.** `audit` es módulo hoja: no importa `features::auth` ni `super::auth`. `auth` depende de `audit` (`events.rs` llama a `audit::record`; `auth/model.rs` usa `audit::ClockRollback`). Lo fija el test `audit_is_a_leaf_module_that_never_imports_auth` (`features/audit/mod_test.rs`), que recorre los archivos de `src/features/audit/` y falla si aparece `features::auth` o `super::auth`.
- **`audit_pending`.** Si `audit::record` de `session_locked` falla (`events::session_locked_if_new`), `SessionState::restore_audit_pending` guarda el motivo solo si la sesión sigue bloqueada y es del mismo usuario. La siguiente observación lo consume con `audit_pending.take()` y reintenta la auditoría una vez. Test: `restored_audit_pending_is_reported_by_the_next_observation_only_once` (`features/auth/service_session_test.rs`).
- **Recuperación de envenenamiento de `SessionState`.** `SessionState::lock` limpia el veneno del `Mutex` y descarta la sesión (`*guard = None`): tras un pánico en un comando, el estado queda sin sesión y no se conserva una sesión posiblemente incoherente. Test: `poisoned_session_lock_recovers_as_signed_out_and_accepts_a_new_session`.
- **Usernames.** `normalized_username` hace `trim` y NFC. `is_allowed_username_character` rechaza `Cc` (`is_control`), los rangos de formato `Cf` (`FORMAT_CHARACTER_RANGES`) y los separadores `Zl`, `Zp` y `Zs` (`SEPARATOR_RANGES`), salvo U+0020 (espacio ASCII, permitido). Verificado con `unicodedata` de Python (Unicode 15.1): no hay categorías Cc/Cf/Zl/Zp/Zs fuera de las tablas ni rangos de las tablas fuera de esas categorías, salvo U+0020.
  - Comparación: `unicode_casefold` es NFC + `to_lowercase` + NFC; no es case folding Unicode completo. Se usa en la unicidad de alta y renombrado (`folded_username_taken`, `features/users/repository.rs`).
  - Login: `find_credentials_by_username` usa `WHERE u.username = ?1 COLLATE NOCASE` (`features/auth/repository.rs`). SQLite pliega solo ASCII. Consecuencia: un nombre que solo difiere en mayúsculas no ASCII (p. ej. `Ó`/`ó`) no encuentra la cuenta y el login falla (fail-closed). No hay colisiones de cuentas, porque el alta sí rechaza la variante plegada.
- **Invariante: nunca retener `Database` a través de un `await`.** `Database::with_conn` y `with_tx` toman un `MutexGuard` interno durante la operación, que no es `Send`; mantenerlo vivo en un `await` de un comando async no compila. El hash y la verificación van fuera del lock con `spawn_blocking` (`verify_off_the_database_lock` en `features/auth/commands.rs`; `hash_off_the_database_lock` en `features/users/commands.rs`). No hay test específico: la garantía es de tipos.
- **Logging con `eprintln!`.** No hay dependencia `tracing` ni `log` en `src-tauri/Cargo.toml`. Los puntos actuales son `lib.rs`, `features/auth/heartbeat.rs`, `features/auth/service.rs`, `features/users/model.rs` y `db/snapshot.rs`. La migración a `tracing` queda para una fase posterior.
- **`freezePrototype` no implementado.** No hay ocurrencias en el repositorio. Requiere smoke test con GUI; queda para una fase posterior.
- **`Database::with_conn_mapped` (aditivo).** `with_conn` delega en `with_conn_mapped` (`db/connection.rs`), que permite a un comando devolver su propio error de dominio desde el closure. Lo usan `features/users/commands.rs` (`authorize`). El comportamiento de `with_conn` no cambia.
- **Política de evicción del throttle.** `LoginThrottle::make_room` (`features/auth/throttle.rs`) actúa solo si la tabla tiene `MAX_TRACKED` (1024) claves:
  1. Purga las entradas caducadas.
  2. Si sigue llena, evicta la entrada no bloqueada con menos fallos; a igualdad, la del último fallo más antiguo.
  3. Solo si todas las entradas están bloqueadas, evicta la que expira antes (`locked_until` mínimo).
  Una clave nueva nunca recibe `Denied` por capacidad: `make_room` deja hueco antes de insertar. Las entradas evictadas pierden su contador en memoria. El bloqueo persistido de usuarios existentes (`login_throttle`, Q8) no depende de esta tabla.
- **Límite de concurrencia de argon2.** `MAX_CONCURRENT_OPERATIONS` = 2 (`features/auth/password.rs`). `ConcurrencyLimit::acquire` (`features/auth/concurrency.rs`) espera con `Condvar` hasta liberar un permiso; el permiso se libera en `Drop`. Tests: `hash_waits_for_a_free_slot` y `verify_waits_for_a_free_slot` (`features/auth/password_test.rs`).
- **Sesión previa en login (fail-closed).** `sign_in_audited` (`features/auth/commands.rs`) captura el id previo con `SessionState::current_user_id()` y audita `logout` y `login_succeeded` dentro de `with_tx`, sin mutar la sesión en memoria dentro de la transacción. Si la transacción falla, la BD revierte ambas filas y la sesión previa se conserva; el reemplazo ocurre después del commit. Test: `failing_login_audit_keeps_the_previous_session_and_leaves_no_orphan_logout`.
- **`actor_username` muestra el nombre actual.** `audit` hace `LEFT JOIN users` (`features/audit/repository.rs`). `actor_user_id` es el histórico; el nombre mostrado es el del usuario en el momento de la lectura, no el del evento.
- **CSP.** `style-src 'self' 'unsafe-inline'` se mantiene en `src-tauri/tauri.conf.json`, por los atributos `style` prerenderizados (ADR 0001). `script-src 'self'` no admite `unsafe-inline` en el build.
- **Banner de retroceso de reloj.** `ClockRollbackBanner` solo se renderiza en la pantalla de login (`src/app/(auth)/login/page.tsx`). El resto de la app no muestra el aviso; el evento queda en auditoría.
- **Poda de copias `.bak`.** `SNAPSHOT_RETENTION` = 3 (`db/snapshot.rs`): quedan la copia recién creada y las dos anteriores más recientes. `stale_snapshots` excluye siempre la copia recién creada (`newest`). La copia nueva es fail-closed: si `copy_exclusive` falla, `snapshot_before_migrate` devuelve error, `setup.rs` lo propaga como `SnapshotError` y no se migra. La poda de copias antiguas es best-effort: un fallo se registra con `eprintln!` y no bloquea (DN4).
- **Tiempo.** Las comparaciones de bloqueo persistido y de retroceso de reloj pasan a UTC; ver ADR 0005.
- **Permisos de gestión de usuarios.** `users.manage` es control total de usuarios y roles; ver ADR 0006.

## Decisiones y límites residuales de la auditoría de Fase 2

Verificado contra el código de la Fase 2 con grep y lectura de `src-tauri/src/features/auth/` y `.github/`.

### Throttle en memoria por nombre de usuario (ITEM-13)

- **Decisión.** `LoginThrottle` (`features/auth/throttle.rs`) indexa por el nombre normalizado en minúsculas (`normalize_key`). `login` (`features/auth/commands.rs`) y `unlock` llaman a `reserve_attempt` con el nombre tecleado antes de intentar la verificación, sin consultar si la cuenta existe. Un nombre inexistente acumula fallos en memoria como cualquier otro: `MAX_FAILURES` = 5 fallos bloquean el nombre durante `LOCKOUT` = 300 s.
- **Respuesta uniforme.** Si el throttle deniega, `reject_after_verification` ejecuta igualmente la verificación y devuelve `InvalidCredentials`. Con `stored = None`, `verify_credentials` (`features/auth/service.rs`) verifica contra `dummy_hash` (`features/auth/password.rs`). Una cuenta existente bloqueada, un nombre inexistente y una contraseña incorrecta producen la misma respuesta y un tiempo de respuesta comparable.
- **Motivo.** Si el bloqueo o la respuesta distinguieran cuentas existentes de las que no existen, el formulario de login serviría para enumerar usuarios. La existencia de una cuenta solo se refleja en la BD (`login_throttle`), nunca en la respuesta IPC.
- **Límite residual (denegación de servicio local).** Quien teclea un nombre cinco veces bloquea ese nombre en memoria durante 5 minutos, incluido el nombre real de una cuenta. La cota es `LOCKOUT` = 300 s, sin escalado. El bloqueo persistido (`login_throttle` en BD, `MAX_PERSISTED_FAILURES` = 5, `locked_until_utc = now + 300 s`, `features/auth/repository.rs`) se aplica solo a usuarios reales (`known_user_id` en `reject_login`). El modelo de amenazas es local y sin red (ADR 0002, sección Contexto): el atacante ya tiene acceso al equipo.
- **Reevaluar** si la app expone un canal de red, si se añade un límite por dispositivo, o si el bloqueo de 5 minutos afecta de forma observable de forma observable a usuarios reales en uso.

### Evicción de la tabla en memoria (`make_room`) (ITEM-28)

- **Decisión.** `LoginThrottle::make_room` (`features/auth/throttle.rs`) actúa cuando la tabla tiene `MAX_TRACKED` = 1024 claves: purga las caducadas, después desaloja la entrada no bloqueada con menos fallos y, si todas están bloqueadas, la que expira antes (`soonest_to_expire`). Una clave nueva nunca recibe `Denied` por capacidad.
- **Efecto.** Con la tabla llena de entradas bloqueadas, la que expira antes pierde su contador y su bloqueo en memoria. Un nombre real bloqueado sigue bloqueado: `find_credentials_by_username` lee `is_locked_out` desde `login_throttle` en BD y `login` deniega igualmente. Lo que se pierde es solo el bloqueo en memoria de nombres inexistentes, que nunca tuvieron bloqueo en BD.
- **Límite residual.** Un nombre inexistente desalojado vuelve a tener cero fallos. No hay efecto sobre cuentas reales.
- Las migraciones `0003_audit_log.sql` y `0004_login_throttle.sql` se editaron en sitio; su condición y reevaluación están en ADR 0005, sección "Decisiones de la auditoría".

### Mock IPC del front (ITEM-19)

- **Qué simula** `src/test/ipc/auth-backend.ts`: el bloqueo por inactividad (`IDLE_LOCK_MS` = 10 min, con `isLocked` y `lockedUserId`) y la respuesta `status: 'locked'`.
- **Qué no simula:** el throttle en memoria, el lockout persistido de `login_throttle` y la detección de reanudación (`resumed_between`, `features/auth/heartbeat.rs`, solo Rust). El mock acepta contraseñas correctas tras cualquier número de fallos.
- **Prueba del límite.** `src/test/ipc/auth-backend-parity.test.ts`, bloques `shim_does_not_simulate_lockout` y `shim_does_not_simulate_recovery_throttle`, fija como comportamiento esperado que el shim no bloquea. Si alguien añade lockout al mock sin cambiar Rust, esa paridad deja de cumplirse.
- **Cobertura real de esas reglas:** tests de Rust (`features/auth/throttle_test.rs`, `repository_throttle_test.rs`, `repository_throttle_dst_test.rs`, `heartbeat_test.rs`, `service_session_test.rs`, `audit_commands_test.rs`) y los e2e con respuestas inyectadas, que verifican cómo reacciona la UI ante una respuesta dada (por ejemplo `sessionLocked` o `invalidCredentials`). Los e2e no ejercitan la decisión de bloqueo; la decisión se prueba en Rust.

### CI: waivers de `bun audit` (ITEM-15)

- **Estado verificado.** En `.github/workflows/ci.yml`, job `deps`, el paso es `bun audit` sin `--ignore`. `.github/audit-waivers.json` contiene `[]`.
- **Qué valida el guard.** El paso siguiente lee `.github/audit-waivers.json` con `jq`, valida `id` (`GHSA-xxxx-xxxx-xxxx`), `package`, `vulnerableUpTo` (X.Y.Z) y compara la última versión de `bun pm view` con el límite. Si la última versión supera el límite, falla con "retirar el waiver".
- **Qué no hace.** El guard no consume el JSON para construir `bun audit`. Un waiver nuevo no tiene efecto hasta que se añade `--ignore=<id>` a mano en `ci.yml`.
- **Detección de desincronización.** `src/lib/audit-waiver.test.ts` (ejecutado por `bun run test:cov` en `ci.yml`) contiene `mantiene correspondencia 1:1 entre waivers registrados e ids ignorados en ci.yml`, que compara los ids del JSON con los `--ignore=` del paso `bun audit`. Un waiver sin flag o un flag sin waiver hace fallar el test. El test `registra cada id ignorado ... con motivo y condición de retiro` exige `reason` y `removeWhen`.
- **Procedimiento para añadir un waiver.**
  1. Tomar de la salida de `bun audit` el id GHSA, el paquete y la versión vulnerable máxima.
  2. Verificar que `bun.lock` resuelve una versión `<= vulnerableUpTo` (`staleWaivers` del mismo test falla si no).
  3. Añadir a `.github/audit-waivers.json` un objeto con `id`, `package`, `vulnerableUpTo`, `reason` y `removeWhen`.
  4. Añadir `--ignore=<id>` al comando `bun audit` del job `deps` de `ci.yml`. Varios ids van en el mismo comando.
  5. Ejecutar `bun run test -- src/lib/audit-waiver.test.ts` y confirmar en verde. Waiver y flag van en el mismo commit.
- **Procedimiento para retirar un waiver.**
  1. Actualizar la dependencia en `bun.lock` a una versión parcheada. El test `no conserva waivers cuyo bun.lock ya no resuelve una versión vulnerable` falla cuando ninguna versión resuelta es `<= vulnerableUpTo`: esa es la señal.
  2. Eliminar la entrada de `.github/audit-waivers.json` y el `--ignore=<id>` de `ci.yml` en el mismo commit. El test 1:1 confirma la retirada.
  3. Si el guard falla con "supera el límite", el registro del paquete ya publica una versión mayor que el límite: retirar el waiver es obligatorio, y actualizar la dependencia es el camino.
- **Límite residual.** `removeWhen` es texto libre. El guard no lee `removeWhen`; la retirada depende de las dos señales automáticas de arriba.

### CSP de producción (ITEM-14)

- **Política vigente** (`src-tauri/tauri.conf.json`, clave `app.security.csp`): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src ipc: http://ipc.localhost; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. `devCsp` y su excepción de desarrollo están en ADR 0001.
- **Scripts.** `script-src 'self'` sin `unsafe-inline` ni `unsafe-eval`. `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'` y `form-action 'self'` también están en la política.
- **Por qué `style-src` conserva `'unsafe-inline'`.** Hay atributos `style` en el HTML generado por el export estático de Next (`out/login/index.html`: `style="font-size:42px"`, origen `src/components/brand-logo.tsx`; `out/404.html` y `out/404/index.html` con atributos `style` de Next). Tauri no puede cubrir estos atributos con hash ni nonce. Tailwind (`package.json`, `tailwindcss` ^4.3.5) no se verificó como causa: su salida es una hoja CSS externa y no aparece ningún atributo `style` generado por Tailwind en `out/`. La causa verificada es el prerender de Next.
- **Riesgo acotado.** `script-src 'self'` impide ejecutar scripts inyectados inline o desde otro origen. `img-src 'self' data:` y `connect-src ipc:` limitan la exfiltración que intentase usar CSS (`url()` a origen externo) y las peticiones de red, de modo que una inyección de estilo no tiene destino externo. No acota la inyección de estilos dentro de la propia app.
- **Condición para reevaluar.** Retirar `'unsafe-inline'` de `style-src` cuando `grep -l 'style="' out/*.html out/**/*.html` no devuelva resultados en el build de producción, y `bunx tauri build` siga en verde. Hasta entonces, cualquier nuevo atributo `style` prerenderizado (no `style={{}}` de cliente, que React aplica por CSSOM) debe revisarse antes de fusionarse.
