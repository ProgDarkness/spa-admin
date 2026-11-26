# Plan MVP — App de gestión del spa (escritorio, offline)

Estado: **completado con decisiones D1–D18 tras dos rondas de revisión (2026-11-12). Ejecución aún no iniciada.**

## Context

Spa de 2 cabinas (dueña, socia, empleada y manicurista en alquiler). Hoy operan con cuadernos (agenda, cuentas por cobrar, finanzas) y duplican datos a mano. Reunión del 2026-11-04 (minuta + notas Gemini en `docs/levantamiento/`) acordó un MVP de **registro de clientes, citas, catálogo de servicios, historial/seguimiento, autenticación con roles y permisos granulares, auditoría y métricas básicas**.

Restricciones fijadas (sustituyen lo de "móvil" de la minuta):
- Tauri 2 + Next.js (front) · Rust (backend) · Windows y macOS.
- BD embebida, **sin servidores ni red**.
- Mono-equipo (laptop de recepción); multiusuario = cuentas/roles en esa máquina; sin sincronización.
- BD cifrada con SQLCipher; respaldo/restauración manual por archivo cifrado.
- Móvil fuera del MVP.

## Alcance

**Dentro:** clientes (nombre, apellido, cédula obligatoria, teléfono; carga solo por el equipo) · catálogo (servicio o paquete como servicio, precio, duración) · recursos agendables (cabinas y puestos configurables) · citas (cliente + servicio + recurso + horario, sin solapes) · pagos por cita (método, monto, moneda) y tasa de cambio manual · historial por cliente (citas, tiempo invertido, monto pagado) · login, usuarios, roles, permisos granulares · auditoría de datos y de seguridad · métricas básicas · respaldo/restauración cifrados.

**Fuera (fases posteriores):** cuentas por cobrar y abonos con saldo, contador de sesiones de paquetes, flujo de caja, ficha médica láser, automatización o lectura de WhatsApp (Gabriel la propuso en la reunión; no fue acordada y queda fuera del MVP), confirmación de citas y notificaciones, autorregistro de clientes, móvil, sincronización multi-equipo, auto-update, importación de los cuadernos, firma de instaladores.

## Decisiones tomadas (2026-11-12)

