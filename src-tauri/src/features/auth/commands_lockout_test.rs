use std::path::PathBuf;
use std::sync::Arc;

use tauri::test::mock_app;
use tauri::{Manager, State};
use tempfile::TempDir;

use super::tests::{
    fail_repeatedly, lock_now, sign_in, unlock_with, Fixture, OTHER_PASSWORD, PASSWORD,
};
use super::*;
use crate::db::{migrate, open_encrypted, DbKey};
use crate::errors::AppErrorCode;
use crate::features::audit::repository::list_all;

const FAILURES_TO_LOCK_OUT: u32 = 5;
const UNKNOWN_USERNAME: &str = "fantasma-desconocida";
const WRONG_PASSWORD: &str = "equivocada";
const EXPIRE_ROW_SQL: &str = "UPDATE login_throttle SET \
     last_failure_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ','now','-301 seconds'), \
     locked_until_utc = CASE WHEN locked_until_utc IS NULL THEN NULL ELSE \
     strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 seconds') END";

struct Installation {
    dir: TempDir,
    key: DbKey,
}

impl Installation {
    fn database_path(&self) -> PathBuf {
        self.dir.path().join("lockout.db")
    }

    fn create() -> Self {
        let installation = Self {
            dir: tempfile::tempdir().unwrap(),
            key: DbKey::generate().unwrap(),
        };
        let mut conn = open_encrypted(&installation.database_path(), &installation.key).unwrap();
        migrate(&mut conn).unwrap();
        let database = Database::new(conn);
        let policy = PasswordPolicy::new().unwrap();
        seed(&database, &policy, "recepcion", PASSWORD);
        seed(&database, &policy, "otra", OTHER_PASSWORD);
        installation
    }

    fn boot(&self) -> Fixture {
        let key = DbKey::from_hex(self.key.as_hex().to_string()).unwrap();
        let conn = open_encrypted(&self.database_path(), &key).unwrap();
        let app = mock_app();
        app.manage(Database::new(conn));
        app.manage(Arc::new(PasswordPolicy::new().unwrap()));
        app.manage(LoginThrottle::default());
        app.manage(SessionState::default());
        Fixture {
            app,
            _dir: tempfile::tempdir().unwrap(),
        }
    }
}

fn seed(database: &Database, policy: &PasswordPolicy, username: &str, password: &str) {
    let user = crate::features::auth::repository::NewUser {
        username: username.to_string(),
        password_hash: policy.hash(password).unwrap(),
        role_id: 2,
    };
    database
        .with_conn(|conn| crate::features::auth::repository::insert_user(conn, &user))
        .unwrap();
}

fn database_of(fixture: &Fixture) -> State<'_, Database> {
    fixture.app.state()
}

fn throttle_rows(fixture: &Fixture) -> i64 {
    database_of(fixture)
        .with_conn(|conn| {
            Ok(conn.query_row("SELECT count(*) FROM login_throttle", [], |row| row.get(0))?)
        })
        .unwrap()
}

fn persisted_failures(fixture: &Fixture, username: &str) -> Option<u32> {
    database_of(fixture)
        .with_conn(|conn| {
            let failures = conn
                .query_row(
                    "SELECT t.failures FROM login_throttle t JOIN users u ON u.id = t.user_id \
                     WHERE u.username = ?1",
                    [username],
                    |row| row.get(0),
                )
                .ok();
            Ok(failures)
        })
        .unwrap()
}

fn expire_rows(fixture: &Fixture) {
    database_of(fixture)
        .with_conn(|conn| {
            conn.execute_batch(EXPIRE_ROW_SQL)?;
            Ok(())
        })
        .unwrap();
}

fn count_of(fixture: &Fixture, action: &str) -> usize {
    database_of(fixture)
        .with_conn(list_all)
        .unwrap()
        .into_iter()
        .filter(|entry| entry.action.as_str() == action)
        .count()
}

fn assert_invalid_credentials(outcome: Result<SessionUser, AppError>) {
    assert_eq!(outcome.unwrap_err().code, AppErrorCode::InvalidCredentials);
}

#[test]
fn lockout_survives_restart() {
    let installation = Installation::create();
    let first_run = installation.boot();
    fail_repeatedly(&first_run, "recepcion", FAILURES_TO_LOCK_OUT);
    drop(first_run);

    let second_run = installation.boot();

    assert_invalid_credentials(sign_in(&second_run, "recepcion", PASSWORD));
    assert_invalid_credentials(sign_in(&second_run, "recepcion", WRONG_PASSWORD));
    assert!(sign_in(&second_run, "otra", OTHER_PASSWORD).is_ok());
}

