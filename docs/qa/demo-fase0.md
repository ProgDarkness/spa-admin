# Guion de demo - Fase 0 (prototipo)

Para: La empleada y la dueña. Duración sugerida: 10 a 15 minutos.

Aviso: esto es un prototipo. Todos los datos viven en la memoria del navegador. Al recargar la página (F5) o cerrar la pestaña, todo vuelve a los datos de ejemplo y hay que iniciar sesión de nuevo. La seguridad real (contraseñas con hash, permisos verificados en el servidor) se construye en Rust en la Fase 2.

## Cómo arrancar

1. `bun install`
2. Opción A (versión exportada): `bun run build` y luego servir la carpeta `out/` con `bunx --no-install serve out -l 4173`; abrir http://localhost:4173
3. Opción B (desarrollo): `bun run dev` y abrir la URL que indique la consola.

## Usuarios de demostración

Contraseña de todos: `demo1234` (credencial pública de demostración, no es secreta).

| Usuario | Rol | Qué puede hacer |
| --- | --- | --- |
| `propietaria` | Propietaria | Todo: agenda, clientes, catálogo, métricas, recursos, tasas, anular pagos; es la única que puede reabrir citas |
| `recepcion` | Recepción | Clientes, agenda y pagos (crear, editar y anular), tasas de cambio; ve el catálogo sin editarlo; no reabre citas; no ve Métricas ni Recursos |
| `lectura` | Solo lectura | Ver agenda, clientes, catálogo y pagos; no crea ni edita nada; hoy no ve Métricas |

## Recorrido sugerido (propietaria)

1. Login (1 min): entrar con `propietaria`. Probar una contraseña incorrecta para ver el error.
2. Agenda (3 min): vista Día y Semana, botones Anterior, Hoy y Siguiente. Franjas de 30 min de 08:00 a 24:00 (la última es 23:30), una columna por cabina; las citas fuera de ese horario aparecen en la fila Fuera de horario. Crear una cita con el botón `+` de una franja libre. Intentar otra cita que se solape en la misma cabina y ver el rechazo. Iniciar y completar una cita; probar Mover y Cancelar.
3. Clientes (2 min): buscar por nombre, cédula o teléfono. Crear un cliente; probar cédula vacía o inválida (por ejemplo `12345678`) y ver el rechazo. Eliminar (pide confirmación) y reactivar. Abrir la ficha de un cliente.
4. Pagos (2 min): desde una cita, botón Pagos. Registrar un pago en USD y otro en bolívares (la tasa del día se completa sola). Ver totales por moneda. Anular un pago con motivo.
5. Ficha del cliente (1 min): historial de citas, tiempo total, pagado por moneda, equivalente en USD de los pagos en bolívares, cobros en citas no completadas.
6. Catálogo (1 min): servicios y métodos de pago. Crear o editar un servicio, activarlo o desactivarlo.
7. Métricas (1 min): elegir el mes y revisar clientes, citas e ingresos.
8. Ajustes (1 min): Recursos (cabinas, activar o desactivar) y Tasas (registrar la tasa del día).
9. Roles (2 min): cerrar sesión y entrar con `recepcion` y con `lectura` para comparar lo que cada uno ve.

## Checklist de validación

Marcar cada punto durante o después de la demo.

- [ ] (a) Regla D7: la cédula es obligatoria al crear un cliente, con formato letra V, E o J, guion y de 6 a 9 dígitos (ejemplo `V-12345678`). Confirmar que es lo que necesitan.
- [ ] (b) Métodos de pago: Efectivo, Pago móvil, Zelle, Transferencia, Punto de venta. Confirmar la lista, agregar los que falten y quitar los que sobren.
- [ ] (c) Métricas y su definición (D16). Confirmar que cada una se entiende y sirve:
  - [ ] Clientes nuevos vs. recurrentes del mes.
  - [ ] Citas por mes (programadas, en curso, completadas, canceladas, no asistió).
  - [ ] Ingresos por moneda (USD y VES por separado, sin mezclarlos).
  - [ ] Cobros en citas no completadas (pagos de citas canceladas o no asistidas; no cuentan como ingreso).
- [ ] (d) La dueña: confirmar si el rol Solo lectura debe ver Métricas (hoy NO tiene ese permiso) y qué permisos debe tener Recepción (hoy: clientes, agenda, pagos incluida la anulación, y tasas; sin reabrir citas, sin catálogo editable, sin métricas, sin recursos).
- [ ] (e) Agenda: confirmar el horario (franjas de 30 min entre 08:00 y 24:00), la cantidad de cabinas y si la manicurista (manicure) agenda; hoy su recurso existe pero está inactivo.
- [ ] (f) Catálogo: los servicios marcados "(ejemplo)" son datos inventados. la empleada debe sustituirlos con los servicios, precios y duraciones reales.
- [ ] (g) Entendido que es un prototipo con datos en memoria y que la seguridad real (hash de contraseñas, permisos) va en Rust en la Fase 2.
