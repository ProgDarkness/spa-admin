# Diseño «Piedra y bronce»

**Versión:** 0.2.0 (2026-11-13)
**Fuentes de verdad:** `src/app/globals.css` (tokens), `src/app/theme-contrast.test.ts`, `src/test/no-literal-colors.test.ts`, `e2e/visual.spec.ts`.

## Paleta

| Token (`globals.css`) | Hex | Uso |
|---|---|---|
| `--primary` | `#1F2A24` musgo | Barra lateral, botones primarios, estado completada |
| `--background` | `#EEF0EA` piedra | Fondo de la aplicación |
| `--card` | `#FAFAF7` marfil | Superficies, tarjetas, diálogos |
| `--border` | `#8A9A86` salvia | Bordes decorativos; estado en curso |
| `--input` | `#6F8069` salvia oscura | Bordes de controles (campos, selects) |
| `--ring` | `#A67C3B` bronce | Acento y anillo de foco |
| `--foreground` | `#1B211D` tinta | Texto principal |
| `--destructive` | `#A8483C` | Errores y no asistió |

Los contrastes de texto y de controles sobre fondo están verificados por `src/app/theme-contrast.test.ts` (nivel AA). Si cambia un token, ese test debe seguir en verde antes de tocar componentes.

## Tipografía

- Newsreader (`--font-serif`): títulos y logo «Spa».
- Hanken Grotesk (`--font-sans`): interfaz y texto.
- Ambas son archivos TTF variables en `src/app/fonts/`, cargados en local (sin CDN). Licencia OFL incluida en `OFL-*.txt`.

## Estructura

- Barra lateral en musgo con navegación y logo.
- Agenda por recurso con vistas Día y Semana. Franjas de altura fija (`--slot-height`, 4.5rem) y línea de hora actual.
- Listados, fichas y ajustes sobre superficies marfil sobre fondo piedra.

## Pieza memorable

Tres elementos definen el carácter visual y no deben diluirse:

1. Logo «Spa» en Newsreader (`src/components/brand-logo.tsx`) sobre la barra musgo.
2. Agenda con franjas de altura fija, línea de hora actual (`now-line.tsx`, color `--ring` bronce) y borde de color por estado de cita.
3. Botón + con estados de hover y foco.

## Estados de cita

| Estado | Color | Token |
|---|---|---|
| Programada | bronce `#A67C3B` | `--status-scheduled` |
| En curso | salvia `#8A9A86` | `--status-in-progress` |
| Completada | musgo `#1F2A24` | `--status-completed` |
| Cancelada | gris `#6B726D` | `--status-cancelled` |
| No asistió | error `#A8483C` | `--status-no-show` |

## Reglas

- Sin sombras en primitivas (`src/components/ui/`).
- Radio de 6px (`--radius: 0.375rem`).
- Sin colores literales en componentes: ni clases Tailwind de color (`bg-white`, `text-gray-500`, etc.) ni valores hex, rgb, hsl u oklch. Lo verifica `src/test/no-literal-colors.test.ts`. Usar siempre tokens.
- Sin modo oscuro. Se eliminó en 0.2.0.
- Foco visible en bronce (`--ring`).
- Movimiento solo dentro de `motion-safe:` (pulso de la línea de hora actual, aperturas de diálogos y selects).
- Tests unitarios sin dependencia de clases CSS: validan comportamiento y roles accesibles, no estilos.

## Actualizar capturas del E2E visual

Las capturas están en `e2e/__screenshots__/visual.spec.ts/` (21 PNG: 7 vistas × 3 viewports 1280x800, 768x1024, 390x844).

```bash
bunx playwright test e2e/visual.spec.ts --update-snapshots
```

- Generar y comparar solo en Chromium sobre Linux. Otros sistemas renderizan fuentes y antialiasing distintos y darán diferencias espurias.
- Revisar cada PNG nuevo antes de commitear. La actualización acepta cualquier cambio visual, incluido uno no deseado.

## Límites conocidos

- La fecha con «De» en mayúscula es texto de Fase 0 y se conserva. No es parte del rediseño.
- Las fuentes se sirven como TTF variables (451 KB y 133 KB); es el formato incluido por el repositorio upstream y se aceptan así.
