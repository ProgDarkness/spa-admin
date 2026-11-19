# PR: Fase 1 - scaffold Tauri 2, backend Rust, cifrado y login mínimo

**Fecha:** 2026-11-16
**Rama:** `feat/fase1-backend` → `main`
**Run:** `run-mwfno8h1-a6fafa9b` (39 hallazgos, todos `resolved` al cierre de DOCUMENT)
**ADR:** `docs/adr/0001-arquitectura.md`, `docs/adr/0002-cifrado-y-respaldo.md`, `docs/adr/0003-fechas-y-moneda.md`
**Plan:** `docs/planeers/plan-mvp.md`, Fase 1 y decisiones D1–D22

Estado del árbol: cambios sin commitear en la rama. Esta descripción cubre el árbol actual frente a `main`.

## Motivación

La Fase 0 entregó un prototipo visual con datos mock en memoria. La Fase 1 construye la base real del backend en Rust sobre el mismo front:

- Shell Tauri 2 sobre el export estático de Next.js, sin red.
- Base de datos SQLCipher con clave en el keychain del SO.
- Contrato IPC tipado generado desde Rust (tauri-specta).
- Login mínimo con Argon2id, lockout y sesión en Rust.
- CI en Windows, macOS y Ubuntu con gates de dependencias.

Criterio de salida de la Fase 1 (plan): en ambos SO se generan los bindings, carga el build exportado, SQLCipher abre una BD con clave del keychain real y un login mínimo funciona. El tramo de keychain real y de Windows/macOS queda pendiente de CI (ver «Pendiente de verificación»).

## Alcance implementado

| Área | Estado en esta rama |
|---|---|
| Scaffold Tauri 2 y export de Next | Implementado (`src-tauri/`, `tauri.conf.json`) |
| Bindings tauri-specta | Implementado (`src/lib/bindings.ts`) |
| SQLCipher + KeyStore | Implementado, sin fallback en texto plano |
| Migrador sobre `user_version` | Implementado (`0001_auth.sql`, `0002_username_nocase.sql`) |
| Login, sesión TTL 10 min, `require_permission` | Implementado (`features/auth/`) |
| Lockout 5 fallos / 300 s (D12, parcial) | Implementado (`features/auth/throttle.rs`) |
| Código de recuperación (D13) | No implementado; solo existe la columna `users.recovery_code_hash` |
| Bloqueo por inactividad de 10 min (D12) | Implementado (`features/auth/service.rs`, `IDLE_TIMEOUT`); pendiente Fase 2: detección de reanudación del equipo |
| Respaldo `.spabak` (D14) | No implementado (Fase 8) |
| Slices clients, catalog, resources, appointments, payments, metrics, audit | No existen en Rust (Fases 3–7) |

Fuera de esta PR: cualquier comando de dominio distinto de auth.

## impacted_paths

Árbol frente a `main`:

- Modificados (`M`): `.gitignore`, `bun.lock`, `package.json`, `eslint.config.mjs`, `vitest.config.ts`, `vitest.setup.ts`, `e2e/support/session.ts`, `e2e/visual.spec.ts`, `src/app/providers.tsx`, `src/app/providers.test.tsx`, `src/app/(auth)/login/page.test.tsx`, `src/components/user-summary.tsx`, `src/components/user-summary.test.tsx`, `src/features/auth/api.ts`, `src/features/auth/api.test.ts`, `src/features/auth/components/login-form.test.tsx`, `src/lib/model.ts`, `src/lib/session.tsx`, `src/lib/session.test.tsx`, `src/lib/mock/seed.ts`, `src/lib/mock/seed.test.ts`, `src/test/export-output.test.ts`.
- Nuevos (`??`):
  - `src-tauri/`: backend Rust (`src/db`, `src/features/auth`, `src/keystore.rs`, `src/setup.rs`, `src/dev_seed.rs`, `tests/`, `capabilities/`, `permissions/`, `deny.toml`, `rust-toolchain.toml`, `Cargo.toml`, `Cargo.lock`, `tauri.conf.json`).
  - `.github/`: workflow `ci.yml`.
  - `docs/adr/`: ADR 0001–0003.
  - `src/lib/bindings.ts`, `src/lib/bindings-contract.test.ts`, `src/lib/bindings-contract.test-d.ts`.
  - `src/test/ipc/` (shim IPC y `dev-browser-ipc`), `src/test/ci-workflow.test.ts`, `src/test/tauri-config.test.ts`.
  - `e2e/support/tauri-ipc.ts`, `e2e/support/tauri-ipc.test.ts`.
