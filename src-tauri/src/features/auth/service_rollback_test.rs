use std::time::Duration;

use rusqlite::Connection;

use super::session_tests::walk;
use super::tests::{add_user, credentials, later, migrated, origin, OWNER_ROLE_ID, PASSWORD};
use super::*;
use crate::features::auth::model::PermissionKey;

const PROTECTED_PERMISSIONS: [PermissionKey; 3] = [
    PermissionKey::CatalogWrite,
    PermissionKey::ResourcesManage,
    PermissionKey::UsersManage,
];

fn past_idle(start: Beat) -> Beat {
    later(start, IDLE_TIMEOUT + Duration::from_secs(1))
}

fn signed_in_owner(conn: &Connection) -> (SessionState, Beat) {
    let policy = PasswordPolicy::new().unwrap();
    add_user(conn, &policy, "ana", PASSWORD, OWNER_ROLE_ID);
    let user = login(conn, &policy, &credentials("ana", PASSWORD)).unwrap();
    let state = SessionState::default();
    let start = origin();
    state.start(user, start).unwrap();
    (state, start)
}

fn session_locked_rows(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'session_locked'",
        [],
        |row| row.get(0),
    )
    .unwrap()
}

fn rolled_back_attempt(
    conn: &Connection,
    state: &SessionState,
    permission: PermissionKey,
    beat: Beat,
) -> Result<SessionUser, AuthError> {
    let tx = conn.unchecked_transaction().unwrap();
    let outcome = require_permission(&tx, state, permission, beat);
    tx.rollback().unwrap();
    outcome
}

#[test]
fn an_idle_lock_first_seen_inside_a_rolled_back_transaction_is_audited_by_the_next_attempt() {
    for permission in PROTECTED_PERMISSIONS {
        let conn = migrated();
        let (state, start) = signed_in_owner(&conn);

        let inside = rolled_back_attempt(&conn, &state, permission, past_idle(start));
        assert!(matches!(inside, Err(AuthError::Locked)), "{permission:?}");
        assert_eq!(session_locked_rows(&conn), 0, "{permission:?}");

        let outside = require_permission(&conn, &state, permission, past_idle(start));
        assert!(matches!(outside, Err(AuthError::Locked)), "{permission:?}");
        assert_eq!(session_locked_rows(&conn), 1, "{permission:?}");
    }
}

#[test]
fn repeated_rollbacks_still_leave_exactly_one_lock_event_once_one_attempt_commits() {
    let conn = migrated();
    let (state, start) = signed_in_owner(&conn);

    for _ in 0..3 {
        let inside =
            rolled_back_attempt(&conn, &state, PermissionKey::CatalogWrite, past_idle(start));
        assert!(matches!(inside, Err(AuthError::Locked)));
    }
    for _ in 0..2 {
        let outside =
            require_permission(&conn, &state, PermissionKey::CatalogWrite, past_idle(start));
        assert!(matches!(outside, Err(AuthError::Locked)));
    }

    assert_eq!(session_locked_rows(&conn), 1);
}

#[test]
fn require_any_permission_rolled_back_on_first_sight_of_an_idle_lock_is_audited_later() {
    let conn = migrated();
    let (state, start) = signed_in_owner(&conn);
    let tx = conn.unchecked_transaction().unwrap();
    let inside = require_any_permission(&tx, &state, &PROTECTED_PERMISSIONS, past_idle(start));
    tx.rollback().unwrap();
    assert!(matches!(inside, Err(AuthError::Locked)));

    let outside = require_any_permission(&conn, &state, &PROTECTED_PERMISSIONS, past_idle(start));

    assert!(matches!(outside, Err(AuthError::Locked)));
    assert_eq!(session_locked_rows(&conn), 1);
}

#[test]
fn a_committed_transaction_that_reports_the_lock_as_a_view_audits_it_exactly_once() {
    let conn = migrated();
    let (state, start) = signed_in_owner(&conn);
    let tx = conn.unchecked_transaction().unwrap();
    let view = current_view(&tx, &state, past_idle(start))
        .unwrap()
        .unwrap();
    tx.commit().unwrap();
    assert_eq!(view.status, SessionStatus::Locked);

    let again = current_view(&conn, &state, past_idle(start))
        .unwrap()
        .unwrap();

    assert_eq!(again.status, SessionStatus::Locked);
    assert_eq!(session_locked_rows(&conn), 1);
}

#[test]
fn an_idle_lock_first_seen_outside_a_transaction_is_audited_once_and_never_restored() {
    let conn = migrated();
    let (state, start) = signed_in_owner(&conn);

    for _ in 0..2 {
        let outcome =
            require_permission(&conn, &state, PermissionKey::CatalogWrite, past_idle(start));
        assert!(matches!(outcome, Err(AuthError::Locked)));
    }

    assert_eq!(session_locked_rows(&conn), 1);
}

