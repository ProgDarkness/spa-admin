use std::sync::Arc;
use std::time::{Duration, Instant};

use rusqlite::Connection;

use super::*;
use crate::db::migrate;
use crate::errors::{AppError, AppErrorCode};
use crate::features::auth::model::PermissionKey;
use crate::features::auth::repository::{insert_user, NewUser};

const OWNER_ROLE_ID: i64 = 1;
const RECEPTION_ROLE_ID: i64 = 2;
const PASSWORD: &str = "clave-segura-1";

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn credentials(username: &str, password: &str) -> LoginCredentials {
    LoginCredentials {
        username: username.to_string(),
        password: password.to_string(),
    }
}

fn add_user(
    conn: &Connection,
    policy: &PasswordPolicy,
    username: &str,
    password: &str,
    role_id: i64,
) -> i64 {
    let user = NewUser {
        username: username.to_string(),
        password_hash: policy.hash(password).unwrap(),
        role_id,
    };
    insert_user(conn, &user).unwrap()
}

fn is_invalid_credentials<T>(result: &Result<T, AuthError>) -> bool {
    matches!(result, Err(AuthError::InvalidCredentials))
}

fn session_user() -> SessionUser {
    SessionUser {
        id: 1,
        username: "ana".to_string(),
        role_name: "Recepción".to_string(),
        permissions: vec![PermissionKey::ClientsRead],
    }
}

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
fn session_state_start_current_and_end() {
    let state = SessionState::default();
    let now = Instant::now();
    assert_eq!(state.current(now).unwrap(), None);

    state.start(session_user(), now).unwrap();
    assert_eq!(state.current(now).unwrap(), Some(session_user()));

    state.end().unwrap();
    assert_eq!(state.current(now).unwrap(), None);
}

#[test]
fn session_expires_after_the_idle_timeout_and_stays_cleared() {
    let state = SessionState::default();
    let now = Instant::now();
    state.start(session_user(), now).unwrap();

    assert_eq!(state.current(now + IDLE_TIMEOUT).unwrap(), None);
    assert_eq!(state.current(now).unwrap(), None);
}

#[test]
fn session_is_active_at_9m59s_and_expired_at_exactly_10m() {
    let now = Instant::now();
    let active = SessionState::default();
    active.start(session_user(), now).unwrap();
    assert!(active
        .current(now + Duration::from_secs(9 * 60 + 59))
        .unwrap()
        .is_some());

    let expired = SessionState::default();
    expired.start(session_user(), now).unwrap();
    assert_eq!(
        expired.current(now + Duration::from_secs(10 * 60)).unwrap(),
        None
    );
}

#[test]
fn activity_extends_the_session() {
    let state = SessionState::default();
    let now = Instant::now();
    let almost = IDLE_TIMEOUT - Duration::from_secs(1);
    state.start(session_user(), now).unwrap();

    assert!(state.current(now + almost).unwrap().is_some());
    assert!(state.current(now + almost + almost).unwrap().is_some());
}

#[test]
fn poisoned_session_lock_maps_to_unavailable() {
    let state = Arc::new(SessionState::default());
    let poisoner = Arc::clone(&state);
    let _ = std::thread::spawn(move || {
        let _guard = poisoner.0.lock().unwrap();
        panic!("poison");
    })
    .join();

    let now = Instant::now();
    assert!(matches!(
        state.current(now),
        Err(AuthError::SessionUnavailable)
    ));
    assert!(matches!(state.end(), Err(AuthError::SessionUnavailable)));
}

fn signed_in(conn: &Connection, policy: &PasswordPolicy, role_id: i64) -> (SessionState, i64) {
    let id = add_user(conn, policy, "ana", PASSWORD, role_id);
    let user = login(conn, policy, &credentials("ana", PASSWORD)).unwrap();
    let state = SessionState::default();
    state.start(user, Instant::now()).unwrap();
    (state, id)
}

