use tauri::{Manager, State};

use super::tests::{
    current, fail_repeatedly, fixture, lock_now, sign_in, sign_out, unlock_with, Fixture, PASSWORD,
};
use crate::db::Database;
use crate::errors::AppErrorCode;
use crate::features::audit::repository::list_all;
use crate::features::audit::AuditEntry;

const TYPED_SECRET: &str = "contrasena-tecleada-ZXCV-77";
const TYPED_USERNAME: &str = " ReCePcIoN ";
const UNKNOWN_USERNAME: &str = "fantasma-desconocida";
const FAILURES_TO_LOCK_OUT: u32 = 5;
const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";

fn entries(fixture: &Fixture) -> Vec<AuditEntry> {
    let database: State<'_, Database> = fixture.app.state();
    database.with_conn(list_all).unwrap()
}

fn actions(fixture: &Fixture) -> Vec<String> {
    entries(fixture)
        .into_iter()
        .map(|entry| entry.action.as_str().to_string())
        .collect()
}

fn count_of(fixture: &Fixture, action: &str) -> usize {
    actions(fixture)
        .iter()
        .filter(|recorded| *recorded == action)
        .count()
}

fn user_id(fixture: &Fixture, username: &str) -> i64 {
    let database: State<'_, Database> = fixture.app.state();
    database
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT id FROM users WHERE username = ?1",
                [username],
                |row| row.get(0),
            )?)
        })
        .unwrap()
}

fn break_audit(fixture: &Fixture) {
    let database: State<'_, Database> = fixture.app.state();
    database
        .with_conn(|conn| {
            conn.execute_batch(FAIL_AUDIT_INSERTS)?;
            Ok(())
        })
        .unwrap();
}

fn full_dump(fixture: &Fixture) -> String {
    format!("{:?}", entries(fixture)).to_lowercase()
}

#[test]
fn failed_login_audited_without_password() {
    let fixture = fixture();
    let id = user_id(&fixture, "recepcion");

    let failure = sign_in(&fixture, TYPED_USERNAME, TYPED_SECRET).unwrap_err();

    assert_eq!(failure.code, AppErrorCode::InvalidCredentials);
    let recorded = entries(&fixture);
    assert_eq!(recorded.len(), 1, "{recorded:?}");
    assert_eq!(recorded[0].action.as_str(), "login_failed");
    assert_eq!(recorded[0].actor_user_id, None);
    assert_eq!(recorded[0].entity.as_str(), "user");
    assert_eq!(recorded[0].entity_id, Some(id));
    let dump = full_dump(&fixture);
    assert!(!dump.contains(&TYPED_SECRET.to_lowercase()));
    assert!(!dump.contains("recepcion"));
}

#[test]
fn unknown_username_login_leaves_no_audit_row() {
    let fixture = fixture();

    let failure = sign_in(&fixture, UNKNOWN_USERNAME, TYPED_SECRET).unwrap_err();
    let failure_with_secret_as_name = sign_in(&fixture, TYPED_SECRET, PASSWORD).unwrap_err();

    assert_eq!(failure.code, AppErrorCode::InvalidCredentials);
    assert_eq!(
        failure_with_secret_as_name.code,
        AppErrorCode::InvalidCredentials
    );
    assert!(entries(&fixture).is_empty());
}

#[test]
fn lockout_event_written_once_at_threshold() {
    let fixture = fixture();
    let id = user_id(&fixture, "recepcion");

    fail_repeatedly(&fixture, "recepcion", FAILURES_TO_LOCK_OUT - 1);
    assert_eq!(count_of(&fixture, "login_locked_out"), 0);

    fail_repeatedly(&fixture, "recepcion", 1);
    assert_eq!(count_of(&fixture, "login_locked_out"), 1);

    sign_in(&fixture, "recepcion", PASSWORD).unwrap_err();
    sign_in(&fixture, "recepcion", TYPED_SECRET).unwrap_err();

    assert_eq!(count_of(&fixture, "login_locked_out"), 1);
    assert_eq!(count_of(&fixture, "login_failed"), 5);
    let lockout = entries(&fixture)
        .into_iter()
        .find(|entry| entry.action.as_str() == "login_locked_out")
        .unwrap();
    assert_eq!(lockout.actor_user_id, None);
    assert_eq!(lockout.entity.as_str(), "user");
    assert_eq!(lockout.entity_id, Some(id));
}

