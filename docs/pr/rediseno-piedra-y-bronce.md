# PR: Rediseño visual «Piedra y bronce» (v0.2.0)

**Fecha:** 2026-11-13
**Run:** run-mwfl2he5-fe154474 (fase DOCUMENT)

## Motivación

Aplicar una identidad visual sobria y coherente al prototipo de Fase 0: tokens de color, tipografía local, logo y favicon, agenda más legible y estados de cita diferenciados por color. El cambio es solo visual: no modifica reglas de dominio, flujos ni textos. Las decisiones están en `docs/design/piedra-y-bronce.md`.

## Cambios

`impacted_paths` resumidos por carpeta:

- `src/app/`: tokens en `globals.css`, `layout.tsx`, fuentes locales en `fonts/`, `icon.svg` (favicon), páginas `(auth)/login` y `(app)/` (citas, clientes, catálogo, métricas, ajustes), y `theme-contrast.test.ts`.
- `src/components/`: `app-shell`, `sidebar-nav` (barra musgo), `brand-logo` (logo «Spa»), `shell-banners`, `user-summary`, `native-select` y primitivas de `ui/` sin sombras ni colores literales.
- `src/features/appointments/components/`: agenda por franjas de altura fija (`day-grid`, `week-grid`, `week-day-section`, `resource-column`), línea de hora actual (`now-line`), tarjeta de cita con borde por estado (`appointment-card`) y barra de vistas (`view-toolbar`).
- `src/features/`: resto de módulos (`clients`, `client-history`, `payments`, `catalog`, `rates`, `resources`, `metrics`, `auth`) con ajustes de presentación y estados vacíos y de error unificados.
- `src/test/`: `no-literal-colors.test.ts` (regla de colores literales); pruebas desacopladas de clases CSS.
- `e2e/`: `visual.spec.ts` (capturas en 1280, 768 y 390 px, axe y foco bronce), `e2e/__screenshots__/visual.spec.ts/` (21 PNG).
- `docs/`: `design/piedra-y-bronce.md` (nuevo), `pr/rediseno-piedra-y-bronce.md` (nuevo), `CHANGELOG.md` y `README.md` con la entrada 0.2.0 y el enlace y comandos visuales.
- Raíz: `package.json` y `bun.lock` (`@axe-core/playwright` como dependencia de desarrollo), `playwright.config.ts`, `next.config.ts`.

## Breaking changes

Ninguno. Sin cambios de API, datos ni rutas.

## Riesgos conocidos

- Las capturas visuales dependen de Chromium sobre Linux. Regenerarlas en otro sistema produce diferencias espurias.
- Las fuentes se sirven como TTF, sin woff2.

## Checklist de verificación

- [x] `bun run test`: 1398 tests.
- [x] `bun run test:cov`: cobertura 99.42 %.
- [x] E2E: 19 pruebas, incluidas las capturas visuales en 1280, 768 y 390 px.
- [x] Contraste AA de tokens verificado por `src/app/theme-contrast.test.ts`.
- [x] Colores literales ausentes en componentes (`src/test/no-literal-colors.test.ts`).
- [x] `bun audit` sin hallazgos.
- [ ] Revisión visual de las capturas por la propietaria o el usuario antes del merge (capturas generadas con `bunx playwright test e2e/visual.spec.ts --update-snapshots`, solo Chromium Linux).
- [ ] Puerta de acceso configurada en el hosting antes de cualquier publicación (ver `docs/security/fase0-mock.md`).

## Precondiciones externas

- Puerta de acceso configurada en el hosting (basic auth o password del hosting): viene de Fase 0 (`docs/security/fase0-mock.md`), no es parte de este PR. Este PR no la implementa ni la modifica.
