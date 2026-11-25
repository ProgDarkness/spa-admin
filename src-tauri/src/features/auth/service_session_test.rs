use std::time::Duration;

use rusqlite::Connection;

use super::tests::{
    add_user, credentials, later, migrated, origin, session_user, OWNER_ROLE_ID, PASSWORD,
    READ_ONLY_ROLE_ID, RECEPTION_ROLE_ID,
};
use super::*;
use crate::errors::{AppError, AppErrorCode};
use crate::features::auth::model::{PermissionKey, SessionStatus};

const WALK_STEP: Duration = Duration::from_secs(60);

pub(super) fn walk(state: &SessionState, from: Beat, until: Duration) {
    let mut elapsed = WALK_STEP;
    while elapsed < until {
        state.observe(later(from, elapsed)).unwrap();
        elapsed += WALK_STEP;
    }
}

fn just_before_idle() -> Duration {
    IDLE_TIMEOUT - Duration::from_secs(1)
}

fn status_of(observation: Option<Observation>) -> SessionStatus {
    observation.unwrap().view.status
}

#[test]
fn observe_without_session_is_none() {
    let state = SessionState::default();
    assert!(state.observe(origin()).unwrap().is_none());
}

#[test]
fn session_state_start_observe_and_end() {
    let state = SessionState::default();
    let start = origin();
    state.start(session_user(), start).unwrap();

    let observation = state.observe(start).unwrap().unwrap();
    assert_eq!(observation.view.status, SessionStatus::Active);
    assert_eq!(observation.view.user, Some(session_user()));
    assert_eq!(observation.locked_now, None);

    assert_eq!(state.end().unwrap(), Some(1));
    assert!(state.observe(start).unwrap().is_none());
    assert_eq!(state.end().unwrap(), None);
}

#[test]
fn session_is_active_at_9m59s_and_locked_at_exactly_10m() {
    let start = origin();
    let active = SessionState::default();
    active.start(session_user(), start).unwrap();
    walk(&active, start, Duration::from_secs(9 * 60 + 59));
    let almost = later(start, Duration::from_secs(9 * 60 + 59));
    assert_eq!(
        status_of(active.observe(almost).unwrap()),
        SessionStatus::Active
    );

    let locked = SessionState::default();
    locked.start(session_user(), start).unwrap();
    walk(&locked, start, Duration::from_secs(10 * 60));
    let boundary = later(start, Duration::from_secs(10 * 60));
    assert_eq!(
        status_of(locked.observe(boundary).unwrap()),
        SessionStatus::Locked
    );
}

#[test]
fn idle_locks_instead_of_signing_out() {
    let state = SessionState::default();
    let start = origin();
    state.start(session_user(), start).unwrap();
    walk(&state, start, IDLE_TIMEOUT);

    let first = state.observe(later(start, IDLE_TIMEOUT)).unwrap().unwrap();
    let second = state.observe(later(start, IDLE_TIMEOUT)).unwrap().unwrap();

    assert_eq!(first.view.status, SessionStatus::Locked);
    assert_eq!(first.view.user, None);
    assert_eq!(first.locked_now, Some(LockReason::Idle));
    assert_eq!(second.view.status, SessionStatus::Locked);
    assert_eq!(second.locked_now, None);
    assert_eq!(state.locked_user_id().unwrap(), Some(1));
}

#[test]
fn current_session_does_not_extend_idle() {
    let state = SessionState::default();
    let start = origin();
    state.start(session_user(), start).unwrap();
    walk(&state, start, just_before_idle());

    let almost = later(start, just_before_idle());
    assert_eq!(
        status_of(state.observe(almost).unwrap()),
        SessionStatus::Active
    );

    let boundary = later(start, IDLE_TIMEOUT);
    assert_eq!(
        status_of(state.observe(boundary).unwrap()),
        SessionStatus::Locked
    );
}

#[test]
fn record_activity_extends_the_session() {
    let state = SessionState::default();
    let start = origin();
    state.start(session_user(), start).unwrap();

    let first = later(start, just_before_idle());
    let second = later(first, just_before_idle());
    walk(&state, start, just_before_idle());
    assert_eq!(
        state.record_activity(first).unwrap().unwrap().view.status,
        SessionStatus::Active
    );
    walk(&state, first, just_before_idle());
    assert_eq!(
        state.record_activity(second).unwrap().unwrap().view.status,
        SessionStatus::Active
    );
}

#[test]
fn record_activity_at_the_idle_boundary_locks_instead_of_extending() {
    let state = SessionState::default();
    let start = origin();
    state.start(session_user(), start).unwrap();
    walk(&state, start, IDLE_TIMEOUT);

    let observation = state
        .record_activity(later(start, IDLE_TIMEOUT))
        .unwrap()
        .unwrap();

    assert_eq!(observation.view.status, SessionStatus::Locked);
    assert_eq!(observation.locked_now, Some(LockReason::Idle));
}