| # | Tema | Decisión |
|---|---|---|
| D1 | Equipos | Mono-equipo, multiusuario por roles, respaldo manual. |
| D2 | Cifrado | SQLCipher; clave aleatoria en keychain del SO. |
| D3 | Móvil | Fuera del MVP. |
| D4 | Arquitectura | Vertical slices en Rust (`commands → service → repository`), sin hexagonal/DDD. |
| D5 | Pagos | Cada cita admite 1..N registros de pago (método, moneda, monto), en cualquier estado de la cita (p. ej. seña en una cita luego cancelada). Los pagos no se borran: se anulan (`voided_at`, `voided_by`, `void_reason`), la anulación se audita como `void` y los anulados no suman en totales. Las tasas (`exchange_rates`) tampoco se borran: una por fecha, corregir es un `update` auditado con diff; los pagos ya guardados conservan la tasa que usaron. Sin saldo ni cuentas por cobrar. |
| D6 | Moneda | Dos monedas: USD (base del catálogo) y VES. Tasa Bs/USD ingresada a mano por día. Un pago se captura en la moneda en que se recibió. Pago en USD: no usa tasa. Pago en VES: guarda el monto en bolívares y la tasa usada (por defecto la del día; editable en el pago). Sin tasa disponible, el pago en VES no se puede guardar. Equivalente USD = `monto_ves / tasa`, redondeado half-up a centavos, calculado al guardar y almacenado. |
| D7 | Cédula | **Obligatoria desde el MVP**, única, formato `V|E|J-dígitos`; sin marcador "pendiente". Riesgo conocido: la empleada dijo que muchos clientes llegan solo con nombre; en la Fase 0 se le avisa de la regla, pero no la condiciona. |
| D8 | Paquetes | Un paquete es un servicio más (precio total, duración por sesión). Sin contador de sesiones restantes. |
| D9 | Recursos | Tabla `resources` configurable (cabinas y puesto de manicure); la manicurista puede agendar en el suyo si la Propietaria lo activa. Los recursos se desactivan, nunca se borran. Uno inactivo no acepta citas nuevas y conserva las pasadas. Desactivar uno con citas futuras programadas se bloquea hasta reubicarlas (se lista cuáles). |
| D10 | Solapes | Intervalo `[inicio, fin)`, `fin = inicio + duración congelada`. Bloquean: programada, en curso, completada. Liberan: cancelada, no asistió. Una cita no cruza medianoche: la que termina exactamente a las 00:00 del día siguiente se permite (23:00 + 60 min es válida; 23:30 + 60 min se rechaza). Validado dentro de transacción. |
| D11 | Fechas | Hora local sin zona, texto `YYYY-MM-DDTHH:MM` (auditoría con segundos). Sin conversión. Zona operativa de referencia: America/Caracas (UTC-4, sin horario de verano); la app usa el reloj del equipo. Riesgo aceptado: si alguien cambia el reloj o la zona, cambian las marcas. Mitigación: al arrancar, si la hora del sistema es anterior en más de 5 min a la última marca de auditoría, la app muestra una advertencia y lo registra como evento de seguridad. |
| D12 | Sesión | Bloqueo a los 10 min sin actividad del usuario y al reanudar el equipo; 5 intentos fallidos = espera de 5 min. Al bloquear se exige autenticación antes de cualquier comando protegido. |
| D13 | Contraseña olvidada | Código de recuperación de un solo uso para la Propietaria: 20 caracteres base32 (100 bits de entropía) en grupos de 4, generado con el CSPRNG del SO. Se muestra una vez al crear la cuenta y exige confirmar que se guardó (impreso). Solo se almacena su hash argon2id. Sin caducidad; al usarlo se invalida y se genera uno nuevo. Comparte el contador de intentos fallidos de D12. Nunca se escribe en auditoría ni en logs (solo el evento `recovery_used`). Otros usuarios los restablece la Propietaria. |
| D14 | Clave y respaldo | Respaldo cifrado con frase del usuario que incluye BD, clave y versión de esquema. Restaurar reemplaza BD y clave de forma atómica. Recordatorio semanal de respaldo en la app. |
| D15 | Auditoría | Cambios de datos + eventos de seguridad (login, fallos, bloqueos, respaldo, restauración, `recovery_used`, retroceso de reloj). Acciones auditadas: `create` (valores nuevos), `update` (campo: antes → después), `deactivate` / `soft_delete` y `reactivate`, para clientes, servicios, recursos, citas, pagos, métodos de pago (`payment_method`), tasas, usuarios, roles y permisos. El diff excluye `password_hash`, `recovery_code_hash` y claves. Registro de solo inserción. Usuarios se desactivan, no se borran. |
| D16 | Métricas | **Nuevo** = primera cita completada en el mes. **Recurrente** = ya tenía una completada antes del mes y completó otra en él. Citas por mes: programadas y completadas por separado; canceladas y no asistió aparte. **Ingreso** = suma de pagos no anulados de citas completadas, por moneda, sin convertir. Los pagos no anulados de citas canceladas o "no asistió" se muestran aparte como "cobros en citas no completadas" (por moneda) y en el historial del cliente; no cuentan como ingreso. |
| D17 | Entrega | Se parte de cero (sin importar cuadernos). CI publica los instaladores y su SHA-256 en un release privado de GitHub; Gabriel los descarga y los entrega por USB. La guía incluye comparar el hash antes de instalar y los pasos para SmartScreen (Windows) y Gatekeeper (macOS). Firma queda para después. |
| D18 | Agenda | El MVP solo crea, mueve y cancela citas. Fuera: motivo de reprogramación, estado "por confirmar/confirmada", registro de retrasos y notificaciones; la confirmación y los avisos por retraso siguen siendo manuales por WhatsApp. |
| D19 | Tasa | La tasa Bs/USD se guarda como entero escalado x10^4 (`rateBsPerUsdE4`) con aritmética entera y redondeo half-up; se registra en el ADR 0003. |
| D20 | Naming | camelCase en TypeScript y `serde(rename_all = "camelCase")` en Rust, para que `bindings.ts` de tauri-specta sustituya a `src/lib/model.ts` sin renombrar. |
| D21 | Mock | El prototipo guarda sus datos solo en memoria (al recargar vuelve al seed). |
| D22 | Alcance Fase 0 | Entran los 13 slices S0–S12 (incluye E2E de humo). Quedan fuera de la Fase 0 el bloqueo por inactividad (D12) y la gestión de usuarios y roles. |

