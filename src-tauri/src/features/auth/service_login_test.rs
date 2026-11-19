use super::tests::{
    add_user, credentials, is_invalid_credentials, migrated, OWNER_ROLE_ID, PASSWORD,
    RECEPTION_ROLE_ID,
};
use super::*;
use crate::errors::{AppError, AppErrorCode};
use crate::features::auth::model::PermissionKey;
use crate::features::auth::repository::{insert_user, NewUser};

#[test]
fn login_ok_returns_session_user_with_role_permissions() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let id = add_user(&conn, &policy, "ana", PASSWORD, RECEPTION_ROLE_ID);

    let user = login(&conn, &policy, &credentials("ana", PASSWORD)).unwrap();

    assert_eq!(user.id, id);
    assert_eq!(user.username, "ana");
    assert_eq!(user.role_name, "Recepción");
    assert_eq!(
        user.permissions,
        vec![
            PermissionKey::ClientsRead,
            PermissionKey::ClientsWrite,
            PermissionKey::CatalogRead,
            PermissionKey::AppointmentsRead,
            PermissionKey::AppointmentsWrite,
            PermissionKey::PaymentsRead,
            PermissionKey::PaymentsWrite,
            PermissionKey::RatesManage,
        ]
    );
}

#[test]
fn wrong_password_is_invalid_credentials() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    add_user(&conn, &policy, "ana", PASSWORD, OWNER_ROLE_ID);

    let result = login(&conn, &policy, &credentials("ana", "otra-clave"));

    assert!(is_invalid_credentials(&result));
}

#[test]
fn unknown_user_is_invalid_credentials_and_still_verifies_dummy_hash() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let before = policy.verification_count();

    let result = login(&conn, &policy, &credentials("nadie", PASSWORD));

    assert!(is_invalid_credentials(&result));
    assert_eq!(policy.verification_count(), before + 1);
}

#[test]
fn inactive_user_is_invalid_credentials() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let id = add_user(&conn, &policy, "ana", PASSWORD, OWNER_ROLE_ID);
    conn.execute("UPDATE users SET active = 0 WHERE id = ?1", [id])
        .unwrap();
    let before = policy.verification_count();

    let result = login(&conn, &policy, &credentials("ana", PASSWORD));

    assert!(is_invalid_credentials(&result));
    assert_eq!(policy.verification_count(), before + 1);
}

#[test]
fn empty_and_oversized_inputs_are_invalid_credentials() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let oversized_username = "u".repeat(65);
    let oversized_password = "p".repeat(1025);
    add_user(&conn, &policy, &oversized_username, PASSWORD, OWNER_ROLE_ID);
    add_user(&conn, &policy, "ana", &oversized_password, OWNER_ROLE_ID);

    let rejected = [
        credentials("", PASSWORD),
        credentials("ana", ""),
        credentials(&oversized_username, PASSWORD),
        credentials("ana", &oversized_password),
    ];

    for attempt in &rejected {
        assert!(is_invalid_credentials(&login(&conn, &policy, attempt)));
    }
}

#[test]
fn inputs_at_the_length_limits_are_accepted() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let longest_username = "u".repeat(64);
    let longest_password = "p".repeat(1024);
    add_user(
        &conn,
        &policy,
        &longest_username,
        &longest_password,
        OWNER_ROLE_ID,
    );

    let result = login(
        &conn,
        &policy,
        &credentials(&longest_username, &longest_password),
    );

    assert!(result.is_ok());
}

#[test]
fn login_never_returns_password_hash() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    add_user(&conn, &policy, "ana", PASSWORD, OWNER_ROLE_ID);

    let user = login(&conn, &policy, &credentials("ana", PASSWORD)).unwrap();

    let serialized = serde_json::to_string(&user).unwrap();
    assert!(!serialized.contains("argon2"));
    assert!(!serialized.contains(PASSWORD));
    assert!(!format!("{user:?}").contains("argon2"));
}

#[test]
fn login_with_malformed_stored_hash_is_a_hash_error_not_a_session() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let user = NewUser {
        username: "ana".to_string(),
        password_hash: "corrupto".to_string(),
        role_id: OWNER_ROLE_ID,
    };
    insert_user(&conn, &user).unwrap();

    let result = login(&conn, &policy, &credentials("ana", PASSWORD));

    assert!(matches!(result, Err(AuthError::Hash)));
}

#[test]
fn login_trims_the_username_and_ignores_case() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let id = add_user(&conn, &policy, "Ana", PASSWORD, RECEPTION_ROLE_ID);

    let user = login(&conn, &policy, &credentials("  aNA\t", PASSWORD)).unwrap();

    assert_eq!(user.id, id);
}

#[test]
fn whitespace_only_username_is_invalid_credentials() {
    let credentials = credentials("   ", PASSWORD);
    assert!(is_invalid_credentials(&validated_username(&credentials)));
}

#[test]
fn validated_username_returns_the_trimmed_value() {
    let credentials = credentials(" ana ", PASSWORD);
    assert_eq!(validated_username(&credentials).unwrap(), "ana");
}
#[test]
fn auth_error_maps_to_app_error_without_leaking_cause() {
    assert_eq!(
        AppError::from(AuthError::InvalidCredentials),
        AppError::invalid_credentials()
    );

    assert_eq!(
        AppError::from(AuthError::Unauthenticated),
        AppError::unauthenticated()
    );
    assert_eq!(AppError::from(AuthError::Forbidden), AppError::forbidden());
    assert_eq!(
        AppError::from(AuthError::Locked),
        AppError::session_locked()
    );
    assert_eq!(
        AppError::from(AuthError::Validation("password")),
        AppError::validation("password")
    );

    let internal_causes = [
        AuthError::Hash,
        AuthError::SessionUnavailable,
        AuthError::Db(DbError::Sqlite(rusqlite::Error::InvalidQuery)),
        AuthError::Db(DbError::UnknownPermission),
    ];
    for cause in internal_causes {
        let mapped = AppError::from(cause);
        assert_eq!(mapped.code, AppErrorCode::Internal);
        assert_eq!(mapped, AppError::internal());
    }
}

#[test]
fn auth_error_display_is_fixed_and_carries_no_detail() {
    let wrapped = AuthError::Db(DbError::Sqlite(rusqlite::Error::InvalidQuery));
    assert_eq!(wrapped.to_string(), "database failure");
    assert_eq!(AuthError::Hash.to_string(), "password hashing failure");
}