#[test]
fn correct_password_on_the_last_allowed_attempt_does_not_lock_out() {
    let fixture = fixture();
    fail_repeatedly(&fixture, "recepcion", FAILURES_TO_LOCK_OUT - 1);

    sign_in(&fixture, "recepcion", PASSWORD).unwrap();

    assert_eq!(count_of(&fixture, "login_locked_out"), 0);
}

#[test]
fn login_success_audited_with_user_id() {
    let fixture = fixture();
    let id = user_id(&fixture, "recepcion");

    sign_in(&fixture, "recepcion", PASSWORD).unwrap();

    let recorded = entries(&fixture);
    assert_eq!(recorded.len(), 1, "{recorded:?}");
    assert_eq!(recorded[0].action.as_str(), "login_succeeded");
    assert_eq!(recorded[0].actor_user_id, Some(id));
    assert_eq!(recorded[0].entity.as_str(), "user");
    assert_eq!(recorded[0].entity_id, Some(id));
    assert_eq!(recorded[0].diff, None);
}

#[test]
fn logout_audited() {
    let fixture = fixture();
    let id = user_id(&fixture, "recepcion");
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();

    sign_out(&fixture).unwrap();
    sign_out(&fixture).unwrap();

    assert_eq!(count_of(&fixture, "logout"), 1);
    let last = entries(&fixture).pop().unwrap();
    assert_eq!(last.action.as_str(), "logout");
    assert_eq!(last.actor_user_id, Some(id));
    assert_eq!(last.entity_id, Some(id));
}

#[test]
fn unlock_success_audited() {
    let fixture = fixture();
    let id = user_id(&fixture, "recepcion");
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    lock_now(&fixture);

    unlock_with(&fixture, PASSWORD).unwrap();

    let last = entries(&fixture).pop().unwrap();
    assert_eq!(last.action.as_str(), "session_unlocked");
    assert_eq!(last.actor_user_id, Some(id));
    assert_eq!(last.entity.as_str(), "user");
    assert_eq!(last.entity_id, Some(id));
}

#[test]
fn unlock_failure_audited() {
    let fixture = fixture();
    let id = user_id(&fixture, "recepcion");
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    lock_now(&fixture);

    unlock_with(&fixture, TYPED_SECRET).unwrap_err();

    let last = entries(&fixture).pop().unwrap();
    assert_eq!(last.action.as_str(), "unlock_failed");
    assert_eq!(last.actor_user_id, Some(id));
    assert_eq!(last.entity_id, Some(id));
    assert!(!full_dump(&fixture).contains(&TYPED_SECRET.to_lowercase()));
    assert_eq!(count_of(&fixture, "login_locked_out"), 0);
}

#[test]
fn unlock_failures_emit_one_lockout_at_threshold() {
    let fixture = fixture();
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    lock_now(&fixture);

    for _ in 0..FAILURES_TO_LOCK_OUT + 2 {
        unlock_with(&fixture, TYPED_SECRET).unwrap_err();
    }

    assert_eq!(count_of(&fixture, "unlock_failed"), 5);
    assert_eq!(count_of(&fixture, "login_locked_out"), 1);
}

#[test]
fn audit_failure_rolls_back_login() {
    let fixture = fixture();
    break_audit(&fixture);

    let failure = sign_in(&fixture, "recepcion", PASSWORD).unwrap_err();

    assert_eq!(failure.code, AppErrorCode::Internal);
    assert_eq!(current(&fixture).unwrap(), None);
    assert!(entries(&fixture).is_empty());
}

#[test]
fn audit_failure_does_not_unlock_the_session() {
    let fixture = fixture();
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    lock_now(&fixture);
    break_audit(&fixture);

    let failure = unlock_with(&fixture, PASSWORD).unwrap_err();

    assert_eq!(failure.code, AppErrorCode::Internal);
    assert_eq!(current(&fixture).unwrap().unwrap().user, None);
}

#[test]
fn audit_failure_on_failed_login_is_an_internal_error_and_still_spends_the_attempt() {
    let fixture = fixture();
    break_audit(&fixture);

    for _ in 0..FAILURES_TO_LOCK_OUT {
        let failure = sign_in(&fixture, "recepcion", TYPED_SECRET).unwrap_err();
        assert_eq!(failure.code, AppErrorCode::Internal);
    }
    let sixth = sign_in(&fixture, "recepcion", PASSWORD).unwrap_err();

    assert_eq!(sixth.code, AppErrorCode::InvalidCredentials);
    assert!(entries(&fixture).is_empty());
}