## Decisión de arquitectura (D4)

Señal: 6 capacidades independientes (auth, clients, catalog, appointments, metrics, audit), una sola BD y un solo equipo → **vertical slices en Rust con capas planas dentro de cada slice**. Sin hexagonal/DDD: no hay segunda infraestructura ni invariantes ricas que lo justifiquen (YAGNI, `architecture.md`). Cambia: carpeta por feature, no por capa.

ADRs a crear en `docs/adr/` durante la Fase 1: `0001-arquitectura.md`, `0002-cifrado-y-respaldo.md` (D2, D13, D14), `0003-fechas-y-moneda.md` (D6, D11).

## Stack

| Capa | Elección |
|---|---|
| Shell | Tauri 2 |
| Front | Next.js (App Router) con `output: 'export'` (sin SSR ni API routes), TypeScript estricto, Tailwind + shadcn/ui, react-hook-form + zod, TanStack Query |
| Backend | Rust: `rusqlite` con `bundled-sqlcipher-vendored-openssl`, `rusqlite_migration`, `argon2`, `keyring`, `chacha20poly1305` (respaldo), `thiserror`, `serde`, `time` |
| Contrato IPC | `tauri-specta` genera tipos TS desde los comandos Rust |
| Gestor | **bun** (único permitido) |
| CI | GitHub Actions, matriz `windows-latest` + `macos-latest`, `tauri-action` |

Versiones se fijan en la Fase 1 (lockfiles `bun.lock` y `Cargo.lock` versionados).

## Modelo de datos (SQLite, PK entera autoincremental)

- `users(id, username UNIQUE, password_hash, role_id, active, recovery_code_hash NULL)` · `roles(id, name)` · `permissions(key)` · `role_permissions(role_id, permission_key)`
- `clients(id, first_name, last_name, national_id UNIQUE NOT NULL, phone NOT NULL, deleted_at)`. Un cliente borrado lógicamente se reactiva en vez de duplicarse; su cédula sigue reservada.
- `services(id, name, price_cents, currency='USD', duration_min, active)` (incluye paquetes)
- `resources(id, name, kind: cabin|manicure, active)`
- `appointments(id, client_id, service_id, resource_id, starts_at, ends_at, status, price_cents_snapshot, duration_min_snapshot, notes)`; estados: `scheduled|in_progress|completed|cancelled|no_show`. Transiciones (siempre manuales, desde la agenda, con `appointments.write`; ninguna ocurre por tiempo): `scheduled → in_progress` (Iniciar), `in_progress → completed` (Completar), `scheduled → no_show` (No asistió), `scheduled|in_progress → cancelled` (Cancelar). Mover (cambiar fecha, hora o recurso) solo en `scheduled`. `completed`, `cancelled` y `no_show` son finales; corregir un error es `→ scheduled` con el permiso `appointments.reopen` (solo Propietaria), auditado. Se puede completar una cita directamente desde `scheduled` si ya pasó su hora de inicio (atajo Iniciar + Completar en una acción)
- `payment_methods(id, name, active)` (efectivo, pago móvil, Zelle, transferencia, punto de venta; editable)
- `exchange_rates(date, bs_per_usd)` (entrada manual)
- `appointment_payments(id, appointment_id, method_id, currency: USD|VES, amount_cents, rate_bs_per_usd NULL (obligatoria si VES), usd_equivalent_cents, paid_at, voided_at NULL, voided_by NULL, void_reason NULL)`
- `audit_log(id, user_id, kind: data|security, entity, entity_id, action, diff_json, at)` con triggers que prohíben `UPDATE` y `DELETE`.

