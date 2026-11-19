# spa-app

App de gestión del spa (clientes, citas, catálogo, pagos, tasas y métricas). Actualmente en **Fase 0**: prototipo visual de Next.js con datos mock en memoria. La versión final será una app de escritorio con Tauri 2 y backend Rust con SQLCipher (ver `docs/planeers/plan-mvp.md`).

## Advertencia

No publicar este prototipo sin una puerta de acceso delante (basic auth o contraseña del hosting). Las rutas, los datos de ejemplo y la credencial demo viajan en el bundle, y los permisos solo se verifican en el cliente. Detalle en [docs/security/fase0-mock.md](docs/security/fase0-mock.md).

## Requisitos

- [bun](https://bun.sh) (único gestor de paquetes permitido; no usar npm ni yarn).
- Node.js 20.19 o superior (`engines` en `package.json`).

## Arranque

```bash
bun install            # instalar dependencias
bun run dev            # servidor de desarrollo
bun run test           # pruebas unitarias y de componentes (Vitest)
bun run test:cov       # pruebas con cobertura (v8)
bun run e2e            # pruebas E2E de humo (Playwright; compila y sirve out/ automáticamente)
bun run build          # export estático a out/
bunx --no-install serve out -l 4173   # servir el export en http://localhost:4173
bunx playwright test e2e/visual.spec.ts   # E2E visual (capturas en 1280, 768 y 390 px; Chromium Linux)
bunx playwright test e2e/visual.spec.ts --update-snapshots   # regenerar capturas; revisarlas antes de commitear
```

Otros scripts: `bun run lint` y `bun run typecheck`.

## Credencial demo

Usuario `propietaria`, contraseña `demo1234`. Los roles `recepcion` y `lectura` y el recorrido de demostración están en [docs/qa/demo-fase0.md](docs/qa/demo-fase0.md). La contraseña es pública y de demostración, no es secreta.

## Documentación

- [CHANGELOG.md](CHANGELOG.md): historial de versiones.
- [docs/qa/demo-fase0.md](docs/qa/demo-fase0.md): guion de demo y checklist de validación.
- [docs/security/fase0-mock.md](docs/security/fase0-mock.md): alcance de seguridad del mock y migración al backend.
- [docs/planeers/plan-mvp.md](docs/planeers/plan-mvp.md): alcance, decisiones y fases.
- [docs/pr/fase0.md](docs/pr/fase0.md): descripción de la PR de la Fase 0.
- [docs/design/piedra-y-bronce.md](docs/design/piedra-y-bronce.md): sistema de diseño «Piedra y bronce», estados de cita y actualización de capturas.
