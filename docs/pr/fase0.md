# PR: Fase 0 - prototipo visual con mock en memoria (v0.1.0)

**Fecha:** 2026-11-13
**Rama:** `main` (sin commits todavía; esta descripción es un borrador hasta que exista la rama de cambios)

## Motivación

Validar con la dueña (la dueña) y la socia (la empleada) el flujo de trabajo, las pantallas y las reglas de negocio antes de construir el backend en Rust (Fase 1 y 2). Según `docs/planeers/plan-mvp.md`, la Fase 0 cierra con aprobación explícita; se incluyen los 13 slices S0 a S12 y un E2E de humo.

Fuera de alcance de esta Fase 0: bloqueo por inactividad (D12), gestión de usuarios y roles, y cualquier persistencia real. Los datos viven en memoria y se pierden al recargar.

## Cambios

Resumen de `impacted_paths` (carpetas de `src/` y artefactos asociados):

- `src/app/`: rutas Next.js. Login `(auth)/login`; área autenticada `(app)/` con `citas`, `clientes` (incluye `clientes/ficha`), `catalogo`, `metricas`, `ajustes/recursos` y `ajustes/tasas`; layouts, providers y página raíz.
- `src/components/`: shell de la aplicación, banners, `native-select` y primitivas de `ui/` (shadcn).
- `src/features/`: `appointments` (agenda, solapes, estados), `clients` (alta, búsqueda, cédula), `client-history` (historial, tiempo total, montos), `payments` (pagos USD/VES, anulación), `rates` (tasa del día), `catalog` (servicios y métodos de pago), `resources` (cabinas), `metrics` (cálculos mensuales), `auth` (login y sesión). Incluye `authorization.matrix.test.ts`.
- `src/lib/`: `mock/` (store en memoria, seed, `authorize`), `session`, `model`, `money`, `datetime`, `routes`, `query-keys`, `result` y utilidades.
- `src/test/`: render, helpers, sesión, reloj y fixtures de pruebas.
- `e2e/`: E2E de humo con Playwright y soporte de sesión, clientes, citas y pagos.
- `docs/`: `qa/demo-fase0.md`, `security/fase0-mock.md`, `planeers/plan-mvp.md`, `pr/fase0.md`.
- Raíz: `CHANGELOG.md`, `README.md`, `package.json` (scripts y `overrides` de seguridad).

## Breaking changes

Ninguno. Es el primer release; no hay API ni datos previos que romper.

## Riesgos conocidos

- La seguridad (permisos y sesión) solo se aplica en el cliente. El export estático sirve todo sin autenticación: no publicar sin puerta de acceso delante.
- La credencial demo `demo1234` viaja en el bundle (pública, de demostración).

## Checklist de verificación

- [x] `bun run test`: 1300 tests en verde.
- [x] `bun run test:cov`: cobertura 99.48 % (mínimo del plan: 80 %).
- [x] `bun run e2e`: 6/6 pruebas en verde.
- [x] Export estático de Next.js (`output: 'export'`).
- [x] `bun audit` sin hallazgos (overrides de `compression` y `minimatch`).
- [x] Matriz de autorización: mutaciones denegadas sin tocar el store para `lectura` y `recepcion`.
- [ ] Revisión de la demo con la empleada y la dueña (`docs/qa/demo-fase0.md`, checklist a-g) y aprobación explícita (criterio de salida de la Fase 0).
- [ ] Puerta de acceso configurada en el hosting antes de cualquier publicación.