- Documentación de esta fase: `CHANGELOG.md` (sección `Unreleased`), `docs/pr/fase1-backend.md`.

## Breaking changes

- **Contrato TS:** ninguno que rompa consumidores. `AppErrorCode` añade `unauthenticated`, `forbidden` e `internal` (cambio aditivo).
- **`signOut`** pasa a devolver `Result<null>` (antes no devolvía resultado). Es un cambio de firma en `src/lib/session.tsx` y `src/features/auth/api.ts`; los consumidores del front de la Fase 0 se actualizan en esta rama.
- **Datos:** no hay datos previos en producción; la BD nace en el primer arranque.

## Decisiones clave

| Tema | Decisión | Referencia |
|---|---|---|
| Arquitectura | Vertical slices en Rust, capas `commands → service → repository → model`, sin DDD ni hexagonal | D4, ADR 0001 |
| Contrato IPC | camelCase con `serde(rename_all = "camelCase")`; `bindings.ts` sustituye a `model.ts` | D20, ADR 0001 |
| Cifrado | SQLCipher con clave raw de 32 bytes (hex) en el keychain del SO; `PRAGMA key` como primera sentencia | D2, ADR 0002 |
| Keychain | Sin fallback en texto plano; `load_or_create` nunca regenera una clave si la BD existe | ADR 0002 |
| Migraciones | Migrador propio sobre `PRAGMA user_version`; `rusqlite_migration` descartado por incompatibilidad con `rusqlite` 0.43 | ADR 0002 |
| Versiones | `rusqlite` 0.43.0, SQLCipher 4.20.0, SQLite 3.54.1 (corrige RUSTSEC-2026-0502); dependencias directas con `=` | ADR 0001, ADR 0002 |
| Contraseñas | Argon2id `m=19456 t=2 p=1`; `login` siempre verifica con hash dummy; mismo `invalidCredentials` para usuario inexistente, inactivo o clave incorrecta | ADR 0002 |
| Lockout | 5 fallos por 300 s; reserva atómica del intento; fallos de infraestructura no consumen intentos; fail-closed al expulsar entradas | D12 (parcial) |
| Sesión | Solo en memoria de Rust (`SessionState`); TTL de inactividad 10 min; permisos recargados desde BD en cada `require_permission` | ADR 0001, ADR 0002 |
| Usuarios | NFC + unicidad `COLLATE NOCASE` | 0002_username_nocase.sql |
| Permisos de archivos | Directorio de datos `0700`, BD `0600` | `setup.rs` |
| Superficie Tauri | ACL por comando (`login`, `logout`, `current_session`); CSP de producción `script-src 'self'`; `devCsp` solo para `tauri dev` | ADR 0001, ADR 0002 |
| Fallback de navegador | `dev-browser-ipc` solo en `bun run dev`; excluido del build de producción | ADR 0001 |
| Tiempo | Instantes monotónicos (`Instant`) para TTL y lockout; en Linux no avanzan durante la suspensión (límite aceptado) | ADR 0001 |
| Dinero y fechas | Montos en centavos; tasa Bs/USD como entero x10^4 (`rateBsPerUsdE4`); fechas `YYYY-MM-DDTHH:MM` hora local | ADR 0003 (decisión; `users.created_at` y `users.updated_at` ya en minutos; la mitigación por retroceso de reloj está diferida, Fase 2 inferida) |
| Dependencias | `deny.toml` con 5 ignores `unmaintained` por ID y `reason`; `RUSTSEC-2026-0502` no ignorado | ADR 0001 |

## Desvíos y notas de revisión