#[test]
fn audit_failure_on_failed_unlock_still_spends_the_attempt() {
    let fixture = fixture();
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    lock_now(&fixture);
    break_audit(&fixture);

    for _ in 0..FAILURES_TO_LOCK_OUT {
        let failure = unlock_with(&fixture, TYPED_SECRET).unwrap_err();
        assert_eq!(failure.code, AppErrorCode::Internal);
    }
    let sixth = unlock_with(&fixture, PASSWORD).unwrap_err();

    assert_eq!(sixth.code, AppErrorCode::InvalidCredentials);
}

#[test]
fn audit_failure_after_a_correct_password_does_not_spend_the_attempt() {
    let fixture = fixture();
    break_audit(&fixture);

    for _ in 0..FAILURES_TO_LOCK_OUT + 1 {
        let failure = sign_in(&fixture, "recepcion", PASSWORD).unwrap_err();
        assert_eq!(failure.code, AppErrorCode::Internal);
    }
}

fn actors_of(fixture: &Fixture, action: &str) -> Vec<Option<i64>> {
    entries(fixture)
        .into_iter()
        .filter(|entry| entry.action.as_str() == action)
        .map(|entry| entry.actor_user_id)
        .collect()
}

#[test]
fn login_replacing_an_active_session_audits_the_logout_of_the_previous_user() {
    let fixture = fixture();
    let previous = user_id(&fixture, "recepcion");
    let next = user_id(&fixture, "propietaria");
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();

    sign_in(&fixture, "propietaria", PASSWORD).unwrap();

    assert_eq!(
        actions(&fixture),
        vec!["login_succeeded", "logout", "login_succeeded"]
    );
    assert_eq!(actors_of(&fixture, "logout"), vec![Some(previous)]);
    assert_eq!(
        actors_of(&fixture, "login_succeeded"),
        vec![Some(previous), Some(next)]
    );
}

#[test]
fn login_replacing_a_locked_session_audits_the_logout_of_the_locked_user() {
    let fixture = fixture();
    let previous = user_id(&fixture, "recepcion");
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    lock_now(&fixture);

    sign_in(&fixture, "propietaria", PASSWORD).unwrap();

    assert_eq!(actors_of(&fixture, "logout"), vec![Some(previous)]);
}

#[test]
fn login_without_a_previous_session_audits_no_logout() {
    let fixture = fixture();

    sign_in(&fixture, "recepcion", PASSWORD).unwrap();

    assert_eq!(count_of(&fixture, "logout"), 0);
}

#[test]
fn failed_login_over_an_existing_session_audits_no_logout() {
    let fixture = fixture();
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();

    sign_in(&fixture, "propietaria", TYPED_SECRET).unwrap_err();

    assert_eq!(count_of(&fixture, "logout"), 0);
}

#[test]
fn logout_audit_rolls_back_with_a_failing_login_audit() {
    let fixture = fixture();
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    let next = user_id(&fixture, "propietaria");
    let database: State<'_, Database> = fixture.app.state();
    database
        .with_conn(|conn| {
            conn.execute_batch(&format!(
                "CREATE TRIGGER fail_login BEFORE INSERT ON audit_log \
                 WHEN NEW.action = 'login_succeeded' AND NEW.entity_id = {next} \
                 BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END"
            ))?;
            Ok(())
        })
        .unwrap();

    let failure = sign_in(&fixture, "propietaria", PASSWORD).unwrap_err();

    assert_eq!(failure.code, AppErrorCode::Internal);
    assert_eq!(count_of(&fixture, "logout"), 0);
}

#[test]
fn failing_login_audit_keeps_the_previous_session_and_leaves_no_orphan_logout() {
    let fixture = fixture();
    let previous = user_id(&fixture, "recepcion");
    sign_in(&fixture, "recepcion", PASSWORD).unwrap();
    let logins_before = count_of(&fixture, "login_succeeded");
    let next = user_id(&fixture, "propietaria");
    let database: State<'_, Database> = fixture.app.state();
    database
        .with_conn(|conn| {
            conn.execute_batch(&format!(
                "CREATE TRIGGER fail_login BEFORE INSERT ON audit_log \
                 WHEN NEW.action = 'login_succeeded' AND NEW.entity_id = {next} \
                 BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END"
            ))?;
            Ok(())
        })
        .unwrap();

    let failure = sign_in(&fixture, "propietaria", PASSWORD).unwrap_err();

    assert_eq!(failure.code, AppErrorCode::Internal);
    let kept = current(&fixture).unwrap().and_then(|view| view.user);
    assert_eq!(kept.map(|user| user.id), Some(previous));
    assert_eq!(count_of(&fixture, "logout"), 0);
    assert_eq!(count_of(&fixture, "login_succeeded"), logins_before);
}