#[test]
fn require_permission_allows_a_granted_permission() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, id) = signed_in(&conn, &policy, RECEPTION_ROLE_ID);

    let user =
        require_permission(&conn, &state, PermissionKey::ClientsWrite, Instant::now()).unwrap();

    assert_eq!(user.id, id);
}

#[test]
fn require_permission_without_session_is_unauthenticated() {
    let conn = migrated();
    let state = SessionState::default();

    let result = require_permission(&conn, &state, PermissionKey::ClientsRead, Instant::now());

    assert!(matches!(result, Err(AuthError::Unauthenticated)));
}

#[test]
fn require_permission_denies_a_missing_permission() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, _) = signed_in(&conn, &policy, RECEPTION_ROLE_ID);

    let result = require_permission(&conn, &state, PermissionKey::UsersManage, Instant::now());

    assert!(matches!(result, Err(AuthError::Forbidden)));
}

#[test]
fn require_permission_after_idle_timeout_is_unauthenticated() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, _) = signed_in(&conn, &policy, OWNER_ROLE_ID);

    let result = require_permission(
        &conn,
        &state,
        PermissionKey::ClientsRead,
        Instant::now() + IDLE_TIMEOUT + Duration::from_secs(1),
    );

    assert!(matches!(result, Err(AuthError::Unauthenticated)));
}

#[test]
fn require_permission_reloads_permissions_from_the_database() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, id) = signed_in(&conn, &policy, OWNER_ROLE_ID);
    conn.execute("UPDATE users SET role_id = 3 WHERE id = ?1", [id])
        .unwrap();

    let denied = require_permission(&conn, &state, PermissionKey::UsersManage, Instant::now());
    let allowed = require_permission(&conn, &state, PermissionKey::ClientsRead, Instant::now());

    assert!(matches!(denied, Err(AuthError::Forbidden)));
    let refreshed = allowed.unwrap();
    assert_eq!(refreshed.role_name, "Solo lectura");
    assert_eq!(
        state.current(Instant::now()).unwrap().unwrap().role_name,
        "Solo lectura"
    );
}

#[test]
fn deactivated_user_loses_the_session_on_next_check() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, id) = signed_in(&conn, &policy, OWNER_ROLE_ID);
    conn.execute("UPDATE users SET active = 0 WHERE id = ?1", [id])
        .unwrap();

    let result = require_permission(&conn, &state, PermissionKey::ClientsRead, Instant::now());

    assert!(matches!(result, Err(AuthError::Unauthenticated)));
    assert_eq!(state.current(Instant::now()).unwrap(), None);
}

#[test]
fn active_user_returns_the_refreshed_session_user() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, id) = signed_in(&conn, &policy, RECEPTION_ROLE_ID);

    let user = active_user(&conn, &state, Instant::now()).unwrap();

    assert_eq!(user.id, id);
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

const COMPOSED_USERNAME: &str = "jos\u{00E9}";
const DECOMPOSED_USERNAME: &str = "jose\u{0301}";

#[test]
fn validated_username_unifies_composed_and_decomposed_forms() {
    let composed = validated_username(&credentials(COMPOSED_USERNAME, PASSWORD)).unwrap();
    let decomposed = validated_username(&credentials(DECOMPOSED_USERNAME, PASSWORD)).unwrap();
    assert_eq!(composed, decomposed);
    assert_eq!(composed, COMPOSED_USERNAME);
}

#[test]
fn login_resolves_same_user_for_composed_and_decomposed_username() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    add_user(&conn, &policy, COMPOSED_USERNAME, PASSWORD, OWNER_ROLE_ID);
    let from_composed = login(&conn, &policy, &credentials(COMPOSED_USERNAME, PASSWORD)).unwrap();
    let from_decomposed =
        login(&conn, &policy, &credentials(DECOMPOSED_USERNAME, PASSWORD)).unwrap();
    assert_eq!(from_composed.id, from_decomposed.id);
}