Estos puntos no bloquean la PR, pero deben decidirse o corregirse antes de fusionar:

1. **Código de recuperación (D13).** No implementado. Solo existe la columna `users.recovery_code_hash` en `0001_auth.sql`. Pendiente de Fase 2.
2. **Respaldo (D14).** No implementado. Pendiente de Fase 8.
3. **ADR 0003.** Documenta las decisiones de fechas, monedas y tasa. No hay comandos Rust de tasas ni pagos en esta rama. La mitigación por retroceso de reloj (D11) está diferida: `plan-mvp.md` no le asigna fase y el ADR la infiere en Fase 2 por depender de `audit_log`. La discrepancia de `users.created_at` y `users.updated_at` quedó resuelta: el SQL usa minutos.
4. **Alcance del backend.** Solo existe `features/auth` en Rust. Los demás slices del plan no están en esta rama.

## Plan de pruebas y checklist de verificación

Resultados re-ejecutados en la fase DOCUMENT (2026-11-16): `cargo test --locked`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo check --locked --features real-keyring` y `vitest`. Cobertura, E2E, `cargo llvm-cov`, `cargo deny` y `bun audit` son los del run de implementación. Los comandos son los definidos en `package.json` y `.github/workflows/ci.yml`.

- [x] `bun run test` (`vitest run`): 125 archivos, 1486 tests en verde (re-ejecutado en DOCUMENT).
- [x] `bun run test:cov` (`vitest run --coverage`): cobertura del front ≥ 98 %.
- [x] `bun run e2e` (`playwright test`): 25/25 en verde.
- [x] `cargo test --locked --manifest-path src-tauri/Cargo.toml`: 153 tests en verde (150 lib, 2 `dependency_versions`, 1 `manifest_pins`; `real_keyring` requiere `--features real-keyring`).
- [x] `cargo llvm-cov --locked --manifest-path src-tauri/Cargo.toml --ignore-filename-regex '(_test\.rs$|src-tauri/tests/|src-tauri/src/main\.rs$)' --fail-under-lines 80`: 93.81 % de líneas (umbral 80 %).
- [x] Mutación manual (`testing.md`): 20 mutantes; 18 detectados por tests y 2 resueltos (uno con test nuevo, `infrastructure_failures_do_not_consume_login_attempts`; uno equivalente, cláusula eliminada en `make_room`).
- [x] `cd src-tauri && cargo deny --locked check`: limpio.
- [x] `bun audit`: sin hallazgos.
- [x] Pruebas de contrato de bindings: `bindings-contract.test-d.ts` detecta mutaciones de tipo (`roleName` numérico falla).
- [x] Pruebas de CI y configuración (`ci-workflow.test.ts`, `tauri-config.test.ts`, `manifest_pins.rs`): en verde.

Casos de borde cubiertos: usuario inexistente, inactivo y clave incorrecta con el mismo error; lockout tras 5 fallos; fallo de infraestructura sin consumir intento; expulsión de entradas bloqueadas rechazada en el throttle; username con NFC y unicidad NOCASE; archivo que no es BD cifrada con la clave mapeado a `NotADatabase`; BD con versión mayor rechazada (`SchemaNewerThanApp`).

### Pendiente de verificación (no ejecutable en WSL local)

- [ ] CI Windows: instalación de NASM y Perl para `bundled-sqlcipher-vendored-openssl`, y `cargo test --locked --features real-keyring`.
- [ ] CI macOS: keychain real con llavero temporal (`security create-keychain`) y `cargo test --locked --features real-keyring`.
- [ ] CI Ubuntu: `cargo test --features real-keyring` con `gnome-keyring-daemon` y `xvfb-run`.
- [ ] Toolchain `1.100.0` (`src-tauri/rust-toolchain.toml` y CI): no verificado localmente. `rust-version` de `Cargo.toml` es `1.88`.
- [ ] `bun run tauri dev` en WSL con Secret Service: requiere keychain del SO disponible (ADR 0001, consecuencias).

Se marcan como pendientes porque dependen de runners y SO que no están disponibles en el entorno de desarrollo. Se verifican al subir la rama.
