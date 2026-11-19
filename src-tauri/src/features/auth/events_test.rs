use std::time::Duration;

use rusqlite::Connection;

use crate::db::migrate;
use crate::features::audit::repository::list_all;
use crate::features::audit::AuditEntry;
use crate::features::auth::events::session_locked_if_new;
use crate::features::auth::model::{LoginCredentials, PermissionKey, SessionStatus, SessionUser};
use crate::features::auth::password::PasswordPolicy;
use crate::features::auth::repository::{insert_user, NewUser};
use crate::features::auth::service::{
    active_user, current_view, locked_user_for_unlock, login, record_activity_view,
    require_permission, AuthError, Beat, SessionState, IDLE_TIMEOUT,
};

const OWNER_ROLE_ID: i64 = 1;
const RECEPTION_ROLE_ID: i64 = 2;
const PASSWORD: &str = "clave-segura-1";
const IDLE_NOTE: &str = r#"{"note":"idle"}"#;
const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn signed_in(conn: &Connection, role_id: i64) -> (SessionState, i64) {
    let policy = PasswordPolicy::new().unwrap();
    let user = NewUser {
        username: "ana".to_string(),
        password_hash: policy.hash(PASSWORD).unwrap(),
        role_id,
    };
    let id = insert_user(conn, &user).unwrap();
    let credentials = LoginCredentials {
        username: "ana".to_string(),
        password: PASSWORD.to_string(),
    };
    let session_user = login(conn, &policy, &credentials).unwrap();
    let state = SessionState::default();
    state.start(session_user, Beat::now()).unwrap();
    (state, id)
}

const WALK_STEP: Duration = Duration::from_secs(60);

fn beat_after(start: Beat, elapsed: Duration) -> Beat {
    Beat {
        mono: start.mono + elapsed,
        wall: start.wall + elapsed,
    }
}

fn idle_beat(state: &SessionState) -> Beat {
    let start = state.last_beat().unwrap().unwrap();
    let target = IDLE_TIMEOUT + Duration::from_secs(1);
    let mut elapsed = WALK_STEP;
    while elapsed < IDLE_TIMEOUT {
        state.observe(beat_after(start, elapsed)).unwrap();
        elapsed += WALK_STEP;
    }
    beat_after(start, target)
}

fn started_at(state: &SessionState) -> Beat {
    state.last_beat().unwrap().unwrap()
}

fn assert_single_idle_lock(entries: &[AuditEntry], user_id: i64) {
    assert_eq!(entries.len(), 1, "{entries:?}");
    let entry = &entries[0];
    assert_eq!(entry.action.as_str(), "session_locked");
    assert_eq!(entry.entity.as_str(), "user");
    assert_eq!(entry.actor_user_id, Some(user_id));
    assert_eq!(entry.entity_id, Some(user_id));
    assert_eq!(entry.diff.as_deref(), Some(IDLE_NOTE));
}

#[test]
fn idle_lock_audited_once_with_reason_idle() {
    let conn = migrated();
    let (state, id) = signed_in(&conn, RECEPTION_ROLE_ID);
    let at = idle_beat(&state);

    let first = current_view(&conn, &state, at).unwrap().unwrap();
    let second = current_view(&conn, &state, at).unwrap().unwrap();

    assert_eq!(first.status, SessionStatus::Locked);
    assert_eq!(second.status, SessionStatus::Locked);
    assert_single_idle_lock(&list_all(&conn).unwrap(), id);
}

#[test]
fn idle_lock_observed_by_record_activity_is_audited_once() {
    let conn = migrated();
    let (state, id) = signed_in(&conn, RECEPTION_ROLE_ID);
    let at = idle_beat(&state);

    let view = record_activity_view(&conn, &state, at).unwrap().unwrap();
    record_activity_view(&conn, &state, at).unwrap();

    assert_eq!(view.status, SessionStatus::Locked);
    assert_single_idle_lock(&list_all(&conn).unwrap(), id);
}

#[test]
fn idle_lock_observed_by_require_permission_is_audited_once() {
    let conn = migrated();
    let (state, id) = signed_in(&conn, OWNER_ROLE_ID);
    let at = idle_beat(&state);

    let first = require_permission(&conn, &state, PermissionKey::ClientsRead, at);
    let second = require_permission(&conn, &state, PermissionKey::ClientsRead, at);

    assert!(matches!(first, Err(AuthError::Locked)));
    assert!(matches!(second, Err(AuthError::Locked)));
    assert_single_idle_lock(&list_all(&conn).unwrap(), id);
}

#[test]
fn idle_lock_observed_while_probing_unlock_is_audited_once() {
    let conn = migrated();
    let (state, id) = signed_in(&conn, RECEPTION_ROLE_ID);
    let at = idle_beat(&state);

    assert_eq!(locked_user_for_unlock(&conn, &state, at).unwrap(), id);
    assert_eq!(locked_user_for_unlock(&conn, &state, at).unwrap(), id);

    assert_single_idle_lock(&list_all(&conn).unwrap(), id);
}

