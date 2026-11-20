use std::sync::Arc;
use std::time::Duration;

use tauri::test::{mock_app, MockRuntime};
use tauri::{App, Manager};
use tempfile::TempDir;

use super::*;
use crate::db::{migrate, open_encrypted, DbKey};
use crate::errors::AppErrorCode;
use crate::features::auth::repository::{insert_user, NewUser};

const OWNER_ROLE_ID: i64 = 1;
const RECEPTION_ROLE_ID: i64 = 2;
pub(super) const PASSWORD: &str = "clave-segura-1";
pub(super) const OTHER_PASSWORD: &str = "otra-clave-9";

pub(super) struct Fixture {
    pub(super) app: App<MockRuntime>,
    pub(super) _dir: TempDir,
}

fn add_user(
    database: &Database,
    policy: &PasswordPolicy,
    username: &str,
    password: &str,
    role_id: i64,
) {
    let user = NewUser {
        username: username.to_string(),
        password_hash: policy.hash(password).unwrap(),
        role_id,
    };
    database.with_conn(|conn| insert_user(conn, &user)).unwrap();
}

pub(super) fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let key = DbKey::generate().unwrap();
    let mut conn = open_encrypted(&dir.path().join("commands.db"), &key).unwrap();
    migrate(&mut conn).unwrap();
    let database = Database::new(conn);
    let policy = PasswordPolicy::new().unwrap();
    add_user(&database, &policy, "propietaria", PASSWORD, OWNER_ROLE_ID);
    add_user(&database, &policy, "recepcion", PASSWORD, RECEPTION_ROLE_ID);
    add_user(
        &database,
        &policy,
        "otra",
        OTHER_PASSWORD,
        RECEPTION_ROLE_ID,
    );
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

pub(super) fn sign_in(
    fixture: &Fixture,
    username: &str,
    password: &str,
) -> Result<SessionUser, AppError> {
    tauri::async_runtime::block_on(login(
        credentials(username, password),
        fixture.app.state(),
        fixture.app.state(),
        fixture.app.state(),
        fixture.app.state(),
    ))
}

pub(super) fn sign_out(fixture: &Fixture) -> Result<(), AppError> {
    logout(fixture.app.state(), fixture.app.state())
}

pub(super) fn current(fixture: &Fixture) -> Result<Option<SessionView>, AppError> {
    current_session(fixture.app.state(), fixture.app.state())
}

fn active_view(user: SessionUser) -> Option<SessionView> {
    Some(SessionView::active(user))
}

fn locked_view() -> Option<SessionView> {
    Some(SessionView::locked())
}

pub(super) fn lock_now(fixture: &Fixture) {
    let session: State<'_, SessionState> = fixture.app.state();
    session.force_lock().unwrap();
}

pub(super) fn unlock_with(fixture: &Fixture, password: &str) -> Result<SessionUser, AppError> {
    let credentials = UnlockCredentials {
        password: password.to_string(),
    };
    tauri::async_runtime::block_on(unlock(
        credentials,
        fixture.app.state(),
        fixture.app.state(),
        fixture.app.state(),
        fixture.app.state(),
    ))
}

fn record(fixture: &Fixture) -> Result<Option<SessionView>, AppError> {
    record_activity(fixture.app.state(), fixture.app.state())
}

#[test]
fn login_ok_replaces_session() {
    let fixture = fixture();
    let first = sign_in(&fixture, "propietaria", PASSWORD).unwrap();
    assert_eq!(current(&fixture).unwrap(), active_view(first));
    let second = sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    assert_eq!(second.username, "recepcion");
    assert_eq!(current(&fixture).unwrap(), active_view(second));
}

#[test]
fn failed_login_keeps_existing_session() {
    let fixture = fixture();
    let signed_in = sign_in(&fixture, "propietaria", PASSWORD).unwrap();
    let failure = sign_in(&fixture, "recepcion", "equivocada").unwrap_err();
    assert_eq!(failure.code, AppErrorCode::InvalidCredentials);
    assert_eq!(current(&fixture).unwrap(), active_view(signed_in));
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
    assert_eq!(current(&fixture).unwrap(), active_view(user));
}

const FAILED_ATTEMPTS_BEFORE_LOCKOUT: u32 = 5;

