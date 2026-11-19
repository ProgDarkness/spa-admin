# ADR 0001: Arquitectura de vertical slices en Rust y frontera front-back

- **Estado:** Aceptada
- **Fecha:** 2026-11-14
- **Fase:** 1 (slice S0)
- **Fuentes:** `docs/planeers/plan-mvp.md` (D4, D20, D21, "Notas de arquitectura de la Fase 0"), run `run-mwfno8h1-a6fafa9b`

## Contexto

- App de escritorio offline para un spa: Tauri 2, front Next.js con `output: 'export'`, backend Rust, BD SQLCipher única y un solo equipo (D1).
- Seis capacidades independientes: auth, clients, catalog, appointments, metrics, audit. Señal: no hay segunda infraestructura ni invariantes ricas que justifiquen hexagonal o DDD (`architecture.md`, YAGNI).
- La Fase 0 es un prototipo con datos mock en memoria (D21). La Fase 1 reemplaza el mock por comandos Rust feature a feature.
- El front tiene una única costura `lib → feature`: `src/lib/session.tsx` importa `@/features/auth/api`.

## Decisión

1. **Vertical slices en Rust (D4).** Una carpeta por feature con capas planas `commands → service → repository` y `model`. Sin puertos ni adaptadores ni agregados DDD.
   - Layout: `src-tauri/src/features/<feature>/{commands,service,repository,model}.rs`.
   - Compartido mínimo: `main.rs`, `lib.rs` (`specta_builder()` separado de `run()`), `setup.rs`, `db/`, `errors.rs`, `keystore.rs`, `dev_seed.rs` (solo `cfg(debug_assertions)`).
   - Los permisos se validan en Rust en cada comando; el front solo oculta controles.
2. **Contrato IPC con camelCase (D20).** `serde(rename_all = "camelCase")` en Rust. `tauri-specta` genera `src/lib/bindings.ts`, que sustituye a `src/lib/model.ts` sin renombrar campos.
   - Errores: `AppError { code, message, field?, entityIds? }`. Códigos `invalidCredentials`, `validation`, `unauthenticated`, `forbidden`, `internal` (E3: `internal` es un código propio, no se reutiliza `validation`).
   - `AppError` no expone causas internas.
3. **Frontera del mock.** `@/lib/mock/*` solo se importa desde `features/*/api.ts`, tests, `src/test/**` y `e2e/**`; la regla `no-restricted-imports` de ESLint lo impone.
4. **Costura temporal session → auth/api.** `auth/api.ts` usa los comandos de `bindings.ts` y llama `syncMockSession(user | null)` con el `username` para mantener el mock sincronizado. Las firmas públicas de `auth/api.ts` no cambian en tipo; `session.tsx` solo cambia `signOut`, de `Promise<void>` a `Promise<Result<null>>`, y conserva el snapshot si `logout` falla. Si Rust devuelve un usuario ausente del mock, la costura responde `internal` y deja el mock sin sesión; la costura cierra también la sesión de Rust con `logout` (si ese `logout` falla igualmente responde `internal`). Es temporal: se retira al migrar cada feature a bindings.
5. **KeyStore como struct concreta (E1).** No se crea un trait propio (YAGNI).
   - Runtime: `keyring` 4.2.0 con el store nativo del SO.
   - Tests: `keyring-core` =1.0.1 en `[dependencies]` (tipos usados por `KeyStore`); los tests usan `mock::Store` con inyección de fallos.
6. **Shim IPC para front.** `src/test/ipc/auth-backend.ts` expone `createAuthIpcBackend(users, SessionPort)`.
   - Vitest: `mockIPC` desde `vitest.setup.ts`.
   - Playwright: `page.exposeFunction` + `addInitScript` en `e2e/support/tauri-ipc.ts`; el hook `test.beforeEach` de `e2e/support/session.ts` instala el shim, por lo que todo spec debe importar `session.ts`.
   - Fallback en navegador: solo en `bun run dev`, reutiliza el mismo backend con datos de ejemplo. No existe en build de producción.
   - Sesión al recargar (D21): el shim de e2e (`e2e/support/tauri-ipc.ts`) ejecuta `logout` al cargar cada documento, de modo que una recarga vuelve sin sesión, igual que el seed en memoria. La app Tauri real conserva la sesión al recargar, porque `SessionState` vive en Rust y no en el webview.