#[test]
fn record_activity_while_locked_does_not_unlock() {
    let state = SessionState::default();
    let start = origin();
    state.start(session_user(), start).unwrap();
    let locked_at = later(start, IDLE_TIMEOUT);
    state.observe(locked_at).unwrap();

    let observation = state
        .record_activity(later(locked_at, Duration::from_secs(1)))
        .unwrap()
        .unwrap();

    assert_eq!(observation.view.status, SessionStatus::Locked);
    assert_eq!(state.locked_user_id().unwrap(), Some(1));
}

#[test]
fn record_activity_without_session_is_none() {
    let state = SessionState::default();
    assert!(state.record_activity(origin()).unwrap().is_none());
}

#[test]
fn observe_keeps_the_latest_beat() {
    let state = SessionState::default();
    let start = origin();
    assert!(state.last_beat().unwrap().is_none());
    state.start(session_user(), start).unwrap();
    let next = later(start, Duration::from_secs(5));

    state.observe(next).unwrap();

    assert_eq!(state.last_beat().unwrap(), Some(next));
}

fn locked_state(start: Beat) -> SessionState {
    let state = SessionState::default();
    state.start(session_user(), start).unwrap();
    walk(&state, start, IDLE_TIMEOUT);
    state.observe(later(start, IDLE_TIMEOUT)).unwrap();
    state
}

#[test]
fn unlock_restores_active_and_restarts_the_idle_clock() {
    let start = origin();
    let state = locked_state(start);
    let unlocked_at = later(start, IDLE_TIMEOUT + Duration::from_secs(30));

    state.unlock(session_user(), unlocked_at).unwrap();

    assert_eq!(state.locked_user_id().unwrap(), None);
    walk(&state, unlocked_at, just_before_idle());
    let almost = later(unlocked_at, just_before_idle());
    assert_eq!(
        status_of(state.observe(almost).unwrap()),
        SessionStatus::Active
    );
    let boundary = later(unlocked_at, IDLE_TIMEOUT);
    assert_eq!(
        status_of(state.observe(boundary).unwrap()),
        SessionStatus::Locked
    );
}

#[test]
fn unlock_without_session_is_unauthenticated() {
    let state = SessionState::default();
    let result = state.unlock(session_user(), origin());
    assert!(matches!(result, Err(AuthError::Unauthenticated)));
}

#[test]
fn unlock_of_an_active_session_is_a_validation_error() {
    let state = SessionState::default();
    let start = origin();
    state.start(session_user(), start).unwrap();

    let result = state.unlock(session_user(), start);

    assert!(matches!(result, Err(AuthError::Validation(_))));
}

#[test]
fn unlock_by_a_different_user_is_rejected_and_stays_locked() {
    let start = origin();
    let state = locked_state(start);
    let other = SessionUser {
        id: 2,
        ..session_user()
    };

    let result = state.unlock(other, later(start, IDLE_TIMEOUT));

    assert!(matches!(result, Err(AuthError::Unauthenticated)));
    assert_eq!(state.locked_user_id().unwrap(), Some(1));
}

#[test]
fn end_if_user_only_ends_the_matching_session() {
    let state = SessionState::default();
    let start = origin();
    state.start(session_user(), start).unwrap();

    assert!(!state.end_if_user(2).unwrap());
    assert!(state.observe(start).unwrap().is_some());
    assert!(state.end_if_user(1).unwrap());
    assert!(state.observe(start).unwrap().is_none());
}

#[test]
fn poisoned_session_lock_recovers_as_signed_out_and_accepts_a_new_session() {
    let state = SessionState::default();
    let start = origin();
    state.start(session_user(), start).unwrap();
    state.poison_for_test();

    assert!(state.observe(start).unwrap().is_none());
    assert_eq!(state.end().unwrap(), None);
    state.start(session_user(), start).unwrap();
    assert_eq!(
        status_of(state.observe(start).unwrap()),
        SessionStatus::Active
    );
}

#[test]
fn observation_carries_the_session_user_id() {
    let state = SessionState::default();
    let start = origin();
    state.start(session_user(), start).unwrap();
    walk(&state, start, IDLE_TIMEOUT);

    let locking = state.observe(later(start, IDLE_TIMEOUT)).unwrap().unwrap();

    assert_eq!(locking.locked_now, Some(LockReason::Idle));
    assert_eq!(locking.user_id, session_user().id);
}

