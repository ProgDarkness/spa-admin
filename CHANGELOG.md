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

### Fase 2: Núcleo de datos y seguridad

Migraciones con copia previa, auth con bloqueo persistente y sesión bloqueable, roles y permisos en Rust, auditoría de solo inserción, gestión de usuarios y roles, y primer arranque con recuperación de la Propietaria. Sin publicar. Decisiones en `docs/adr/0004-sesion-y-auditoria.md`, `docs/adr/0005-tiempo-utc-y-hora-local.md` y `docs/adr/0006-users-manage-control-total.md`.

#### Added

- Copia previa de la base de datos (`.bak`) antes de migrar, con permisos `0600` y retención de 3 copias (`SNAPSHOT_RETENTION`). Si la copia nueva falla, no se migra; la poda de copias antiguas es best-effort.
- Migraciones `0003_audit_log.sql` (auditoría) y `0004_login_throttle.sql` (bloqueo persistido).
- Lockout persistente en `login_throttle`: 5 fallos bloquean 300 s a usuarios existentes y el bloqueo sobrevive a reinicios.
- Roles y permisos en Rust: 15 claves `PermissionKey`, validadas en cada comando con `require_permission` contra permisos recargados desde la BD.
- Sesión con estados `active` y `locked` en Rust (`SessionView`). Bloqueo por inactividad a los 10 min (reloj monotónico) y por reanudación del equipo (latido cada 15 s con reloj monotónico y de pared).
- Desbloqueo (`unlock`) con reautenticación del mismo usuario, con el mismo throttle que el login.
- `record_activity` como única vía que extiende la inactividad. El front la envía desde `useActivityTracker`, con throttle de 30 s.
- Primer arranque (`setup_owner`) con la Propietaria y contraseña de al menos 10 caracteres.
- Código de recuperación de la Propietaria de 20 caracteres base32 (alfabeto de 32 símbolos) generado con `getrandom`. `recover_password` no requiere sesión y devuelve un código nuevo; los demás usuarios se recuperan con `reset_user_password`.
- Auditoría de solo inserción en `audit_log`: triggers `audit_log_no_update` y `audit_log_no_delete`, 16 acciones (`AuditAction`) y `list_audit` paginado con máximo de 200 filas por página. La auditoría de cada acción se escribe dentro de su transacción (`audit::record`); la fila `session_locked` es la excepción, porque se escribe en autocommit (ADR 0004).
- Mitigación de retroceso de reloj al arranque: evento `clock_rollback` con tolerancia de 300 s y banner `ClockRollbackBanner` en la pantalla de login.
- Gestión de usuarios y roles en Rust (`features/users`): alta, edición de usuario, rol y estado activo, restablecimiento de contraseña por administrador, creación de roles y cambio de permisos. Guarda del último administrador en la misma transacción.
- 16 comandos IPC tipados: `login`, `logout`, `current_session`, `record_activity`, `unlock`, `setup_status`, `setup_owner`, `recover_password`, `list_users`, `create_user`, `update_user`, `reset_user_password`, `list_roles`, `create_role`, `set_role_permissions` y `list_audit`.
- Front: pantalla de bloqueo (`lock-screen`), ruta de primer arranque (`/setup`), ruta de recuperación (`/recover`), rastreador de actividad (`useActivityTracker`) y sondeo de sesión cada 15 s (`SESSION_POLL_INTERVAL_MS`).
- Datos de desarrollo (`dev_seed`) solo en compilación de depuración y solo si está definida `SPA_DEV_SEED_PASSWORD` (mínimo 12 caracteres).
- Guard genérico de waivers en el job `deps` de `.github/workflows/ci.yml`: falla si la última versión publicada de un paquete con waiver supera `vulnerableUpTo`. `src/lib/audit-waiver.test.ts` exige correspondencia 1:1 entre waivers registrados y flags `--ignore`. Procedimiento para añadir y retirar waivers en `docs/adr/0004-sesion-y-auditoria.md` (sección «CI: waivers de `bun audit`»).

#### Changed

