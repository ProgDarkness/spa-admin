# Guía de instalación de Spa

- **Versión:** 0.1.0
- **Fuente:** release **draft** de este repositorio (`v0.1.0`). El draft no está publicado: solo lo ve quien tenga acceso de escritura al repositorio. Si el draft no aparece en la página de releases, pedir a la persona que lo creó que lo comparta.
- **Decisiones:** `docs/adr/0012-respaldo-y-empaquetado.md` (DB10, DB10b, DB11, L10 a L13).

## 1. Qué descargar

Del release draft, descargar:

| Sistema | Archivo | Cuándo |
|---|---|---|
| Windows | `Spa_0.1.0_x64-setup.exe` (NSIS, instalación por usuario) | Recomendado |
| Windows | `Spa_0.1.0_x64_en-US.msi` (MSI) | Si la política del equipo exige MSI |
| macOS | `Spa_0.1.0_universal.dmg` (Apple Silicon e Intel) | Siempre |
| Todos | `SHA256SUMS` | Obligatorio para verificar |

Los nombres mostrados son los previstos por la configuración de Tauri (`productName` Spa, versión 0.1.0); confirmar los nombres reales en el draft. Deben coincidir con las líneas de `SHA256SUMS`.

## 2. Verificar el hash antes de instalar

Verificar cada instalador contra `SHA256SUMS`. Si el hash no coincide, no instalar; volver a descargar y, si vuelve a fallar, avisar a quien publicó el release.

**Windows (PowerShell):**

```
Get-FileHash -Algorithm SHA256 "C:\ruta\al\instalador.exe"
```

Comparar la columna `Hash` con la línea correspondiente de `SHA256SUMS`. La comparación debe ser exacta, carácter por carácter.

**macOS (Terminal):**

```
shasum -a 256 /ruta/al/Spa_0.1.0_universal.dmg
```

Comparar la primera columna con la línea correspondiente de `SHA256SUMS`.

Nota: `SHA256SUMS` viene del mismo release que el instalador. Comprueba que el archivo no se corrompió en la descarga o la copia, pero no prueba quién lo publicó.

## 3. Copiar por USB

- Calcular el hash **antes** de copiar al USB y volver a calcularlo en el equipo destino.
- Un USB en FAT32 puede perder la marca de "descargado de internet" del archivo. Con esa marca perdida, Windows puede no mostrar el aviso de SmartScreen. No es una señal de que el archivo esté bien: el hash es la única verificación válida.

## 4. Windows

1. Ejecutar `Spa_0.1.0_x64-setup.exe` (o el `.msi`).
2. SmartScreen puede mostrar "Windows protegió su PC" porque el instalador no está firmado. Pulsar **Más información** y después **Ejecutar de todas formas**.
3. Si el instalador NSIS pide instalar para el usuario actual, aceptar: no requiere privilegios de administrador.
4. Si el equipo no tiene WebView2, el instalador lo descarga durante la instalación. Eso requiere conexión a internet en ese momento. Una vez instalada, la app no usa la red (ver `docs/adr/0012-respaldo-y-empaquetado.md`, L10).
5. Al terminar, abrir **Spa** desde el menú inicio.

## 5. macOS

1. Abrir el `.dmg` y arrastrar **Spa** a la carpeta **Aplicaciones**.
2. Expulsar el disco del DMG.
3. Abrir **Spa** desde Aplicaciones. Desde macOS 15 (Sequoia), **clic derecho → Abrir ya no basta** para la primera apertura, porque la app no está notarizada.
   - Intentar abrir la app una vez (aparecerá un aviso de que no se puede verificar). Luego ir a **Ajustes del Sistema → Privacidad y seguridad**, bajar hasta el aviso de Spa y pulsar **Abrir igualmente**. Confirmar con la contraseña del equipo.
   - Alternativa en Terminal, con la app ya en Aplicaciones:

     ```
     xattr -dr com.apple.quarantine /Applications/Spa.app
     ```

     Este comando quita la marca de cuarentena solo de Spa. Después, abrir la app normalmente.

En versiones anteriores a macOS 15, clic derecho → **Abrir** funciona. No se ha verificado en esta sesión.

## 6. Primer arranque

1. Al abrir Spa por primera vez, la app muestra **Crear cuenta Propietaria**. Completar nombre de usuario y contraseña (mínimo 10 caracteres).
2. La app muestra el **código de recuperación** una sola vez. Anotarlo en papel y guardarlo en un lugar seguro. Marcar la casilla que confirma que se guardó; sin esa casilla no se continúa.
3. El código sirve para restablecer la contraseña de la Propietaria si la olvida. No se puede volver a ver.
4. Para restaurar datos desde un respaldo en lugar de empezar de cero, usar **Restaurar desde un respaldo** en la pantalla de primer arranque (ver el Manual de usuario).

## 7. Problemas frecuentes

| Síntoma | Qué hacer |
|---|---|
| El hash no coincide | No instalar. Volver a descargar desde el release; si sigue igual, avisar. |
| SmartScreen no ofrece "Ejecutar de todas formas" | Verificar el hash y volver a intentar; si persiste, avisar. |
| macOS impide abrir la app | Es el bloqueo de Gatekeeper por falta de notarización: seguir el punto 5. |
| El instalador de Windows pide internet | Es WebView2 (punto 4.4). Conectar el equipo a internet para la instalación. |
| La app muestra "Spa no pudo iniciar" | Abrir el Manual de usuario entregado junto al instalador (USB), sección "Si la aplicación no abre". |
