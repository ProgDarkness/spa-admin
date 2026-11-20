# ADR 0006: `users.manage` es control total de usuarios y roles

- **Estado:** Aceptada (riesgo aceptado)
- **Fecha:** 2026-11-17
- **Fase:** 2
- **Fuentes:** `docs/adr/0002-cifrado-y-respaldo.md` (DN5, D13), `docs/adr/0004-sesion-y-auditoria.md` (decisiones 4 y 9; "Límites conocidos"), `docs/planeers/plan-mvp.md` (D13)

## Contexto

- `features/users/commands.rs` (`authorize`) exige `PermissionKey::UsersManage` para todos los comandos de usuarios y roles.
- `create_role` y `set_role_permissions` (`features/users/service.rs`) no comprueban que el actor posea los permisos que otorga. No hay comparación de subconjunto.
- La Propietaria tiene rol `OWNER_ROLE_ID` = 1 (`features/auth/repository.rs`), con `users.manage`.

## Decisión

Quien tiene `users.manage` puede:

- Crear usuarios (`create_user`) y asignarles cualquier rol existente, incluido el de la Propietaria.
- Modificar cualquier usuario (`update_user`: usuario, rol y activo).
- Restablecer la contraseña de cualquier usuario (`reset_user_password` → `reset_password`), incluida la Propietaria.
- Crear roles (`create_role`) y asignar cualquier permiso, incluido `users.manage` (`set_role_permissions`).

Protecciones específicas que existen:

- `set_role_permissions` rechaza quitar `users.manage` al rol `OWNER_ROLE_ID` (validación sobre `permissions`).
- Postcondición del último administrador: `ensure_admin_remains` cuenta usuarios activos con `users.manage` después de aplicar el cambio, dentro de la misma transacción. Si la cuenta queda en cero, la transacción no se confirma. Aplica a `update_user` y a `set_role_permissions`.

No hay otra protección especial de la Propietaria como cuenta. `update_user` y `reset_password` no la distinguen de otros usuarios.

## Riesgo aceptado

- Un administrador puede restablecer la contraseña de la Propietaria y entrar con ella. El control sobre la Propietaria depende de que todo usuario con `users.manage` sea de confianza.
- Un administrador puede conceder `users.manage` a otra cuenta, o crear roles con cualquier permiso.
- Los intentos denegados (`forbidden`) no se auditan (ADR 0004, decisión 6). Un intento sin éxito no deja registro.

## Mitigaciones existentes

- Cada cambio queda auditado con diff de antes y después: `user_created`, `user_updated`, `password_reset`, `role_created`, `role_permissions_changed` (ADR 0004, catálogo de eventos).
- Auditoría de solo inserción: los triggers `audit_log_no_update` y `audit_log_no_delete` (`db/migrations/0003_audit_log.sql`) rechazan `UPDATE` y `DELETE` sobre `audit_log`. No protegen frente a quien controla el archivo y la clave (ADR 0004, "Límites conocidos").
- Postcondición del último administrador en la misma transacción que el cambio (`ensure_admin_remains`).
- Permisos validados en Rust en cada comando mediante `require_permission`.

## Alcance

Restringir los permisos otorgables (que un actor solo pueda conceder permisos que posee, o proteger a la Propietaria frente a `reset_password`) queda fuera del alcance de Fase 2 por decisión del usuario.
