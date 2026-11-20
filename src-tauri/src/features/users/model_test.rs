use super::*;
use crate::db::DbError;
use crate::errors::AppErrorCode;

#[test]
fn inputs_deserialize_from_camel_case() {
    let created: NewUserInput =
        serde_json::from_str(r#"{"username":"ana","password":"clave-larga-1","roleId":2}"#)
            .unwrap();
    let update: UserUpdate = serde_json::from_str(r#"{"id":4,"roleId":3,"active":false}"#).unwrap();
    let reset: PasswordReset =
        serde_json::from_str(r#"{"userId":4,"newPassword":"otra-clave-12"}"#).unwrap();
    let role: NewRole =
        serde_json::from_str(r#"{"name":"Caja","permissions":["clients.read","users.manage"]}"#)
            .unwrap();
    let permissions: RolePermissionsUpdate =
        serde_json::from_str(r#"{"roleId":2,"permissions":["audit.read"]}"#).unwrap();

    assert_eq!((created.role_id, created.username.as_str()), (2, "ana"));
    assert_eq!(
        update,
        UserUpdate {
            id: 4,
            username: None,
            role_id: Some(3),
            active: Some(false)
        }
    );
    assert_eq!(reset.user_id, 4);
    assert_eq!(
        role.permissions,
        vec![PermissionKey::ClientsRead, PermissionKey::UsersManage]
    );
    assert_eq!(permissions.permissions, vec![PermissionKey::AuditRead]);
}

#[test]
fn unknown_permission_in_payload_is_rejected() {
    let parsed = serde_json::from_str::<NewRole>(r#"{"name":"X","permissions":["root.all"]}"#);

    assert!(parsed.is_err());
}

#[test]
fn summaries_serialize_in_camel_case() {
    let user = UserSummary {
        id: 1,
        username: "ana".into(),
        role_id: 2,
        role_name: "Recepción".into(),
        active: true,
        created_at: "2026-01-01T10:00".into(),
        updated_at: "2026-01-01T10:00".into(),
    };
    let role = RoleSummary {
        id: 2,
        name: "Recepción".into(),
        permissions: vec![PermissionKey::ClientsRead],
        user_count: 3,
    };

    let user_json = serde_json::to_value(&user).unwrap();
    let role_json = serde_json::to_value(&role).unwrap();

    assert_eq!(user_json["roleName"], "Recepción");
    assert_eq!(user_json["createdAt"], "2026-01-01T10:00");
    assert_eq!(role_json["userCount"], 3);
    assert_eq!(role_json["permissions"][0], "clients.read");
}

#[test]
fn take_password_moves_the_secret_out_of_the_input() {
    let mut created = NewUserInput {
        username: "ana".into(),
        password: "clave-larga-1".into(),
        role_id: 2,
    };
    let mut reset = PasswordReset {
        user_id: 1,
        new_password: "otra-clave-12".into(),
    };

    let created_secret = created.take_password();
    let reset_secret = reset.take_password();

    assert_eq!(created_secret.as_str(), "clave-larga-1");
    assert_eq!(reset_secret.as_str(), "otra-clave-12");
    assert!(created.password.is_empty());
    assert!(reset.new_password.is_empty());
}

#[test]
fn validation_and_last_admin_map_to_validation_with_field() {
    let validation = AppError::from(UsersError::Validation { field: "roleId" });
    let last_admin = AppError::from(UsersError::LastAdmin { field: "active" });

    assert_eq!(validation.code, AppErrorCode::Validation);
    assert_eq!(validation.field.as_deref(), Some("roleId"));
    assert_eq!(last_admin.code, AppErrorCode::Validation);
    assert_eq!(last_admin.field.as_deref(), Some("active"));
}

#[test]
fn auth_errors_delegate_to_the_auth_mapping() {
    assert_eq!(
        AppError::from(UsersError::Auth(AuthError::Forbidden)),
        AppError::forbidden()
    );
    assert_eq!(
        AppError::from(UsersError::Auth(AuthError::Locked)),
        AppError::session_locked()
    );
    assert_eq!(
        AppError::from(UsersError::Auth(AuthError::Unauthenticated)),
        AppError::unauthenticated()
    );
}

#[test]
fn database_errors_map_to_internal_without_the_cause() {
    let error = UsersError::Db(DbError::Sqlite(rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
        Some("UNIQUE constraint failed: users.username".into()),
    )));

    let mapped = AppError::from(error);

    assert_eq!(mapped, AppError::internal());
    assert!(!format!("{mapped:?}").contains("username"));
}
