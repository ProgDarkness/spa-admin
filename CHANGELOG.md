# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Los commits siguen [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/) (`feat`, `fix`, `docs`, `test`, `chore`, `ci`, `refactor`, `perf`).

## [Unreleased]

Fase 1: scaffold Tauri 2 y núcleo de seguridad y datos del backend Rust (login mínimo, SQLCipher, bindings tipados, CI). Sin publicar. Pendiente de verificación en CI Windows y macOS y en `tauri dev` con Secret Service; ver `docs/pr/fase1-backend.md`.

### Added

- Scaffold Tauri 2 sobre el export estático de Next.js: `src-tauri/`, `tauri.conf.json` y capabilities con ACL por comando (`login`, `logout`, `current_session`).
- Bindings tipados con tauri-specta en `src/lib/bindings.ts`, verificados por `bindings-contract.test.ts` y `bindings-contract.test-d.ts`.
- Base de datos SQLCipher con clave raw de 32 bytes guardada en el keychain del SO (`KeyStore`). Sin fallback en texto plano: si el keychain no está disponible, la app no arranca.
- Migrador propio sobre `PRAGMA user_version`, con `0001_auth.sql` y `0002_username_nocase.sql`.
- Login mínimo en Rust: Argon2id, hash dummy para usuario inexistente o inactivo, lockout de 5 fallos por 300 s con reserva atómica del intento, sesión en memoria con TTL de inactividad de 10 min (D12) y `require_permission` con permisos recargados desde la BD.
- Fallback de desarrollo en navegador (`dev-browser-ipc`), activo solo en `bun run dev` y excluido del build de producción.
- Workflow de GitHub Actions con matriz Windows, macOS y Ubuntu (NASM, cargo-llvm-cov 0.9.1) y job `deps` (cargo-deny 0.20.2 y `bun audit`). Acciones fijadas por SHA.
- ADR 0001 (arquitectura de vertical slices y frontera front-back), 0002 (cifrado, clave, autenticación y respaldo) y 0003 (fechas, monedas y tasa).

### Changed

- `rusqlite` 0.43.0 con SQLCipher 4.20.0 y SQLite 3.54.1. `rusqlite_migration` queda descartado por incompatibilidad con `rusqlite` 0.43.
- Dependencias Rust directas fijadas con `=` (18 entradas en `[dependencies]`, `[build-dependencies]` y `[dev-dependencies]`; 17 crates distintas, `tauri` aparece en dos secciones), verificadas por `src-tauri/tests/manifest_pins.rs`.
- `users.created_at` y `users.updated_at` por defecto en formato `YYYY-MM-DDTHH:MM` (sin segundos), según D11 y ADR 0003; `0001_auth.sql` editado directamente por no estar publicado.
- Nombres de usuario normalizados a NFC con unicidad `COLLATE NOCASE` (índice en `0002_username_nocase.sql`).
- Permisos de archivos: directorio de datos `0700`, base de datos `0600`.
- `AppErrorCode` de Rust y `bindings.ts` define `unauthenticated`, `forbidden` e `internal`; `src/lib/model.ts` solo añade `internal`. El cambio es aditivo.
- `signOut` devuelve `Result<null>` y conserva el snapshot de sesión si `logout` falla.
- Umbral de cobertura Rust de 80 % de líneas en CI (`cargo llvm-cov`), medido en 93.81 %.

### Fixed

- Login: la verificación Argon2 corre con `spawn_blocking` fuera del lock de la BD.
- Lockout: un fallo de infraestructura no consume intentos; el throttle no expulsa entradas bloqueadas ni más fuertes (fail-closed).
- Sincronización del mock: usuario ausente del mock responde `internal` y cierra la sesión Rust.
- Dev fallback: el render espera a instalar el shim IPC antes de la primera consulta de sesión.
- CI: `export-output.test.ts` no se omite (build antes de tests); con `CI=1` y sin `out/` falla en lugar de omitirse; `bindings.ts` untracked detectado con `git status --porcelain`.
- Bundle de producción sin `SEED_PASSWORD` ni usuarios de demostración.

### Security