- Comparación del bloqueo persistido y del retroceso de reloj en UTC (`locked_until_utc`, `last_failure_at_utc`, `occurred_at_utc`), con formato ISO 8601 validado por `CHECK`. La hora local queda solo para mostrar (ADR 0005).
- Migraciones `0003` y `0004` editadas en su lugar, porque Fase 2 no está publicada. Las bases de desarrollo ya migradas a `user_version` 3 o 4 no reciben el esquema actual, porque el runner omite las versiones ya aplicadas: deben recrearse.
- `current_session` devuelve `SessionView` en lugar de `Option<SessionUser>`. Cambio incompatible del contrato IPC; los consumidores se actualizaron en `src/lib/session.tsx`, `src/features/auth/api.ts` y el shim IPC de desarrollo (`src/app/providers.tsx`).
- `AppErrorCode` suma `sessionLocked`.
- `logout` termina la sesión en memoria y después audita `logout` en su propia transacción; la terminación de la sesión no ocurre dentro de esa transacción.
- El umbral de bloqueo (5 fallos) se pasa como parámetro SQL al upsert de `login_throttle` y queda ligado al `CHECK` del esquema por tests.
- `export_bindings` (`src-tauri/src/lib_bindings_test.rs`) compara los comandos Rust con `src/lib/bindings.ts` y falla ante deriva sin escribir el archivo. Para regenerar, desde `src-tauri/`: `SPA_UPDATE_BINDINGS=1 cargo test export_bindings`, y después revisar `git diff -- src/lib/bindings.ts`.

#### Removed

- Waiver de picomatch `GHSA-fc5q-39xc-vjpf` (picomatch <= 4.0.7, ReDoS, solo herramientas de desarrollo): retirado el 2026-11-18, porque GitHub retiró el aviso. `.github/audit-waivers.json` queda como `[]` y el job `deps` ejecuta `bun audit` sin `--ignore`.

#### Fixed

- Tests e2e: el reloj del mock es uno solo (`advanceClock` mueve el reloj del navegador y el del backend mock); `installTauriIpc` se instala por página con respuestas inyectables; nuevo `e2e/lockout.spec.ts` para sesión bloqueada y cuenta bloqueada. Sin cambios de comportamiento de producto.

#### Security

- `create_user` y `reset_user_password` reautorizan al actor dentro de la transacción, después del hash de la contraseña, en lugar de fiarse solo de la comprobación previa.
- Un login denegado por throttle o por bloqueo persistido también ejecuta una verificación Argon2 contra un hash dummy (`reject_after_verification`), para que el tiempo de respuesta no revele el motivo.
- Límite de concurrencia de Argon2 a 2 operaciones simultáneas (`MAX_CONCURRENT_OPERATIONS`); las demás esperan a un permiso.
- Evicción del throttle en memoria con tope de 1024 claves (`MAX_TRACKED`): se purgan las entradas caducadas y después se evicta la entrada no bloqueada con menos fallos. Una clave nueva nunca recibe `Denied` por capacidad.
- Límites residuales documentados en ADR 0004: el throttle en memoria bloquea por nombre de usuario sin distinguir si existe (DoS local acotado a 5 minutos; el bloqueo persistente es por usuario real) y el CSP de producción mantiene `style-src 'unsafe-inline'` por los atributos `style` del prerender de Next, con `script-src 'self'`.
- Nombres de usuario Unicode: normalización NFC y rechazo de caracteres de control, de formato y de separadores, salvo el espacio ASCII. La unicidad en alta y renombrado usa plegado propio; el login compara con `COLLATE NOCASE`, que solo pliega ASCII.
- `users.manage` es control total de usuarios y roles: puede asignar cualquier rol (incluido el de la Propietaria), restablecer la contraseña de cualquier cuenta y conceder `users.manage` a otra cuenta. Es riesgo aceptado (ADR 0006); los intentos denegados no se auditan.
- Windows: `restrict_to_owner` aplica `0700` y `0600` solo en Unix. En Windows no altera permisos del directorio, de `spa.db` ni de los `.bak`, y la protección descansa en la ACL heredada de `%APPDATA%` y en el cifrado SQLCipher (ADR 0002, punto 11).

### Fase 3: Catálogo, recursos, métodos de pago y tasas

Catálogo, recursos, métodos de pago y tasas de cambio en Rust, con auditoría de negocio completa (D15) y pantallas del front contra el backend real. Sin publicar. Decisiones en `docs/adr/0007-catalogo-y-auditoria-de-negocio.md`; descripción de la PR en `docs/pr/fase3-catalogo.md`.

#### Added