#[test]
fn restored_audit_pending_is_reported_by_the_next_observation_only_once() {
    let state = SessionState::default();
    let start = origin();
    state.start(session_user(), start).unwrap();
    walk(&state, start, IDLE_TIMEOUT);
    let at = later(start, IDLE_TIMEOUT);
    state.observe(at).unwrap();

    state.restore_audit_pending(session_user().id, LockReason::Idle);

    let retried = state.observe(at).unwrap().unwrap();
    let confirmed = state.observe(at).unwrap().unwrap();
    assert_eq!(retried.locked_now, Some(LockReason::Idle));
    assert_eq!(confirmed.locked_now, None);
}

#[test]
fn restore_audit_pending_ignores_other_users_and_unlocked_sessions() {
    let state = SessionState::default();
    let start = origin();
    state.start(session_user(), start).unwrap();

    state.restore_audit_pending(session_user().id, LockReason::Idle);
    state.restore_audit_pending(session_user().id + 1, LockReason::Resume);

    assert_eq!(state.observe(start).unwrap().unwrap().locked_now, None);
}

fn signed_in(conn: &Connection, policy: &PasswordPolicy, role_id: i64) -> (SessionState, i64) {
    let id = add_user(conn, policy, "ana", PASSWORD, role_id);
    let user = login(conn, policy, &credentials("ana", PASSWORD)).unwrap();
    let state = SessionState::default();
    state.start(user, origin()).unwrap();
    (state, id)
}

#[test]
fn require_permission_allows_a_granted_permission() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, id) = signed_in(&conn, &policy, RECEPTION_ROLE_ID);

    let user = require_permission(&conn, &state, PermissionKey::ClientsWrite, origin()).unwrap();

    assert_eq!(user.id, id);
}

#[test]
fn require_permission_without_session_is_unauthenticated() {
    let conn = migrated();
    let state = SessionState::default();

    let result = require_permission(&conn, &state, PermissionKey::ClientsRead, origin());

    assert!(matches!(result, Err(AuthError::Unauthenticated)));
}

#[test]
fn require_permission_denies_a_missing_permission() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, _) = signed_in(&conn, &policy, RECEPTION_ROLE_ID);

    let result = require_permission(&conn, &state, PermissionKey::UsersManage, origin());

    assert!(matches!(result, Err(AuthError::Forbidden)));
}

#[test]
fn protected_command_after_lock_rejected_with_session_locked() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, _) = signed_in(&conn, &policy, OWNER_ROLE_ID);

    let result = require_permission(
        &conn,
        &state,
        PermissionKey::ClientsRead,
        later(origin(), IDLE_TIMEOUT + Duration::from_secs(1)),
    );

    let error = AppError::from(result.unwrap_err());
    assert_eq!(error.code, AppErrorCode::SessionLocked);
}

#[test]
fn require_active_user_while_locked_stays_locked_without_touching_the_database() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, id) = signed_in(&conn, &policy, OWNER_ROLE_ID);
    let locked_at = later(origin(), IDLE_TIMEOUT);
    state.observe(locked_at).unwrap();
    conn.execute("UPDATE users SET active = 0 WHERE id = ?1", [id])
        .unwrap();

    let result = require_active_user_or_roll_back(&conn, &state, locked_at);

    assert!(matches!(result, Err(AuthError::Locked)));
    assert_eq!(state.locked_user_id().unwrap(), Some(id));
}

#[test]
fn require_permission_reloads_permissions_from_the_database() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, id) = signed_in(&conn, &policy, OWNER_ROLE_ID);
    conn.execute(
        "UPDATE users SET role_id = ?1 WHERE id = ?2",
        [READ_ONLY_ROLE_ID, id],
    )
    .unwrap();

    let denied = require_permission(&conn, &state, PermissionKey::UsersManage, origin());
    let allowed = require_permission(&conn, &state, PermissionKey::ClientsRead, origin());

    assert!(matches!(denied, Err(AuthError::Forbidden)));
    assert_eq!(allowed.unwrap().role_name, "Solo lectura");
    let view = state.observe(origin()).unwrap().unwrap().view;
    assert_eq!(view.user.unwrap().role_name, "Solo lectura");
}

#[test]
fn deactivated_user_loses_the_session_on_next_check() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, id) = signed_in(&conn, &policy, OWNER_ROLE_ID);
    conn.execute("UPDATE users SET active = 0 WHERE id = ?1", [id])
        .unwrap();

    let result = require_permission(&conn, &state, PermissionKey::ClientsRead, origin());

    assert!(matches!(result, Err(AuthError::Unauthenticated)));
    assert!(state.observe(origin()).unwrap().is_none());
}

#[test]
fn require_active_user_returns_the_refreshed_session_user() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, id) = signed_in(&conn, &policy, RECEPTION_ROLE_ID);

    let user = require_active_user_or_roll_back(&conn, &state, origin()).unwrap();

    assert_eq!(user.id, id);
}