Todas las tablas de negocio llevan `created_by/updated_by/created_at/updated_at`. Citas y servicios inactivos siguen visibles en el historial.

### Permisos (`recurso.acción`)

`clients.read|write` · `catalog.read|write` · `resources.manage` · `appointments.read|write` · `appointments.reopen` · `payments.read|write` · `rates.manage` · `metrics.read` · `audit.read` · `users.manage` · `backup.manage`. Se validan **en Rust** en cada comando; el front solo oculta UI. Roles semilla: Propietaria (todos), Recepción (clientes, citas, pagos, catálogo en lectura, tasas), Solo lectura. La Propietaria puede crear otros.

## Seguridad (offline)

- Clave SQLCipher aleatoria en el primer arranque, guardada en Credential Manager (Windows) o Keychain (macOS) vía `keyring`.
- Contraseñas con argon2id. Sesión solo en memoria de Rust; el bloqueo (D12) invalida la sesión en Rust, no solo la pantalla. La reanudación del equipo se detecta comparando reloj monotónico y de pared en un latido periódico.
- CSP estricta de Tauri, sin allowlist `http`: la app no abre conexiones de red.
- Primer arranque: asistente crea la cuenta Propietaria y muestra el código de recuperación.

### Respaldo y restauración

- Archivo `.spabak`: BD + clave + `schema_version`, cifrado con frase del usuario (KDF argon2id + XChaCha20-Poly1305).
- Restaurar: descifrar a un archivo temporal → `integrity_check` → validar versión (acepta igual o menor y migra; rechaza mayor) → intercambio atómico → guardar la nueva clave en el keychain. La BD previa se conserva como `.bak` hasta confirmar apertura correcta.
- Migraciones numeradas y transaccionales; antes de migrar se copia el archivo de BD. Si falla, la original queda intacta.

## Estructura propuesta

```
spa-app/
├─ docs/{planeers,adr,qa}/
├─ src/                      # Next.js
│  ├─ app/(auth|clientes|citas|catalogo|metricas|usuarios|ajustes)/
│  ├─ features/<feature>/{components,hooks,schemas}
│  └─ lib/bindings.ts        # generado por tauri-specta
└─ src-tauri/src/
   ├─ main.rs, db/{connection,migrations}.rs, errors.rs
   └─ features/{auth,clients,catalog,resources,appointments,payments,metrics,audit,backup}/
        {commands,service,repository,model}.rs
```

## Estrategia de pruebas (TDD: rojo → verde → refactor)

| Nivel | Qué cubre | Herramienta |
|---|---|---|
| Unitarias | Reglas en `service` (solape, permisos, métricas, validación de cédula) | `cargo test`, Vitest |
| Integración | `repository` y migraciones sobre SQLCipher en memoria; keyring con backend `mock` (`keyring::mock`), por defecto en local y CI | `cargo test` |
| Keyring real | Un único test de humo por SO (guardar, leer y borrar una clave real; abrir una BD SQLCipher con ella) tras el feature `real-keyring`; corre solo en CI `windows-latest` y `macos-latest` (en macOS con un llavero temporal creado con `security create-keychain` y puesto por defecto en el paso de CI). No corre en WSL/Linux local | `cargo test --features real-keyring` |
| Componentes | Formularios y vistas con IPC simulado | Vitest + Testing Library |
| E2E | Recorridos de UI con IPC simulado | Playwright sobre Next (tauri-driver no soporta macOS) |
| Manual reproducible | Instalación y flujos en Windows y macOS limpios | `docs/qa/checklist-instalacion.md` |