- Migración `0005_audit_business.sql`: reconstruye `audit_log` con 24 acciones (antes 16) y 10 entidades (antes 3), con triggers de solo inserción. La `0003` no cambia.
- Migraciones `0006_services.sql`, `0007_resources.sql`, `0008_payment_methods.sql` y `0009_exchange_rates.sql`. Recursos y métodos de pago se desactivan, no se borran.
- 15 comandos IPC nuevos (31 en total): servicios (4), recursos (4), métodos de pago (4) y tasas (`list_rates`, `get_rate`, `upsert_rate`).
- Tasas por fecha con año entre 2000 y 2099 (CHECK en SQL y en `features/rates/model.rs`).
- Acciones de auditoría genéricas `create`, `update`, `deactivate`, `reactivate` (y `soft_delete`, `void`, `backup_created`, `backup_restored` en el catálogo D15), escritas en la transacción de cada acción.
- Pantallas contra Rust: catálogo (`/catalogo`), recursos (`/ajustes/recursos`), métodos de pago (`/ajustes/metodos-pago`) y tasas (`/ajustes/tasas`).
- Navegación filtrada por permisos con `NavItem.permissions` (`useCanAny`, `src/components/sidebar-nav.tsx`).
- Seed de ejemplo de servicios y tasas solo en compilación de depuración y con `SPA_DEV_SEED_PASSWORD`.
- Guarda D9 transitoria en el front: un recurso con citas futuras programadas no se desactiva. La guarda real en Rust llega en la Fase 5.
- Script `bun run check:bundle` (`scripts/check-bundle.ts`, `scripts/check-bundle-cli.ts`): detecta marcadores prohibidos y centinelas del seed en el bundle estático (`out/`).
- `src/lib/mirror-sync.ts` (`createMirrorSync`): sincronización de espejos con descarte de respuestas obsoletas.
- Pruebas e2e de catálogo, recursos, tasas, métodos de pago y rol de solo lectura (`e2e/catalog.spec.ts`).

#### Changed

- Espejos del store mock: los `list*` piden la colección completa a Rust y la reflejan entera; `mirror-sync` descarta respuestas obsoletas. `createAppointment` y `createPayment` refrescan el espejo antes de validar.
- Tipos `Service`, `Resource`, `PaymentMethod` y `ExchangeRate` del front derivados de `src/lib/bindings.ts`.
- `AuditAction` y `AuditEntity` de `src/lib/bindings.ts` ampliados (cambio aditivo).
- Validación común de nombres y claves en `src-tauri/src/features/named_records/`, compartida por servicios, recursos y métodos de pago; las tasas reutilizan de ese módulo la conversión de errores y el registro de auditoría (`record_change`).

#### Security

- Seed del mock aún presente en el bundle de producción hasta la Fase 6 (decisión del usuario, 2026-11-24). `check:bundle` avisa con centinelas del seed y no bloquea (`SEED_SENTINELS_BLOCK_BUNDLE = false`).
- Seed de desarrollo de Rust excluido de release (`#[cfg(debug_assertions)]`).

### Fase 4: Clientes

Clientes en Rust con cédula V|E|J normalizada, búsqueda, auditoría de negocio (D15) y espejo del front contra el backend real. Sin publicar. Decisiones en `docs/adr/0008-clientes.md`; descripción de la PR en `docs/pr/fase4-clientes.md`.

#### Added

- Migración `0010_clients.sql`: tabla `clients` con cédula `UNIQUE` y CHECK de formato (`V|E|J-dígitos`, 8 a 11 caracteres), teléfono de hasta 32 caracteres y `deleted_at` para el borrado lógico.
- 5 comandos IPC nuevos (36 en total): `list_clients`, `get_client`, `create_client`, `update_client`, `set_client_deleted`.
- Cédula normalizada con la misma regla en Rust (`features/clients/normalization.rs`) y en la UI (`src/features/clients/national-id.ts`).
- Búsqueda por nombre, apellido, cédula, teléfono y dígitos del teléfono, con consulta de hasta 100 caracteres y escape de comodines.
- Auditoría de clientes: `create`, `update`, `soft_delete` y `reactivate` con diff; sin diferencia no se audita.
- Errores `notFound`, `nationalIdTaken` y `clientDeletedReactivate` (este último con el id del cliente borrado en `entityIds`).
- Seed de desarrollo de 9 clientes solo en compilación de depuración y con `SPA_DEV_SEED_PASSWORD`.
- Pruebas e2e de clientes (`e2e/clients.spec.ts`) y de paridad IPC (`src/test/ipc/clients-*.ts`).

#### Changed

- `listClients` del front pide la colección completa a Rust y la refleja entera; `getClient` es lectura. El espejo de citas e historial refresca clientes antes de validar.
- Acoplamiento transitorio: `appointments` y `client-history` dependen de clientes en el espejo hasta la Fase 6.

#### Security

- Permisos `clients.read` y `clients.write` validados en Rust en cada comando, dentro de la transacción en las escrituras.
- El diff de auditoría guarda nombre, apellido, cédula y teléfono en claro (D15; visible para `audit.read`). Decisión consciente en ADR 0008.
- Seed del mock aún presente en el bundle de producción hasta la Fase 6, con el centinela `V-26789012` informativo.

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