#[test]
fn active_session_writes_no_lock_audit() {
    let conn = migrated();
    let (state, _) = signed_in(&conn, RECEPTION_ROLE_ID);

    current_view(&conn, &state, started_at(&state)).unwrap();
    record_activity_view(&conn, &state, started_at(&state)).unwrap();

    assert!(list_all(&conn).unwrap().is_empty());
}

#[test]
fn forbidden_not_audited() {
    let conn = migrated();
    let (state, _) = signed_in(&conn, RECEPTION_ROLE_ID);

    let result = require_permission(
        &conn,
        &state,
        PermissionKey::UsersManage,
        started_at(&state),
    );

    assert!(matches!(result, Err(AuthError::Forbidden)));
    assert!(list_all(&conn).unwrap().is_empty());
}

#[test]
fn audit_failure_on_idle_lock_is_an_error_not_a_silent_pass() {
    let conn = migrated();
    let (state, _) = signed_in(&conn, RECEPTION_ROLE_ID);
    conn.execute_batch(FAIL_AUDIT_INSERTS).unwrap();
    let at = idle_beat(&state);

    let result = active_user(&conn, &state, at);

    assert!(matches!(result, Err(AuthError::Db(_))));
}

const DROP_FAIL_AUDIT: &str = "DROP TRIGGER fail_audit";

#[test]
fn failed_lock_audit_is_reemitted_until_confirmed_and_written_once() {
    let conn = migrated();
    let (state, id) = signed_in(&conn, RECEPTION_ROLE_ID);
    conn.execute_batch(FAIL_AUDIT_INSERTS).unwrap();
    let at = idle_beat(&state);

    let first = active_user(&conn, &state, at);
    let second = active_user(&conn, &state, at);

    assert!(matches!(first, Err(AuthError::Db(_))));
    assert!(matches!(second, Err(AuthError::Db(_))));
    assert!(list_all(&conn).unwrap().is_empty());

    conn.execute_batch(DROP_FAIL_AUDIT).unwrap();
    let recovered = active_user(&conn, &state, at);
    let after = active_user(&conn, &state, at);

    assert!(matches!(recovered, Err(AuthError::Locked)));
    assert!(matches!(after, Err(AuthError::Locked)));
    assert_single_idle_lock(&list_all(&conn).unwrap(), id);
}

#[test]
fn pending_lock_audit_keeps_its_reason_across_observers() {
    let conn = migrated();
    let (state, id) = signed_in(&conn, RECEPTION_ROLE_ID);
    conn.execute_batch(FAIL_AUDIT_INSERTS).unwrap();
    let at = idle_beat(&state);
    assert!(record_activity_view(&conn, &state, at).is_err());
    conn.execute_batch(DROP_FAIL_AUDIT).unwrap();

    assert_eq!(locked_user_for_unlock(&conn, &state, at).unwrap(), id);
    assert_eq!(locked_user_for_unlock(&conn, &state, at).unwrap(), id);

    assert_single_idle_lock(&list_all(&conn).unwrap(), id);
}

#[test]
fn logout_between_observation_and_audit_does_not_abort_the_audit() {
    let conn = migrated();
    let (state, id) = signed_in(&conn, RECEPTION_ROLE_ID);
    let at = idle_beat(&state);
    let observation = state.observe(at).unwrap().unwrap();
    state.end().unwrap();

    session_locked_if_new(&conn, &state, &observation).unwrap();

    assert_single_idle_lock(&list_all(&conn).unwrap(), id);
}

#[test]
fn unlock_between_observation_and_audit_does_not_abort_the_audit() {
    let conn = migrated();
    let (state, id) = signed_in(&conn, RECEPTION_ROLE_ID);
    let at = idle_beat(&state);
    let observation = state.observe(at).unwrap().unwrap();
    let user = SessionUser {
        id,
        username: "ana".to_string(),
        role_name: String::new(),
        permissions: vec![],
    };
    state.unlock(user, beat_after(at, WALK_STEP)).unwrap();

    session_locked_if_new(&conn, &state, &observation).unwrap();

    assert_single_idle_lock(&list_all(&conn).unwrap(), id);
}

#[test]
fn failed_audit_after_unlock_does_not_leave_a_pending_event_on_the_new_session() {
    let conn = migrated();
    let (state, id) = signed_in(&conn, RECEPTION_ROLE_ID);
    let at = idle_beat(&state);
    let observation = state.observe(at).unwrap().unwrap();
    let user = SessionUser {
        id,
        username: "ana".to_string(),
        role_name: String::new(),
        permissions: vec![],
    };
    let unlocked_at = beat_after(at, WALK_STEP);
    state.unlock(user, unlocked_at).unwrap();
    conn.execute_batch(FAIL_AUDIT_INSERTS).unwrap();

    assert!(session_locked_if_new(&conn, &state, &observation).is_err());
    conn.execute_batch(DROP_FAIL_AUDIT).unwrap();
    current_view(&conn, &state, unlocked_at).unwrap();

    assert!(list_all(&conn).unwrap().is_empty());
}
