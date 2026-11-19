use std::sync::Arc;

use tauri::test::{mock_app, MockRuntime};
use tauri::{App, Manager};
use tempfile::TempDir;

use super::*;
use crate::db::{migrate, open_encrypted, DbKey};
use crate::errors::AppErrorCode;
use crate::features::auth::repository::{insert_user, NewUser};

const OWNER_ROLE_ID: i64 = 1;
const RECEPTION_ROLE_ID: i64 = 2;
const PASSWORD: &str = "clave-segura-1";

struct Fixture {
    app: App<MockRuntime>,
    _dir: TempDir,
}

fn add_user(database: &Database, policy: &PasswordPolicy, username: &str, role_id: i64) {
    let user = NewUser {
        username: username.to_string(),
        password_hash: policy.hash(PASSWORD).unwrap(),
        role_id,
    };
    database.with_conn(|conn| insert_user(conn, &user)).unwrap();
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let key = DbKey::generate().unwrap();
    let mut conn = open_encrypted(&dir.path().join("commands.db"), &key).unwrap();
    migrate(&mut conn).unwrap();
    let database = Database::new(conn);
    let policy = PasswordPolicy::new().unwrap();
    add_user(&database, &policy, "propietaria", OWNER_ROLE_ID);
    add_user(&database, &policy, "recepcion", RECEPTION_ROLE_ID);
    let app = mock_app();
    app.manage(database);
    app.manage(Arc::new(policy));
    app.manage(LoginThrottle::default());
    app.manage(SessionState::default());
    Fixture { app, _dir: dir }
}

fn credentials(username: &str, password: &str) -> LoginCredentials {
    LoginCredentials {
        username: username.to_string(),
        password: password.to_string(),
    }
}

fn sign_in(fixture: &Fixture, username: &str, password: &str) -> Result<SessionUser, AppError> {
    tauri::async_runtime::block_on(login(
        credentials(username, password),
        fixture.app.state(),
        fixture.app.state(),
        fixture.app.state(),
        fixture.app.state(),
    ))
}

fn sign_out(fixture: &Fixture) -> Result<(), AppError> {
    logout(fixture.app.state())
}

fn current(fixture: &Fixture) -> Result<Option<SessionUser>, AppError> {
    current_session(fixture.app.state(), fixture.app.state())
}

#[test]
fn login_ok_replaces_session() {
    let fixture = fixture();
    let first = sign_in(&fixture, "propietaria", PASSWORD).unwrap();
    assert_eq!(current(&fixture).unwrap(), Some(first));
    let second = sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    assert_eq!(second.username, "recepcion");
    assert_eq!(current(&fixture).unwrap(), Some(second));
}

#[test]
fn failed_login_keeps_existing_session() {
    let fixture = fixture();
    let signed_in = sign_in(&fixture, "propietaria", PASSWORD).unwrap();
    let failure = sign_in(&fixture, "recepcion", "equivocada").unwrap_err();
    assert_eq!(failure.code, AppErrorCode::InvalidCredentials);
    assert_eq!(current(&fixture).unwrap(), Some(signed_in));
}

#[test]
fn logout_is_idempotent() {
    let fixture = fixture();
    sign_in(&fixture, "propietaria", PASSWORD).unwrap();
    sign_out(&fixture).unwrap();
    sign_out(&fixture).unwrap();
    assert_eq!(current(&fixture).unwrap(), None);
}

#[test]
fn current_session_none_when_signed_out() {
    let fixture = fixture();
    assert_eq!(current(&fixture).unwrap(), None);
}

#[test]
fn current_session_returns_signed_in_user() {
    let fixture = fixture();
    let user = sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    assert_eq!(current(&fixture).unwrap(), Some(user));
}

const FAILED_ATTEMPTS_BEFORE_LOCKOUT: u32 = 5;

fn fail_repeatedly(fixture: &Fixture, username: &str, times: u32) {
    for _ in 0..times {
        let failure = sign_in(fixture, username, "equivocada").unwrap_err();
        assert_eq!(failure.code, AppErrorCode::InvalidCredentials);
    }
}

#[test]
fn repeated_failures_lock_the_user_even_with_the_right_password() {
    let fixture = fixture();
    fail_repeatedly(&fixture, "recepcion", FAILED_ATTEMPTS_BEFORE_LOCKOUT);

    let locked = sign_in(&fixture, "recepcion", PASSWORD).unwrap_err();

    assert_eq!(locked, AppError::invalid_credentials());
    assert_eq!(current(&fixture).unwrap(), None);
}

#[test]
fn lockout_is_case_and_whitespace_insensitive_and_per_user() {
    let fixture = fixture();
    fail_repeatedly(&fixture, "recepcion", FAILED_ATTEMPTS_BEFORE_LOCKOUT);

    let same_user = sign_in(&fixture, " RECEPCION ", PASSWORD).unwrap_err();
    let other_user = sign_in(&fixture, "propietaria", PASSWORD);

    assert_eq!(same_user.code, AppErrorCode::InvalidCredentials);
    assert!(other_user.is_ok());
}

#[test]
fn unknown_users_are_throttled_with_the_same_error() {
    let fixture = fixture();
    fail_repeatedly(&fixture, "fantasma", FAILED_ATTEMPTS_BEFORE_LOCKOUT);

    let locked = sign_in(&fixture, "fantasma", PASSWORD).unwrap_err();

    assert_eq!(locked, AppError::invalid_credentials());
}

#[test]
fn successful_login_resets_the_failure_counter() {
    let fixture = fixture();
    fail_repeatedly(&fixture, "recepcion", FAILED_ATTEMPTS_BEFORE_LOCKOUT - 1);
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    fail_repeatedly(&fixture, "recepcion", FAILED_ATTEMPTS_BEFORE_LOCKOUT - 1);

    assert!(sign_in(&fixture, "recepcion", PASSWORD).is_ok());
}

#[test]
fn current_session_drops_a_user_deactivated_after_login() {
    let fixture = fixture();
    let user = sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    let database: State<'_, Database> = fixture.app.state();
    database
        .with_conn(|conn| {
            conn.execute("UPDATE users SET active = 0 WHERE id = ?1", [user.id])?;
            Ok(())
        })
        .unwrap();

    assert_eq!(current(&fixture).unwrap(), None);
}

fn rename_users_table(fixture: &Fixture, from: &str, to: &str) {
    let database: State<'_, Database> = fixture.app.state();
    database
        .with_conn(|conn| {
            conn.execute_batch(&format!("ALTER TABLE {from} RENAME TO {to}"))?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn infrastructure_failures_do_not_consume_login_attempts() {
    let fixture = fixture();
    rename_users_table(&fixture, "users", "users_offline");
    for _ in 0..FAILED_ATTEMPTS_BEFORE_LOCKOUT {
        let failure = sign_in(&fixture, "recepcion", PASSWORD).unwrap_err();
        assert_eq!(failure.code, AppErrorCode::Internal);
    }
    rename_users_table(&fixture, "users_offline", "users");

    assert!(sign_in(&fixture, "recepcion", PASSWORD).is_ok());
}