Cobertura mínima 80 % de líneas en `src-tauri/src/features/**` (`cargo llvm-cov`) y `src/features/**` (Vitest v8). Se excluyen `lib/bindings.ts` y `components/ui/` de shadcn.

Casos límite obligatorios: solape en el límite exacto (`fin == inicio` no solapa), cita que cruza medianoche rechazada, cambio de precio o duración del servicio no altera citas existentes, cédula duplicada y reactivación de cliente borrado, restauración con archivo inválido o versión futura, migración con fallo intermedio, comando protegido tras bloqueo, métricas en el límite de mes, pago en VES sin tasa rechazado, redondeo half-up del equivalente USD, código de recuperación de un solo uso (reutilización rechazada y ausencia en auditoría), desactivar recurso con citas futuras bloqueado, advertencia por retroceso de reloj, transiciones de estado válidas e inválidas (mover una cita no `scheduled` rechazado; reabrir sin `appointments.reopen` rechazado), pago en cita cancelada que no suma como ingreso.

## Fases

Estimaciones para una persona a tiempo parcial. Cada fase cierra con sus tests en verde y su criterio de salida.

0. **Prototipo visual (4–5 días con TDD y cobertura ≥80 %, 13 slices S0–S12).** Pantallas Next con datos mock: agenda por recurso, ficha de cliente + historial y pagos, catálogo, tasas, métricas, login. Se muestra a la empleada y la dueña. Se informa a la empleada de la regla D7 (cédula obligatoria) y se valida la lista de métodos de pago y la lista de métricas. Salida: aprobación explícita.
1. **Scaffold y prueba vertical (2–3 días).** `bun create tauri-app`, Next export, CI Win + macOS, lint/format, tauri-specta, ADRs 0001–0003. **Criterio de salida:** en ambos SO se generan los bindings, carga el build exportado, SQLCipher abre una BD con una clave guardada en el keychain **real** del SO (test de humo `real-keyring` en CI Windows y macOS) y un login mínimo funciona. El resto de pruebas de integración usa el backend `mock`.
2. **Núcleo de datos y seguridad (5–6 días).** Conexión, migraciones con copia previa, auth, roles/permisos, bloqueo de sesión, código de recuperación, auditoría de solo inserción. Tests: permiso denegado, hash, bloqueo y reanudación, 5 intentos fallidos, auditoría con diff.
3. **Catálogo, recursos, métodos de pago y tasas (2–3 días).** CRUD con seed de ejemplo hasta recibir el catálogo real de la empleada.
4. **Clientes (2 días).** CRUD, búsqueda por nombre/cédula/teléfono, formato y unicidad de cédula, reactivación.
5. **Citas (4–5 días).** Crear/mover/cancelar, vista día/semana por recurso, solape, estados.
6. **Pagos e historial (3 días).** Registro de pagos por cita (USD/VES con tasa congelada), línea de tiempo por cliente, tiempo total y monto pagado.
7. **Métricas (2–3 días).** Definiciones D16, consultas SQL agregadas; lista ampliable cuando la empleada y la dueña cierren la suya.
8. **Respaldo y empaquetado (3–4 días).** Exportar/importar `.spabak`, recordatorio semanal, instaladores `.msi/.exe` y `.dmg` (macOS como binario universal `universal-apple-darwin`, para Apple Silicon e Intel), guía de instalación y manual breve, checklist en máquinas limpias. **Criterio de salida:** el instalador descargado del release privado, verificado con su SHA-256 y sin firma, se instala y llega al primer arranque (crear Propietaria) en un Windows y un macOS limpios siguiendo solo la guía (macOS 15 y posteriores: clic derecho → Abrir ya no basta; usar Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente, o `xattr -dr com.apple.quarantine`). Decisiones de la Fase 8 en la sección siguiente y en `docs/adr/0012-respaldo-y-empaquetado.md`.

