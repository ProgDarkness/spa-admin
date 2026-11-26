# Checklist de instalación en máquina limpia (Fase 8)

- **Criterio:** `docs/planeers/plan-mvp.md`, Fase 8 (criterio de salida) y "Verificación end-to-end" puntos 3 a 8.
- **Guía a seguir:** `docs/guia-instalacion.md` (solo la guía, sin ayuda adicional).
- **Decisiones:** `docs/adr/0012-respaldo-y-empaquetado.md`.
- **Regla de registro:** por cada casilla, anotar fecha (AAAA-MM-DD), versión de la app, y resultado (`OK` o `FALLO`, con nota). Una casilla con `FALLO` bloquea el cierre de la Fase 8 hasta resolverla y repetir la prueba.
- **Sin red:** cada máquina debe probarse con la red desconectada desde el inicio, salvo que el paso indique otra cosa (WebView2 durante la instalación).

## 0. Datos del release

| Campo | Valor |
|---|---|
| Versión de la app | `0.1.0` |
| Etiqueta del release | `v0.1.0` (draft) |
| Fecha del release draft | |
| Ejecución de `release.yml` (`workflow_dispatch` o push) | |
| Archivos verificados contra `SHA256SUMS` | |

## 1. Máquina Windows limpia

| Campo | Valor |
|---|---|
| Versión exacta de Windows (`winver`, build completo) | |
| Edición y arquitectura | |
| Ya tenía WebView2 | Sí / No |
| Usuario de Windows usado (no administrador) | |

| # | Verificación | Fecha | Versión | Resultado |
|---|---|---|---|---|
| W1 | Descargar del draft `Spa_0.1.0_x64-setup.exe` (y el `.msi` si se prueba) | | | [ ] |
| W2 | `Get-FileHash -Algorithm SHA256` coincide exactamente con la línea de `SHA256SUMS` | | | [ ] |
| W3 | Aviso de SmartScreen: se muestra y se resuelve con **Más información → Ejecutar de todas formas**; el texto del aviso coincide con la guía | | | [ ] |
| W4 | Instalación NSIS por usuario sin privilegios de administrador | | | [ ] |
| W5 | Si falta WebView2: el instalador lo descarga (con red) y la instalación termina | | | [ ] |
| W6 | Primer arranque: aparece "Crear cuenta Propietaria"; se crea la cuenta y aparece el código de recuperación una sola vez; la casilla de confirmación es obligatoria | | | [ ] |
| W7 | Verificación 3 del plan: crear rol sin `catalog.write` y comprobar que editar catálogo falla en Rust (`forbidden`) | | | [ ] |
| W8 | Verificación 4 del plan: dejar 10 min de inactividad; un comando protegido queda rechazado hasta reautenticar. Repetir tras suspender y reanudar el equipo | | | [ ] |
| W9 | Verificación 5 del plan: crear cliente, cita, cita solapada rechazada, pago mixto USD + VES, historial y métricas coherentes | | | [ ] |
| W10 | Verificación 6 del plan: abrir `spa.db` con un cliente SQLite normal debe fallar | | | [ ] |
| W11 | Verificación 7 del plan (binario real): exportar respaldo; cerrar la app; mover la carpeta de datos (`%APPDATA%\com.progdarkness.spa`) fuera; abrir y restaurar con la frase; verificar integridad y login | | | [ ] |
| W12 | Verificación 8 del plan (binario real): restaurar un `.spabak` corrupto y uno de versión futura. Ambos muestran su mensaje exacto (`La frase no coincide o el archivo está dañado` / `El respaldo fue creado con una versión más nueva de la aplicación`) y la BD actual no cambia | | | [ ] |
| W13 | Banner semanal: sin respaldos aparece "Aún no has exportado ningún respaldo"; tras exportar desaparece | | | [ ] |
| W14 | Sin red durante el uso: la app funciona con la red desconectada | | | [ ] |
| W15 | Fallo de arranque provocado (con la app cerrada, sustituir `spa.db` por un archivo que no sea una BD SQLCipher de esa clave): aparece el diálogo "Spa no pudo iniciar" con el texto que remite al Manual de usuario entregado con el instalador (sección "Si la aplicación no abre"); abrir ese manual desde la memoria USB, seguir el procedimiento de la sección 5 y restaurar | | | [ ] |