pub(super) fn fail_repeatedly(fixture: &Fixture, username: &str, times: u32) {
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

fn deactivate(fixture: &Fixture, user_id: i64) {
    let database: State<'_, Database> = fixture.app.state();
    database
        .with_conn(|conn| {
            conn.execute("UPDATE users SET active = 0 WHERE id = ?1", [user_id])?;
            Ok(())
        })
        .unwrap();
}

fn locked_fixture(username: &str) -> (Fixture, SessionUser) {
    let fixture = fixture();
    let user = sign_in(&fixture, username, PASSWORD).unwrap();
    lock_now(&fixture);
    (fixture, user)
}

#[test]
fn current_session_reports_locked_without_a_user() {
    let (fixture, _) = locked_fixture("recepcion");
    assert_eq!(current(&fixture).unwrap(), locked_view());
}

#[test]
fn record_activity_is_none_when_signed_out() {
    let fixture = fixture();
    assert_eq!(record(&fixture).unwrap(), None);
}

#[test]
fn record_activity_keeps_an_active_session_active() {
    let fixture = fixture();
    let user = sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    assert_eq!(record(&fixture).unwrap(), active_view(user));
}

#[test]
fn record_activity_while_locked_does_not_unlock() {
    let (fixture, _) = locked_fixture("recepcion");

    assert_eq!(record(&fixture).unwrap(), locked_view());

    assert_eq!(current(&fixture).unwrap(), locked_view());
}

fn idle_signed_in(username: &str) -> (Fixture, SessionUser) {
    let fixture = fixture();
    let user = sign_in(&fixture, username, PASSWORD).unwrap();
    let now = Beat::now();
    let stale = Duration::from_secs(1) + crate::features::auth::service::IDLE_TIMEOUT;
    let past = Beat {
        mono: now
            .mono
            .checked_sub(stale)
            .expect("monotonic clock is younger than the idle timeout"),
        wall: now.wall - stale,
    };
    let session: State<'_, SessionState> = fixture.app.state();
    session.start(user.clone(), past).unwrap();
    (fixture, user)
}

fn session_locked_rows(fixture: &Fixture) -> Vec<Option<i64>> {
    let database: State<'_, Database> = fixture.app.state();
    database
        .with_conn(|conn| {
            let mut statement = conn.prepare(
                "SELECT actor_user_id FROM audit_log WHERE action = 'session_locked' ORDER BY id",
            )?;
            let rows = statement
                .query_map([], |row| row.get::<_, Option<i64>>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .unwrap()
}

#[test]
fn current_session_after_idle_reports_locked_and_keeps_one_session_locked_row() {
    let (fixture, user) = idle_signed_in("recepcion");

    let first = current(&fixture).unwrap();
    let second = current(&fixture).unwrap();

    assert_eq!(first, locked_view());
    assert_eq!(second, locked_view());
    assert_eq!(session_locked_rows(&fixture), vec![Some(user.id)]);
}

#[test]
fn record_activity_after_idle_reports_locked_and_keeps_one_session_locked_row() {
    let (fixture, user) = idle_signed_in("recepcion");

    let first = record(&fixture).unwrap();
    let second = record(&fixture).unwrap();

    assert_eq!(first, locked_view());
    assert_eq!(second, locked_view());
    assert_eq!(session_locked_rows(&fixture), vec![Some(user.id)]);
}

#[test]
fn unlock_restores_active() {
    let (fixture, user) = locked_fixture("recepcion");

    let unlocked = unlock_with(&fixture, PASSWORD).unwrap();

    assert_eq!(unlocked, user);
    assert_eq!(current(&fixture).unwrap(), active_view(user));
}

#[test]
fn unlock_wrong_password_is_invalid_credentials_and_stays_locked() {
    let (fixture, _) = locked_fixture("recepcion");

    let failure = unlock_with(&fixture, "equivocada").unwrap_err();

    assert_eq!(failure, AppError::invalid_credentials());
    assert_eq!(current(&fixture).unwrap(), locked_view());
}

#[test]
fn unlock_wrong_password_counts_in_throttle() {
    let (fixture, _) = locked_fixture("recepcion");
    for _ in 0..FAILED_ATTEMPTS_BEFORE_LOCKOUT {
        let failure = unlock_with(&fixture, "equivocada").unwrap_err();
        assert_eq!(failure.code, AppErrorCode::InvalidCredentials);
    }

    let blocked = unlock_with(&fixture, PASSWORD).unwrap_err();

    assert_eq!(blocked, AppError::invalid_credentials());
    assert_eq!(current(&fixture).unwrap(), locked_view());
}

#[test]
fn login_failures_and_unlock_failures_share_one_counter() {
    let (fixture, _) = locked_fixture("recepcion");
    unlock_with(&fixture, "equivocada").unwrap_err();
    unlock_with(&fixture, "equivocada").unwrap_err();
    fail_repeatedly(&fixture, "recepcion", 2);
    unlock_with(&fixture, "equivocada").unwrap_err();

    let blocked = unlock_with(&fixture, PASSWORD).unwrap_err();

    assert_eq!(blocked, AppError::invalid_credentials());
    assert_eq!(current(&fixture).unwrap(), locked_view());
}

#[test]
fn unlock_success_resets_the_failure_counter() {
    let (fixture, _) = locked_fixture("recepcion");
    for _ in 0..FAILED_ATTEMPTS_BEFORE_LOCKOUT - 1 {
        unlock_with(&fixture, "equivocada").unwrap_err();
    }
    unlock_with(&fixture, PASSWORD).unwrap();
    lock_now(&fixture);
    for _ in 0..FAILED_ATTEMPTS_BEFORE_LOCKOUT - 1 {
        unlock_with(&fixture, "equivocada").unwrap_err();
    }

    assert!(unlock_with(&fixture, PASSWORD).is_ok());
}

#[test]
fn unlock_by_other_username_rejected() {
    let (fixture, _) = locked_fixture("recepcion");

    let failure = unlock_with(&fixture, OTHER_PASSWORD).unwrap_err();

    assert_eq!(failure, AppError::invalid_credentials());
    assert_eq!(current(&fixture).unwrap(), locked_view());
}

#[test]
fn deactivated_user_cannot_unlock() {
    let (fixture, user) = locked_fixture("recepcion");
    deactivate(&fixture, user.id);

    let failure = unlock_with(&fixture, PASSWORD).unwrap_err();

    assert_eq!(failure, AppError::unauthenticated());
    assert_eq!(current(&fixture).unwrap(), None);
}

#[test]
fn unlock_for_a_vanished_user_verifies_a_dummy_hash_and_ends_the_session() {
    let fixture = fixture();
    let ghost = SessionUser {
        id: 9999,
        username: "fantasma".to_string(),
        role_name: "Recepción".to_string(),
        permissions: vec![],
    };
    let session: State<'_, SessionState> = fixture.app.state();
    session.start(ghost, Beat::now()).unwrap();
    lock_now(&fixture);
    let policy: State<'_, Arc<PasswordPolicy>> = fixture.app.state();
    let before = policy.verification_count();

    let failure = unlock_with(&fixture, PASSWORD).unwrap_err();

    assert_eq!(failure, AppError::unauthenticated());
    assert_eq!(policy.verification_count(), before + 1);
    assert_eq!(current(&fixture).unwrap(), None);
}

#[test]
fn unlock_without_session_is_unauthenticated() {
    let fixture = fixture();
    let failure = unlock_with(&fixture, PASSWORD).unwrap_err();
    assert_eq!(failure, AppError::unauthenticated());
}

#[test]
fn unlock_with_an_active_session_is_a_password_validation_error() {
    let fixture = fixture();
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();

    let failure = unlock_with(&fixture, PASSWORD).unwrap_err();

    assert_eq!(failure.code, AppErrorCode::Validation);
    assert_eq!(failure.field.as_deref(), Some("password"));
}

#[test]
fn unlock_rejects_empty_and_oversized_passwords_without_spending_attempts() {
    let (fixture, _) = locked_fixture("recepcion");
    let oversized = "p".repeat(1025);
    for _ in 0..FAILED_ATTEMPTS_BEFORE_LOCKOUT {
        let failure = unlock_with(&fixture, "").unwrap_err();
        assert_eq!(failure.code, AppErrorCode::InvalidCredentials);
        let failure = unlock_with(&fixture, &oversized).unwrap_err();
        assert_eq!(failure.code, AppErrorCode::InvalidCredentials);
    }

    assert!(unlock_with(&fixture, PASSWORD).is_ok());
}

fn verifications(fixture: &Fixture) -> usize {
    let policy: State<'_, Arc<PasswordPolicy>> = fixture.app.state();
    policy.verification_count()
}

fn exhaust_memory_throttle(fixture: &Fixture, username: &str) {
    let throttle: State<'_, LoginThrottle> = fixture.app.state();
    for _ in 0..FAILED_ATTEMPTS_BEFORE_LOCKOUT {
        throttle.reserve_attempt(username, std::time::Instant::now());
    }
}

#[test]
fn login_denied_by_the_memory_throttle_still_runs_one_verification() {
    let fixture = fixture();
    exhaust_memory_throttle(&fixture, "recepcion");
    let before = verifications(&fixture);

    let failure = sign_in(&fixture, "recepcion", PASSWORD).unwrap_err();

    assert_eq!(failure, AppError::invalid_credentials());
    assert_eq!(verifications(&fixture), before + 1);
}

#[test]
fn login_of_an_unknown_user_denied_by_the_memory_throttle_runs_one_verification() {
    let fixture = fixture();
    exhaust_memory_throttle(&fixture, "fantasma");
    let before = verifications(&fixture);

    let failure = sign_in(&fixture, "fantasma", PASSWORD).unwrap_err();

    assert_eq!(failure, AppError::invalid_credentials());
    assert_eq!(verifications(&fixture), before + 1);
}

#[test]
fn unlock_denied_by_the_memory_throttle_still_runs_one_verification() {
    let (fixture, _) = locked_fixture("recepcion");
    exhaust_memory_throttle(&fixture, "recepcion");
    let before = verifications(&fixture);

    let failure = unlock_with(&fixture, PASSWORD).unwrap_err();

    assert_eq!(failure, AppError::invalid_credentials());
    assert_eq!(verifications(&fixture), before + 1);
    assert_eq!(current(&fixture).unwrap(), locked_view());
}
