# Manual de Spa (breve)

Para la Propietaria del spa. Este manual se entrega junto con el instalador (por ejemplo, en la misma memoria USB): guárdalo en un lugar al que puedas acceder aunque la aplicación no abra.

## 1. Entrar

- Entrar con usuario y contraseña.
- Si olvidas la contraseña, usa el código de recuperación que anotaste al crear la cuenta. Cada código sirve una sola vez; al usarlo, la app muestra uno nuevo que debes anotar.
- Si ingresas mal la contraseña cinco veces seguidas, la cuenta se bloquea 5 minutos.

## 2. Bloqueo por inactividad

- Si no usas la app durante 10 minutos, la sesión se bloquea. Vuelve a ingresar tu contraseña para seguir.
- Si el equipo se suspende o se apaga y vuelve a encenderse, la sesión también se bloquea.

## 3. Respaldo

Un respaldo es un archivo `.spabak` con todos los datos del spa, cifrado con una frase que tú eliges.

**Importante:**

- **Si pierdes la frase, el respaldo no se puede abrir.** Anótala en papel y guárdala aparte del archivo.
- Guarda el archivo en una memoria USB u otro lugar distinto del equipo.

### Respaldar cada semana

1. Ve a **Ajustes → Respaldo**. Si pasaron más de 7 días desde el último respaldo (o nunca has hecho uno), verás un aviso en la parte superior de la app.
2. En **Exportar respaldo**, escribe la frase dos veces (mínimo 12 caracteres) y pulsa **Exportar respaldo**.
3. Elige dónde guardar el archivo. El nombre sugerido es `spa-respaldo-AAAA-MM-DD-HHMM.spabak`.
4. Cuando aparezca "Respaldo guardado", copia el archivo a la memoria USB. El aviso desaparece.
5. Si cancelas la ventana de guardar, no pasa nada: no se muestra error ni se crea respaldo.

## 4. Restaurar un respaldo

**Restaurar reemplaza todos los datos actuales** por los del respaldo, incluidas las cuentas y la contraseña de cada usuario. No se puede deshacer.

Antes de restaurar, **exporta un respaldo de los datos actuales**. La pantalla de restauración te lo recuerda.

En **Ajustes → Respaldo → Restaurar respaldo**:

1. Escribe la frase del respaldo que quieres restaurar.
2. Marca "Entiendo que se reemplazarán todos los datos actuales".
3. Pulsa **Restaurar respaldo** y elige el archivo `.spabak`.
4. Si todo sale bien, la app te lleva a la pantalla de inicio de sesión con el aviso "Respaldo restaurado". Entra con un usuario que exista en el respaldo (no con el que usabas antes, si no estaba en el respaldo).
5. Si la frase no coincide o el archivo está dañado, la app muestra "La frase no coincide o el archivo está dañado". Tus datos actuales no cambian.
6. Si el archivo fue creado con una versión más nueva de la app, la app lo rechaza con un mensaje. Actualiza la app antes de restaurar.

### Restaurar en un equipo nuevo (primer arranque)

Usa esta opción en una instalación nueva, sin cuentas creadas:

1. Abre Spa. En lugar de crear la cuenta Propietaria, pulsa **Restaurar desde un respaldo**.
2. Escribe la frase y elige el archivo `.spabak`. Marca la casilla de confirmación y pulsa **Restaurar respaldo**.
3. Entra con un usuario del respaldo. El código de recuperación que sirve después de restaurar es el que estaba vigente cuando se creó el respaldo.

## 5. Si la aplicación no abre

Si ves el aviso **"Spa no pudo iniciar"** con el texto:

> La aplicación no pudo abrir sus datos y se cerrará. Abre el Manual de usuario que recibiste con el instalador: en la sección "Si la aplicación no abre" se explica cómo apartar la carpeta de datos y restaurar un respaldo en el primer arranque.

la app se cerrará sola. Sigue estos pasos. **No borres nada**: solo mueves archivos.

**Paso 1. Cierra la app del todo.** Revisa que no esté en la bandeja del sistema.

**Paso 2. Busca la carpeta de datos.**

- Windows: `C:\Users\<tu usuario>\AppData\Roaming\com.progdarkness.spa`
  (en el Explorador de archivos, escribe `%APPDATA%` en la barra de direcciones y entra a `com.progdarkness.spa`).
- macOS: `~/Library/Application Support/com.progdarkness.spa`
  (en el Finder: Ir → Ir a la carpeta, y escribe `~/Library/Application Support/`).

**Paso 3. Mueve la carpeta a otro lugar.** Crea una carpeta llamada, por ejemplo, `spa-datos-anteriores` en el Escritorio y mueve dentro `com.progdarkness.spa`. No la borres; guárdala hasta que la restauración funcione.

Si prefieres mover solo la base de datos, mueve los archivos `spa.db`, `spa.db-journal`, `spa.db-wal` y `spa.db-shm` (los que existan). No muevas ni borres los archivos `spa.db.*.bak`, que son copias automáticas de la base de datos.

**Paso 4. No borres la clave del llavero.** La app gestiona la clave sola:

- Si el llavero del sistema todavía tiene la clave, la app la reutiliza y la reemplaza al restaurar el respaldo.
- Si no la tiene, la app crea una clave nueva.

Por eso no hace falta tocar el Llavero de macOS ni el Administrador de credenciales de Windows.

**Paso 5. Abre Spa de nuevo.** Como ya no hay datos, aparece la pantalla de primer arranque.

**Paso 6. Restaura el respaldo.** Pulsa **Restaurar desde un respaldo** y sigue la sección "Restaurar en un equipo nuevo (primer arranque)".

**Si la app vuelve a mostrar "Spa no pudo iniciar"** después de los pasos anteriores, no sigas moviendo archivos. Guarda la carpeta apartada y el respaldo, y pide ayuda con esta información: sistema operativo y versión, y si el aviso aparece antes o después de mover la carpeta.

Limitación: si el llavero del sistema no está disponible (por ejemplo, el Administrador de credenciales o el llavero están bloqueados o dañados), este procedimiento no lo arregla. El aviso no distingue esa causa.

## 6. Recordatorios

- Exporta un respaldo cada semana.
- Guarda la frase del respaldo y el código de recuperación en lugares distintos del equipo.
- Guarda la copia USB en un lugar seguro distinto del spa.