## 2. Máquina macOS limpia

| Campo | Valor |
|---|---|
| Versión exacta de macOS (`sw_vers`) | |
| Arquitectura (`uname -m`: `arm64` o `x86_64`) | |
| Usuario de macOS usado (no administrador, si es posible) | |

| # | Verificación | Fecha | Versión | Resultado |
|---|---|---|---|---|
| M1 | Descargar del draft el `.dmg` y `SHA256SUMS` | | | [ ] |
| M2 | `shasum -a 256` coincide exactamente con la línea de `SHA256SUMS` | | | [ ] |
| M3 | Arrastrar Spa a Aplicaciones. Primera apertura: clic derecho → Abrir **no** basta; se resuelve con Ajustes del Sistema → Privacidad y seguridad → **Abrir igualmente**. Anotar el texto exacto del aviso | | | [ ] |
| M4 | Alternativa `xattr -dr com.apple.quarantine /Applications/Spa.app` abre la app sin el paso de Privacidad y seguridad | | | [ ] |
| M5 | Primer arranque: crear Propietaria; código de recuperación mostrado una vez; casilla obligatoria | | | [ ] |
| M6 | Verificación 3 del plan (rol sin `catalog.write`, edición rechazada en Rust) | | | [ ] |
| M7 | Verificación 4 del plan (10 min de inactividad y suspensión/reanudación) | | | [ ] |
| M8 | Verificación 5 del plan (cliente, cita, solape rechazado, pago mixto, historial y métricas) | | | [ ] |
| M9 | Verificación 6 del plan (`spa.db` no se abre con un cliente SQLite normal) | | | [ ] |
| M10 | Verificación 7 del plan (binario real): exportar; mover `~/Library/Application Support/com.progdarkness.spa` fuera; restaurar con la frase; integridad y login | | | [ ] |
| M11 | Verificación 8 del plan (binario real): archivo corrupto y de versión futura rechazados con su mensaje exacto; BD actual intacta | | | [ ] |
| M12 | Banner semanal: aparece sin respaldos y desaparece tras exportar | | | [ ] |
| M13 | Sin red durante el uso | | | [ ] |
| M14 | Fallo de arranque provocado: diálogo "Spa no pudo iniciar" con el texto de la guía | | | [ ] |
| M15 | Firma ad-hoc: `codesign -dv /Applications/Spa.app` muestra la firma ad-hoc (sin Developer ID). Anotar la salida | | | [ ] |

## 3. Transferencias entre sistemas

| # | Verificación | Fecha | Versión | Resultado |
|---|---|---|---|---|
| X1 | Exportar en la máquina Windows con datos de prueba; restaurar en la máquina macOS (primer arranque) y entrar con un usuario del respaldo | | | [ ] |
| X2 | Exportar en macOS; restaurar en Windows (primer arranque) y entrar con un usuario del respaldo | | | [ ] |
| X3 | La frase del respaldo funciona entre sistemas; los datos de citas, pagos y clientes coinciden con el origen | | | [ ] |
| X4 | El aviso "Respaldo restaurado" aparece en el login tras la restauración | | | [ ] |

## 4. Verificación sin red

| # | Verificación | Fecha | Versión | Resultado |
|---|---|---|---|---|
| N1 | Con la red desconectada, la instalación (salvo WebView2) y el uso completo funcionan | | | [ ] |
| N2 | Exportación y restauración completas sin red | | | [ ] |

## 5. Cierre

- [ ] Todas las casillas de las secciones 1 a 4 están en `OK`, o cada `FALLO` tiene su resolución y repetición registrada.
- [ ] Ningún dato real de la spa se usó en estas pruebas; los respaldos de prueba se borraron tras la prueba.
- [ ] Los instaladores verificados coinciden con los publicados en el draft.
- [ ] El release sigue en draft. La publicación la decide el propietario del repositorio.

## Qué no cubre esta checklist

- No prueba la firma de desarrollador ni la notarización (no existen en la Fase 8, ver ADR 0012, DB10b).
- No prueba la actualización automática (no existe).
- No prueba Linux (fuera del alcance de la Fase 8).