**Total estimado: 28–35 días de trabajo** (la Fase 0 pasó de 1–2 a 4–5 días) (incluye integración de CI en dos SO, pruebas en máquinas limpias y 1 día de margen). Tu entorno de desarrollo es WSL/Linux: el instalador de macOS y las pruebas en macOS dependen de CI o de un Mac prestado.

### Decisiones de la Fase 8 (2026-11-26)

- **Instaladores:** NSIS y MSI en Windows, DMG universal en macOS (Q1). NSIS por usuario (`installMode: currentUser`).
- **Release:** draft en el repositorio público; nunca se publica desde el flujo automatizado. La publicación es manual (Q2, DB11).
- **WebView2:** `downloadBootstrapper`; requiere internet durante la instalación salvo que el runtime ya esté presente (Q3, supuesto por confirmar).
- **Fallo de arranque:** diálogo nativo que remite al Manual de usuario entregado junto al instalador, sección "Si la aplicación no abre" (Q4, DB12).
- **Firma macOS:** firma ad-hoc (`signingIdentity "-"`), aceptada como no-firma a efectos de D17 (Q5). Sin Developer ID ni notarización.
- **Restauración:** reemplaza todos los datos y la clave; no hay rollback tras el éxito (ver ADR 0012, M3 y L7).

## Dependencias externas / pendientes

- La empleada: catálogo real con precios y duración; lista de métricas validada con la dueña; lista de métodos de pago; enterarse de D7 (cédula obligatoria).
- Spa: cuántas cabinas y si la manicurista agenda en la app (configurable, no bloquea).
- Spa: hábito de cargar la tasa Bs/USD cada día (la UI avisa si falta la del día).
- Gabriel: prototipo (Fase 0).

## Notas de arquitectura de la Fase 0 (para el ADR 0001)

- `src/lib/session.tsx` importa `@/features/auth/api`: es la única costura lib → feature. Es aceptada porque la sesión es la pieza que la Fase 1 reemplaza por el comando de Tauri; ningún otro archivo de `lib/` importa features y la frontera del mock se mantiene.
- Cruces entre features: se permiten los hooks de otra feature (`useClients`, `useServices`, `usePaymentMethods`) y las funciones puras de `payments/domain` desde `client-history/compute`. Los componentes de una feature solo importan componentes de otra cuando la integración lo exige (`PaymentsButton` en la tarjeta de la cita y en la ficha).
- Frontera del mock: `@/lib/mock/*` solo se importa desde `features/*/api.ts`, tests, `src/test/**` y `e2e/**`; la regla `no-restricted-imports` de ESLint lo impone.
- El prototipo valida permisos en cada `api.ts` imitando a Rust; la UI solo oculta controles.

## Verificación end-to-end

1. `bun install && bun run tauri dev` abre la app sin red (desconectar WiFi y repetir).
2. `cargo test` y `bun run test` (Vitest; `bun test` lanzaría el runner nativo de bun) en verde; cobertura ≥80 % según lo definido arriba.
3. Primer arranque → crear Propietaria → anotar código de recuperación → crear rol sin `catalog.write` → comprobar que editar catálogo falla en Rust.
4. Dejar 10 min inactivo → comando protegido rechazado hasta reautenticar; repetir tras suspender y reanudar el equipo.
5. Crear cliente → cita → intentar cita solapada (rechazada) → registrar pago mixto USD + VES → ver historial y métricas.
6. Abrir el `.db` con un cliente SQLite normal: debe fallar.
7. Exportar respaldo, borrar datos y clave del keychain, restaurar con la frase, comprobar integridad y que el login funciona.
8. Restaurar un `.spabak` corrupto y otro de versión futura: ambos rechazados sin tocar la BD actual.
9. Instalar el artefacto de CI en un Windows y un macOS limpios, seguir la guía y repetir 3–5.
