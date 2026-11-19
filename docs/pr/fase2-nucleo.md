# PR: Fase 2 - núcleo de datos y seguridad

**Fecha:** 2026-11-18
**Rama:** `feat/fase2-nucleo` → `main`
**Run:** `run-mwmpjo5s-8f5cf171` (fase DOCUMENT)
**ADR:** `docs/adr/0002-cifrado-y-respaldo.md` (puntos 6, 7, 9, 10 y 11), `docs/adr/0004-sesion-y-auditoria.md`, `docs/adr/0005-tiempo-utc-y-hora-local.md`, `docs/adr/0006-users-manage-control-total.md`
**Plan:** `docs/planeers/plan-mvp.md`, Fase 2
**Anterior:** `docs/pr/fase1-backend.md`

Esta descripción cubre la rama `feat/fase2-nucleo` frente a `main`. Son 174 archivos cambiados (incluido este archivo); aquí se agrupan por área.

## Motivación

La Fase 1 dejó un login mínimo, sin bloqueo persistente, sin sesión bloqueable y sin auditoría. La Fase 2 añade el núcleo de seguridad y datos sobre el backend Rust:

- Migraciones con copia previa (`.bak`) antes de migrar.
- Autenticación con bloqueo persistido y sesión bloqueable por inactividad y por reanudación del equipo.
- Roles y permisos validados en Rust en cada comando.
- Auditoría de solo inserción (`audit_log`).
- Gestión de usuarios y roles, primer arranque con la Propietaria y recuperación de contraseña.

Criterio de salida (plan, Fase 2): los flujos de sesión, bloqueo, recuperación y gestión de usuarios funcionan de extremo a extremo con el backend Rust real; cada acción sensible queda auditada en la misma transacción; el contrato IPC queda tipado y verificado contra `bindings.ts`.

## Alcance implementado

| Área | Estado en esta rama |
|---|---|
| Copia previa `.bak` con retención de 3 y permisos `0600` (Unix) | Implementado (`src-tauri/src/db/snapshot.rs`) |
| Migraciones `0003_audit_log.sql` y `0004_login_throttle.sql` | Implementadas (editadas en sitio, ver Breaking changes) |
| Lockout persistido: 5 fallos, 300 s, sobrevive a reinicios | Implementado (`features/auth/repository.rs`, `throttle`) |
| Sesión `active` / `locked` (`SessionView`), inactividad 10 min, latido de 15 s | Implementado (`features/auth/`, `heartbeat`) |
| Desbloqueo con reautenticación del mismo usuario | Implementado (`unlock`) |
| Roles y 15 `PermissionKey` con `require_permission` recargado desde BD | Implementado |
| Auditoría (`audit::record` dentro de la transacción de cada acción; 16 `AuditAction`) | Implementado (`features/audit/`) |
| Retroceso de reloj al arranque (`clock_rollback`, tolerancia 300 s) | Implementado; banner solo en la pantalla de login |
| Primer arranque, código de recuperación de la Propietaria | Implementado (`setup_owner`, `recover_password`) |
| Gestión de usuarios y roles (alta, edición, restablecimiento, roles, permisos) | Implementado en Rust (`features/users/`); sin pantalla de administración en la UI |
| Visor de auditoría | `list_audit` implementado; sin pantalla en la UI (ADR 0004, Q10) |
| Respaldo y restauración `.spabak` | No implementado (Fase 8) |
| Slices clients, catalog, resources, appointments, payments, metrics | No existen en Rust (Fases 3–7) |

Fuera de esta PR: comandos de dominio distintos de auth, users y audit; respaldo y restauración.

## impacted_paths

Agrupados por área. Lista completa: `git diff --name-only main...HEAD`.