#[test]
fn current_view_reports_each_session_phase() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, id) = signed_in(&conn, &policy, RECEPTION_ROLE_ID);

    let active = current_view(&conn, &state, origin()).unwrap().unwrap();
    assert_eq!(active.status, SessionStatus::Active);
    assert_eq!(active.user.unwrap().id, id);

    let locked_at = later(origin(), IDLE_TIMEOUT);
    let locked = current_view(&conn, &state, locked_at).unwrap().unwrap();
    assert_eq!(locked.status, SessionStatus::Locked);
    assert_eq!(locked.user, None);

    state.end().unwrap();
    assert!(current_view(&conn, &state, locked_at).unwrap().is_none());
}

#[test]
fn record_activity_view_refreshes_the_user_and_drops_deactivated_ones() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, id) = signed_in(&conn, &policy, RECEPTION_ROLE_ID);

    let view = record_activity_view(&conn, &state, origin())
        .unwrap()
        .unwrap();
    assert_eq!(view.status, SessionStatus::Active);

    conn.execute("UPDATE users SET active = 0 WHERE id = ?1", [id])
        .unwrap();
    assert!(record_activity_view(&conn, &state, origin())
        .unwrap()
        .is_none());
}

#[test]
fn locked_user_for_unlock_requires_a_locked_session() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let id = add_user(&conn, &policy, "ana", PASSWORD, RECEPTION_ROLE_ID);
    let state = SessionState::default();
    let start = origin();
    assert!(matches!(
        locked_user_for_unlock(&conn, &state, start),
        Err(AuthError::Unauthenticated)
    ));

    state
        .start(
            SessionUser {
                id,
                ..session_user()
            },
            start,
        )
        .unwrap();
    assert!(matches!(
        locked_user_for_unlock(&conn, &state, start),
        Err(AuthError::Validation("password"))
    ));

    let idle = later(start, IDLE_TIMEOUT);
    assert_eq!(locked_user_for_unlock(&conn, &state, idle).unwrap(), id);
}

#[test]
fn require_any_permission_allows_when_one_of_the_keys_is_granted() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, id) = signed_in(&conn, &policy, RECEPTION_ROLE_ID);

    let user = require_any_permission(
        &conn,
        &state,
        &[PermissionKey::UsersManage, PermissionKey::ClientsWrite],
        origin(),
    )
    .unwrap();

    assert_eq!(user.id, id);
}

#[test]
fn require_any_permission_is_forbidden_when_none_is_granted() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, _) = signed_in(&conn, &policy, RECEPTION_ROLE_ID);

    let result = require_any_permission(
        &conn,
        &state,
        &[PermissionKey::UsersManage, PermissionKey::BackupManage],
        origin(),
    );

    assert!(matches!(result, Err(AuthError::Forbidden)));
}

#[cfg(debug_assertions)]
#[test]
#[should_panic(expected = "permissions")]
fn require_any_permission_with_an_empty_list_panics_in_debug_builds() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, _) = signed_in(&conn, &policy, OWNER_ROLE_ID);

    let _ = require_any_permission(&conn, &state, &[], origin());
}

#[cfg(not(debug_assertions))]
#[test]
fn require_any_permission_with_an_empty_list_is_forbidden() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, _) = signed_in(&conn, &policy, OWNER_ROLE_ID);

    let result = require_any_permission(&conn, &state, &[], origin());

    assert!(matches!(result, Err(AuthError::Forbidden)));
}

#[test]
fn require_any_permission_without_session_is_unauthenticated() {
    let conn = migrated();
    let state = SessionState::default();

    let result = require_any_permission(&conn, &state, &[PermissionKey::ClientsRead], origin());

    assert!(matches!(result, Err(AuthError::Unauthenticated)));
}

#[test]
fn require_any_permission_after_idle_lock_is_locked_even_with_a_granted_key() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, _) = signed_in(&conn, &policy, OWNER_ROLE_ID);

    let result = require_any_permission(
        &conn,
        &state,
        &[PermissionKey::ClientsRead],
        later(origin(), IDLE_TIMEOUT + Duration::from_secs(1)),
    );

    assert!(matches!(result, Err(AuthError::Locked)));
}

#[test]
fn require_any_permission_reloads_permissions_from_the_database() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let (state, id) = signed_in(&conn, &policy, OWNER_ROLE_ID);
    conn.execute(
        "UPDATE users SET role_id = ?1 WHERE id = ?2",
        [READ_ONLY_ROLE_ID, id],
    )
    .unwrap();

    let denied = require_any_permission(&conn, &state, &[PermissionKey::UsersManage], origin());
    let allowed = require_any_permission(
        &conn,
        &state,
        &[PermissionKey::UsersManage, PermissionKey::ClientsRead],
        origin(),
    );

    assert!(matches!(denied, Err(AuthError::Forbidden)));
    assert!(allowed.is_ok());
}