- CSP de producción con `script-src 'self'`. `style-src 'unsafe-inline'` queda documentado en ADR 0001 por el prerenderizado de atributos `style` de Next.
- `devCsp` separada, solo para `tauri dev` (`ws://localhost:3000` para HMR de Next).
- Login con mensaje único `invalidCredentials` para usuario inexistente, inactivo o clave incorrecta.
- Clave de la BD fuera del archivo; `DbKey` con `Zeroizing` y `Debug` redactado.
- Corrige RUSTSEC-2026-0502 (SQLite anterior a 3.54) al subir a SQLCipher 4.20.0.
- `cargo deny --locked check` con `deny.toml`; solo se ignoran 5 advisories `unmaintained` transitivos, cada uno con `reason`. `RUSTSEC-2026-0502` no se ignora.
- `bun audit` sin hallazgos.

## [0.2.0] - 2026-11-13

Rediseño visual «Piedra y bronce». Sin cambios de lógica de dominio ni de textos. Decisiones en `docs/design/piedra-y-bronce.md`.

### Added

- Sistema de diseño con tokens CSS en `src/app/globals.css`: musgo `#1F2A24` (primario), piedra `#EEF0EA` (fondo), marfil `#FAFAF7` (superficies), salvia `#8A9A86` (decorativo) y `#6F8069` (bordes de control), bronce `#A67C3B` (acento y foco), tinta `#1B211D` (texto) y error `#A8483C`.
- Tipografía Newsreader (títulos) y Hanken Grotesk (texto) servidas en local como TTF con licencia OFL (`src/app/fonts/`).
- Logo «Spa» (`src/components/brand-logo.tsx`) y favicon (`src/app/icon.svg`).
- Barra lateral en musgo.
- Agenda con franjas de altura fija, línea de hora actual y borde por estado de cita, incluido «no asistió».
- Botón + con estados de hover y foco.
- Estados vacíos y de error unificados.
- E2E visual (`e2e/visual.spec.ts`) con capturas en 1280, 768 y 390 px, comprobación de contraste y foco con axe y foco bronce.

### Changed

- Eliminado el modo oscuro.
- Primitivas de `src/components/ui/` sin sombras ni colores literales; el control lo hace `src/test/no-literal-colors.test.ts`.
- Tests desacoplados de las clases CSS.
- Suite: 1398 tests (antes 1300), cobertura 99.42 % (antes 99.48 %), 19 pruebas E2E (antes 6).

### Fixed

- Sin correcciones funcionales: el rediseño no altera reglas, flujos ni textos.

### Security

- `bun audit` sin hallazgos.
- `@axe-core/playwright` solo como dependencia de desarrollo.

## [0.1.0] - 2026-11-13

Fase 0: prototipo visual con datos mock en memoria. No es una aplicación de producción.

### Added

- Pantallas Next.js con `output: 'export'` (sin SSR ni API routes): login, agenda por recurso (vistas Día y Semana), clientes con búsqueda, ficha de cliente con historial y pagos, catálogo de servicios y métodos de pago, tasas de cambio, métricas básicas por mes y ajustes de recursos.
- Datos mock en memoria (`src/lib/mock/`): al recargar la página se vuelve al seed.
- Reglas de dominio en el cliente: solapes de citas, transiciones de estado (programada, en curso, completada, cancelada, no asistió), cédula obligatoria con formato `V|E|J-dígitos`, pagos en USD y en VES con tasa del día, anulación de pagos con motivo y métricas (nuevos, recurrentes, ingresos por moneda).
- Roles de demostración (Propietaria, Recepción, Solo lectura) con permisos por acción.
- Suite de pruebas: 1300 tests con Vitest y Testing Library, cobertura 99.48 %.
- E2E de humo con Playwright: 6/6 pasan.
- Guion de demo y checklist de validación para la revisión con la dueña y la socia (`docs/qa/demo-fase0.md`).

### Security

- Los permisos (`authorize`) y la sesión solo se validan en el cliente; el mock no es frontera de seguridad. La validación real se construye en Rust en la Fase 2.
- Credencial de demostración `demo1234` incluida en el bundle; no publicar sin una puerta de acceso delante (basic auth o contraseña del hosting). Ver `docs/security/fase0-mock.md`.
- Dependencias transitivas con `overrides` (`compression ^1.8.2`, `minimatch ^11.0.1`) que cierran GHSA-vc2v-76pw-4v95 y GHSA-g3hv-75wg-m249; `bun audit` sin hallazgos.
- Pruebas de matriz de autorización: las mutaciones devuelven `forbidden` sin tocar el store para los roles `lectura` y `recepcion`.