- **Backend auth** (`src-tauri/src/features/auth/`, 36 archivos): comandos de sesión y login, servicio de sesión y latido, throttle en memoria y persistido, eventos de auditoría, contraseñas (Argon2 con límite de concurrencia).
- **Backend usuarios y roles** (`src-tauri/src/features/users/`, 13 archivos): comandos, servicio, repositorio, modelo y pruebas de reautorización.
- **Backend auditoría** (`src-tauri/src/features/audit/`, 9 archivos): `audit::record`, lectura paginada, reloj.
- **Backend base de datos y arranque** (`src-tauri/src/db/`, `src-tauri/src/setup.rs`, `src-tauri/src/dev_seed.rs`, `src-tauri/src/lib_bindings_test.rs`, `src-tauri/src/errors.rs`): copia previa, migraciones `0003`/`0004`, permisos, datos de desarrollo y `export_bindings`.
- **Contrato IPC** (`src/lib/bindings.ts`, `src/lib/bindings-contract*.ts`, `src/lib/model.ts`, `src/lib/session.tsx`): bindings regenerados, `SessionView` y `sessionLocked`.
- **Frontend auth** (`src/features/auth/`, `src/app/(auth)/`, `src/app/providers.tsx`): pantalla de bloqueo, primer arranque, recuperación, banner de retroceso de reloj, rastreador de actividad y sondeo de sesión.
- **Tests e2e** (`e2e/`, `src/test/ipc/`): mock IPC con respuestas inyectables, reloj unificado y `e2e/lockout.spec.ts`.
- **CI y dependencias** (`.github/workflows/ci.yml`, `.github/audit-waivers.json`, `src-tauri/Cargo.toml`, `src-tauri/permissions/`, `src-tauri/capabilities/`): guard de waivers del job `deps`, permisos Tauri.
- **Documentación** (`CHANGELOG.md`, `docs/adr/0002`, `docs/adr/0004`, `docs/adr/0005`, `docs/adr/0006`, `docs/pr/fase2-nucleo.md`).

## Breaking changes

- **Contrato IPC de la Fase 2: 16 comandos** tipados en `src/lib/bindings.ts`: `login`, `logout`, `current_session`, `record_activity`, `unlock`, `setup_status`, `setup_owner`, `recover_password`, `list_users`, `create_user`, `update_user`, `reset_user_password`, `list_roles`, `create_role`, `set_role_permissions` y `list_audit`.
- **`SessionView`:** `current_session` y `record_activity` devuelven `SessionView | null` (ver `src/lib/bindings.ts`). `current_session` deja de devolver `SessionUser`. Consumidores actualizados: `src/lib/session.tsx`, `src/features/auth/api.ts` y el shim IPC de desarrollo (`src/app/providers.tsx`).
- **`AppErrorCode` suma `sessionLocked`.** Cambio aditivo en el tipo, pero los consumidores deben tratar el código.
- **Migraciones `0003` y `0004` editadas en sitio.** Fase 2 no está publicada. Las bases de desarrollo ya migradas a `user_version` 3 o 4 no reciben el esquema actual porque el runner omite las versiones aplicadas: deben recrearse.
- **`bindings.ts` regenerado.** Cualquier cambio de comando Rust exige regenerarlo; ver «Cómo regenerar bindings».

## Riesgos residuales aceptados

- **Windows sin ACL explícita** para el directorio de datos, `spa.db` y los `.bak`: `restrict_to_owner` solo aplica permisos en Unix. ADR 0002, punto 11.
- **Límites de la auditoría y del lockout** (auditoría en autocommit fuera de transacción en `list_audit`, no a prueba de manipulación por quien controla archivo y clave, lockout persistido con reloj de pared, login con usuario desconocido no auditado). ADR 0004, «Límites conocidos» y decisión DN9.
- **Tiempo:** comparaciones de bloqueo y retroceso en UTC; un cambio manual del reloj del sistema sí altera el vencimiento del bloqueo persistido. ADR 0005, «Límites».
- **`users.manage` es control total** de usuarios y roles, incluido el rol de la Propietaria. ADR 0006, «Riesgo aceptado».
- **Detección de reanudación** con falsos positivos y, en Windows, sin detección de suspensiones menores de 120 s. ADR 0002, punto 6.