#[test]
fn partial_failures_survive_restart_and_complete_the_lockout() {
    let installation = Installation::create();
    let first_run = installation.boot();
    fail_repeatedly(&first_run, "recepcion", FAILURES_TO_LOCK_OUT - 2);
    drop(first_run);

    let second_run = installation.boot();
    fail_repeatedly(&second_run, "recepcion", 2);

    assert_invalid_credentials(sign_in(&second_run, "recepcion", PASSWORD));
    assert_eq!(persisted_failures(&second_run, "recepcion"), Some(5));
}

#[test]
fn lockout_event_emitted_once_from_persisted_transition() {
    let installation = Installation::create();
    let first_run = installation.boot();
    fail_repeatedly(&first_run, "recepcion", FAILURES_TO_LOCK_OUT - 2);
    assert_eq!(count_of(&first_run, "login_locked_out"), 0);
    drop(first_run);

    let second_run = installation.boot();
    fail_repeatedly(&second_run, "recepcion", 1);
    assert_eq!(count_of(&second_run, "login_locked_out"), 0);
    fail_repeatedly(&second_run, "recepcion", 1);
    assert_eq!(count_of(&second_run, "login_locked_out"), 1);
    assert_invalid_credentials(sign_in(&second_run, "recepcion", PASSWORD));
    assert_invalid_credentials(sign_in(&second_run, "recepcion", WRONG_PASSWORD));

    assert_eq!(count_of(&second_run, "login_locked_out"), 1);
    assert_eq!(count_of(&second_run, "login_failed"), 5);
}

#[test]
fn unknown_username_not_persisted() {
    let installation = Installation::create();
    let fixture = installation.boot();

    for _ in 0..FAILURES_TO_LOCK_OUT + 2 {
        assert_invalid_credentials(sign_in(&fixture, UNKNOWN_USERNAME, WRONG_PASSWORD));
    }

    assert_eq!(throttle_rows(&fixture), 0);
}

#[test]
fn unknown_username_still_throttled_in_memory() {
    let installation = Installation::create();
    let fixture = installation.boot();

    for _ in 0..FAILURES_TO_LOCK_OUT {
        sign_in(&fixture, UNKNOWN_USERNAME, WRONG_PASSWORD).unwrap_err();
    }

    let throttle: State<'_, LoginThrottle> = fixture.app.state();
    assert!(!throttle
        .reserve_attempt(UNKNOWN_USERNAME, std::time::Instant::now())
        .is_granted());
}

#[test]
fn success_clears_persisted_failures() {
    let installation = Installation::create();
    let fixture = installation.boot();
    fail_repeatedly(&fixture, "recepcion", FAILURES_TO_LOCK_OUT - 1);
    assert_eq!(persisted_failures(&fixture, "recepcion"), Some(4));

    sign_in(&fixture, "recepcion", PASSWORD).unwrap();

    assert_eq!(persisted_failures(&fixture, "recepcion"), None);
}

#[test]
fn success_after_a_restart_clears_failures_persisted_before_it() {
    let installation = Installation::create();
    let first_run = installation.boot();
    fail_repeatedly(&first_run, "recepcion", FAILURES_TO_LOCK_OUT - 1);
    drop(first_run);

    let second_run = installation.boot();
    sign_in(&second_run, "recepcion", PASSWORD).unwrap();
    fail_repeatedly(&second_run, "recepcion", FAILURES_TO_LOCK_OUT - 1);

    assert!(sign_in(&second_run, "recepcion", PASSWORD).is_ok());
}

#[test]
fn locked_out_correct_password_rejected() {
    let installation = Installation::create();
    let first_run = installation.boot();
    fail_repeatedly(&first_run, "recepcion", FAILURES_TO_LOCK_OUT);
    drop(first_run);
    let fixture = installation.boot();
    let audited_before = count_of(&fixture, "login_failed");

    assert_invalid_credentials(sign_in(&fixture, "recepcion", PASSWORD));

    assert_eq!(persisted_failures(&fixture, "recepcion"), Some(5));
    assert_eq!(count_of(&fixture, "login_failed"), audited_before);
    assert_eq!(count_of(&fixture, "login_succeeded"), 0);
}