7. **Versiones pineadas en `src-tauri/Cargo.toml` con `=` donde aplica.** Referencia: `tauri` 2.12.5, `tauri-build` 2.7.4, `tauri-specta` =2.0.0-rc.29, `specta` =2.0.0-rc.28, `specta-typescript` 0.0.15, `rusqlite` 0.43.0 (arrastra `libsqlite3-sys` 0.40.0 y `sqlcipher-src` 420.0.0 = SQLCipher 4.20.0 / SQLite 3.54.1; migrador propio sobre `PRAGMA user_version`, sin `rusqlite_migration`), `keyring` 4.2.0, `argon2` 0.6.0, `password-hash` 0.6.1. Se congelan en `Cargo.lock` y `bun.lock`. `rust-version` = 1.88.

## Consecuencias

- **Cambio aditivo en el front.** `src/lib/model.ts` solo gana el literal `'internal'` en `AppErrorCode` (`'unauthenticated'` y `'forbidden'` ya estaban en `main`; `AppErrorCode` de Rust y `bindings.ts` define los tres). Los ~130 archivos que importan `@/lib/model`, `@/lib/session` o `@/features/auth/api` no cambian.
- **Duplicación entre slices es aceptada.** Un concepto compartido se extrae solo cuando sea estable y tenga al menos dos usos reales.
- **Un cambio en un concepto compartido se replica por slice.** Coste asumido por la ausencia de capa de dominio.
- **Costura temporal.** Mientras `syncMockSession` exista, sesión del mock y sesión Rust pueden divergir; se verifica en tests de `bindings-contract.test.ts`.
- **Relojes monotónicos.** El TTL de sesión (10 min) y el bloqueo de login (300 s) usan `Instant`, que en Linux no avanza durante la suspensión del equipo; tras suspender, ambos duran más en tiempo de pared. Límite aceptado, sin reloj de pared.
- **Desarrollo en WSL.** `tauri dev` con login requiere Secret Service; alternativa: fallback de navegador o correr en Windows.
- **Verificado en Linux (`cargo test --locked`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo check --locked --features real-keyring`, 2026-11-16):** `init_native_store`, `NoEntry` en keyring 4, `BigIntExportBehavior::Number`, forma `Result` de specta y API de `argon2` 0.6.
- **Pendiente de verificación (no ejecutable en WSL):** OpenSSL vendored en Windows (CI Windows) y CSP con scripts inline de Next en `tauri build`.
- **CSP: `script-src 'self'` sin `unsafe-inline`; `style-src` conserva `'unsafe-inline'`** porque el export estático prerenderiza atributos `style` (p. ej. `brand-logo` en `/login`: `style="font-size:42px"`) que Tauri no cubre con hash/nonce; los scripts inline de Next los cubre Tauri con hashes automáticos.
- **`devCsp` (solo `tauri dev`):** igual que `csp` más `connect-src` con `ws://localhost:3000`/`http://localhost:3000` (HMR de Next) y `script-src` con `'unsafe-eval'`/`'unsafe-inline'` porque Next dev inyecta scripts inline y React dev usa `eval`, sin hashes de Tauri sobre `devUrl`; producción conserva `script-src 'self'`.
- **Logging no estructurado.** `service.rs` usa `eprintln` sin estructura ni niveles; límite aceptado hasta introducir `tracing`.
- **CI sin pin de hash.** La instalación con `choco`/`apt` en CI no fija hash de paquete; riesgo de cadena de suministro aceptado.
- **Gate de dependencias en CI (job `deps`).** `cargo deny --locked check` con `src-tauri/deny.toml` y `bun audit`; solo se ignoran 5 advisories `unmaintained` transitivos (paste, proc-macro-error, zbus_names, zvariant, zvariant_derive), cada uno con `reason`; `RUSTSEC-2026-0502` no se ignora.
- **Dependencias directas de `Cargo.toml` fijadas con `=`** a la versión resuelta en `Cargo.lock`; lo verifica `src-tauri/tests/manifest_pins.rs`. Ninguna queda en rango.