fn session_locked_notes(conn: &Connection) -> Vec<String> {
    let mut statement = conn
        .prepare("SELECT diff FROM audit_log WHERE action = 'session_locked'")
        .unwrap();
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

#[test]
fn the_restored_audit_keeps_the_idle_reason() {
    let conn = migrated();
    let (state, start) = signed_in_owner(&conn);
    walk(&state, start, IDLE_TIMEOUT);
    let at_timeout = later(start, IDLE_TIMEOUT);

    let inside = rolled_back_attempt(&conn, &state, PermissionKey::CatalogWrite, at_timeout);
    assert!(matches!(inside, Err(AuthError::Locked)));
    let outside = require_permission(&conn, &state, PermissionKey::CatalogWrite, at_timeout);
    assert!(matches!(outside, Err(AuthError::Locked)));

    assert_eq!(session_locked_notes(&conn), vec![r#"{"note":"idle"}"#]);
}

#[test]
fn the_restored_audit_keeps_the_resume_reason() {
    let conn = migrated();
    let (state, start) = signed_in_owner(&conn);

    let inside = rolled_back_attempt(&conn, &state, PermissionKey::CatalogWrite, past_idle(start));
    assert!(matches!(inside, Err(AuthError::Locked)));
    let outside = require_permission(&conn, &state, PermissionKey::CatalogWrite, past_idle(start));
    assert!(matches!(outside, Err(AuthError::Locked)));

    assert_eq!(session_locked_notes(&conn), vec![r#"{"note":"resume"}"#]);
}

fn swallowing_locked_then_committing(
    conn: &Connection,
    state: &SessionState,
    beat: Beat,
    resolve: impl Fn(&Connection, &SessionState, Beat) -> Result<SessionUser, AuthError>,
) {
    let tx = conn.unchecked_transaction().unwrap();
    let swallowed = resolve(&tx, state, beat);
    assert!(matches!(swallowed, Err(AuthError::Locked)));
    tx.commit().unwrap();
    let outside = require_permission(conn, state, PermissionKey::CatalogWrite, beat);
    assert!(matches!(outside, Err(AuthError::Locked)));
}

#[test]
fn swallowing_locked_after_the_restoring_path_duplicates_the_event() {
    let conn = migrated();
    let (state, start) = signed_in_owner(&conn);

    swallowing_locked_then_committing(
        &conn,
        &state,
        past_idle(start),
        require_active_user_or_roll_back,
    );

    assert_eq!(session_locked_rows(&conn), 2);
}

#[test]
fn swallowing_locked_after_the_non_restoring_path_audits_the_event_once() {
    let conn = migrated();
    let (state, start) = signed_in_owner(&conn);

    swallowing_locked_then_committing(&conn, &state, past_idle(start), |conn, state, beat| {
        resolve_active_user(conn, state, beat).outcome
    });

    assert_eq!(session_locked_rows(&conn), 1);
}

fn other_user() -> SessionUser {
    SessionUser {
        id: 9_999,
        username: "otra".to_string(),
        role_name: "Recepcion".to_string(),
        permissions: Vec::new(),
    }
}

#[test]
fn the_restoration_targets_the_observed_user_even_if_another_session_took_over() {
    let conn = migrated();
    let (state, start) = signed_in_owner(&conn);
    let tx = conn.unchecked_transaction().unwrap();
    let resolution = resolve_active_user(&tx, &state, past_idle(start));
    tx.rollback().unwrap();
    assert!(matches!(resolution.outcome, Err(AuthError::Locked)));
    state.end().unwrap();
    state.start(other_user(), start).unwrap();
    state.force_lock().unwrap();

    restore_unaudited_lock(&state, &resolution);

    let observed = state.observe(start).unwrap().unwrap();
    assert_eq!(observed.user_id, other_user().id);
    assert_eq!(observed.locked_now, None);
}

fn rolled_back_idle_resolution(conn: &Connection, state: &SessionState, start: Beat) -> Resolution {
    let tx = conn.unchecked_transaction().unwrap();
    let resolution = resolve_active_user(&tx, state, past_idle(start));
    tx.rollback().unwrap();
    assert!(matches!(resolution.outcome, Err(AuthError::Locked)));
    resolution
}

#[test]
fn the_restoration_is_skipped_when_the_session_ended_meanwhile() {
    let conn = migrated();
    let (state, start) = signed_in_owner(&conn);
    let resolution = rolled_back_idle_resolution(&conn, &state, start);
    state.end().unwrap();

    restore_unaudited_lock(&state, &resolution);

    assert_eq!(state.observe(start).unwrap(), None);
    state.start(other_user(), start).unwrap();
    state.force_lock().unwrap();
    assert_eq!(state.observe(start).unwrap().unwrap().locked_now, None);
}

#[test]
fn the_restoration_is_skipped_when_the_same_user_started_a_fresh_unlocked_session() {
    let conn = migrated();
    let (state, start) = signed_in_owner(&conn);
    let resolution = rolled_back_idle_resolution(&conn, &state, start);
    let user_id = state.current_user_id().unwrap().unwrap();
    let user = SessionUser {
        id: user_id,
        username: "ana".to_string(),
        role_name: "Owner".to_string(),
        permissions: Vec::new(),
    };
    state.start(user, start).unwrap();

    restore_unaudited_lock(&state, &resolution);

    let observed = state.observe(start).unwrap().unwrap();
    assert_eq!(observed.locked_now, None);
    assert_eq!(observed.view.status, SessionStatus::Active);
}