#[test]
fn lockout_expires_after_300s() {
    let installation = Installation::create();
    let first_run = installation.boot();
    fail_repeatedly(&first_run, "recepcion", FAILURES_TO_LOCK_OUT);
    drop(first_run);
    let fixture = installation.boot();
    assert_invalid_credentials(sign_in(&fixture, "recepcion", PASSWORD));

    expire_rows(&fixture);

    assert!(sign_in(&fixture, "recepcion", PASSWORD).is_ok());
    assert_eq!(persisted_failures(&fixture, "recepcion"), None);
}

#[test]
fn attempts_while_locked_do_not_extend_the_lockout() {
    let installation = Installation::create();
    let first_run = installation.boot();
    fail_repeatedly(&first_run, "recepcion", FAILURES_TO_LOCK_OUT);
    drop(first_run);
    let fixture = installation.boot();

    for _ in 0..FAILURES_TO_LOCK_OUT + 2 {
        assert_invalid_credentials(sign_in(&fixture, "recepcion", PASSWORD));
    }
    expire_rows(&fixture);

    assert!(sign_in(&fixture, "recepcion", PASSWORD).is_ok());
}

#[test]
fn persisted_counter_shared_by_login_and_unlock() {
    let installation = Installation::create();
    let fixture = installation.boot();
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    lock_now(&fixture);

    for _ in 0..3 {
        assert_invalid_credentials(unlock_with(&fixture, WRONG_PASSWORD));
    }
    assert_eq!(persisted_failures(&fixture, "recepcion"), Some(3));
    fail_repeatedly(&fixture, "recepcion", 2);

    assert_eq!(persisted_failures(&fixture, "recepcion"), Some(5));
    assert_eq!(count_of(&fixture, "login_locked_out"), 1);
    assert_invalid_credentials(unlock_with(&fixture, PASSWORD));
}

#[test]
fn unlock_failures_lock_out_and_survive_restart() {
    let installation = Installation::create();
    let first_run = installation.boot();
    sign_in(&first_run, "recepcion", PASSWORD).unwrap();
    lock_now(&first_run);
    for _ in 0..FAILURES_TO_LOCK_OUT {
        assert_invalid_credentials(unlock_with(&first_run, WRONG_PASSWORD));
    }
    assert_eq!(count_of(&first_run, "login_locked_out"), 1);
    drop(first_run);

    let second_run = installation.boot();

    assert_invalid_credentials(sign_in(&second_run, "recepcion", PASSWORD));
}

#[test]
fn unlock_success_clears_persisted_failures() {
    let installation = Installation::create();
    let fixture = installation.boot();
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    lock_now(&fixture);
    assert_invalid_credentials(unlock_with(&fixture, WRONG_PASSWORD));
    assert_eq!(persisted_failures(&fixture, "recepcion"), Some(1));

    unlock_with(&fixture, PASSWORD).unwrap();

    assert_eq!(persisted_failures(&fixture, "recepcion"), None);
}

#[test]
fn unlock_with_correct_password_is_rejected_while_locked_out_and_session_stays_locked() {
    let installation = Installation::create();
    let fixture = installation.boot();
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    lock_now(&fixture);
    database_of(&fixture)
        .with_conn(|conn| {
            conn.execute_batch(
                "INSERT INTO login_throttle (user_id, failures, last_failure_at_utc, locked_until_utc) \
                 SELECT id, 5, strftime('%Y-%m-%dT%H:%M:%fZ','now'), \
                 strftime('%Y-%m-%dT%H:%M:%fZ','now','+300 seconds') \
                 FROM users WHERE username = 'recepcion'",
            )?;
            Ok(())
        })
        .unwrap();

    assert_invalid_credentials(unlock_with(&fixture, PASSWORD));

    let session: State<'_, SessionState> = fixture.app.state();
    assert!(session.locked_user_id().unwrap().is_some());
    assert_eq!(count_of(&fixture, "session_unlocked"), 0);
}

#[test]
fn persisted_lockout_holds_after_the_memory_entry_is_evicted_by_a_full_locked_table() {
    let installation = Installation::create();
    let fixture = installation.boot();
    fail_repeatedly(&fixture, "recepcion", FAILURES_TO_LOCK_OUT);
    let throttle: State<'_, LoginThrottle> = fixture.app.state();
    let now = std::time::Instant::now();
    for index in 0..crate::features::auth::throttle::MAX_TRACKED {
        for _ in 0..FAILURES_TO_LOCK_OUT {
            throttle.reserve_attempt(&format!("relleno-{index}"), now);
        }
    }

    assert_invalid_credentials(sign_in(&fixture, "recepcion", PASSWORD));

    assert_eq!(persisted_failures(&fixture, "recepcion"), Some(5));
    assert_eq!(count_of(&fixture, "login_succeeded"), 0);
}