## Decisiones del usuario

- Auditoría dentro de la transacción de cada acción (Q2), con la excepción de `session_locked` en autocommit (ADR 0004).
- Login con usuario desconocido sin fila `login_failed` (DN9, ADR 0004).
- `users.manage` como control total (ADR 0006).
- Permisos de archivos en Windows sin ACL explícita (ADR 0002, punto 11, ITEM-18).
- Waiver de picomatch `GHSA-fc5q-39xc-vjpf` retirado el 2026-11-18 por retiro del aviso; `.github/audit-waivers.json` queda como `[]` (ADR 0004, «CI: waivers de `bun audit`»).

## Plan de pruebas y checklist de verificación

Verificado contra el run de CI `44635972702` de este PR (6 jobs en `success`) y contra los fuentes. Los comandos son los definidos en `package.json` y `.github/workflows/ci.yml`.

- [x] CI: 6/6 jobs en verde en este PR (`rust (ubuntu-latest)`, `rust (macos-latest)`, `rust (windows-latest)`, `web`, `deps` y `core-coverage`).
- [x] `bun run test` (`vitest run`): 1756 tests en 145 archivos (job `web`).
- [x] `bun run test:cov`: cobertura del front «All files» 96.09 % de líneas (job `web`).
- [x] `bun run e2e` (`playwright test`): 43 tests en 5 archivos según `playwright test --list` (incluye `support/tauri-ipc.test.ts`); 43 passed en el job `web`.
- [x] `cargo test --locked --manifest-path src-tauri/Cargo.toml`: 553 tests en verde (`rust (ubuntu-latest)`, `rust (macos-latest)` y el paso de cobertura de `core-coverage`); en `rust (windows-latest)` son 551, menos por los tests condicionados a `cfg(unix)`. Con `--features real-keyring` son 554 en ubuntu y macOS, y 552 en Windows; `real_keyring` requiere `--features real-keyring`.
- [x] Cobertura Rust (`cargo llvm-cov`, job `core-coverage`): 97.46 % de líneas (fila TOTAL), umbral 80 %.
- [x] `export_bindings`: compara los comandos con `src/lib/bindings.ts` y falla ante deriva; `bindings_tests::export_bindings ... ok` en los jobs `rust`.
- [x] Guard de waivers (`src/lib/audit-waiver.test.ts`, dentro de la ejecución de vitest): con `.github/audit-waivers.json` en `[]`, el paso `bun audit` de `ci.yml` (job `deps`, `success`) no lleva `--ignore`.
Verificación manual del autor antes del merge (no automatizable en CI): keychain con el Secret Service de una sesión de escritorio real del usuario final. CI ya ejecuta `real_keyring` en Windows, macOS y Ubuntu (con `gnome-keyring-daemon`); WSL local no ejecuta esa prueba sin Secret Service (ADR 0002, «Consecuencias»). El merge es humano.

Casos de borde cubiertos: lockout persistido tras 5 fallos y reinicio; fallo de infraestructura sin consumir intento; bloqueo de sesión por inactividad y por reanudación; reautorización dentro de la transacción en `create_user` y `reset_user_password`; último administrador protegido en la misma transacción; retroceso de reloj al arranque; reloj del mock e2e unificado entre navegador y backend.

## Cómo regenerar bindings

Desde `src-tauri/`:

```
SPA_UPDATE_BINDINGS=1 cargo test export_bindings
```

Después revisar `git diff -- src/lib/bindings.ts` y commitear el archivo junto con el cambio de comandos. Sin la variable, `export_bindings` no escribe el archivo y falla con un mensaje de deriva.

## Nota de merge

El merge a `main` es humano. Esta PR no se fusiona de forma automática: revisar el checklist, confirmar CI 6/6 y decidir sobre los riesgos residuales aceptados antes de fusionar.
