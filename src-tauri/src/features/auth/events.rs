use rusqlite::Connection;

use super::service::{AuthError, LockReason, Observation, SessionState};
use crate::features::audit::{self, AuditAction, AuditEntity, Diff, NewAuditEntry};

fn record_user_event(
    conn: &Connection,
    action: AuditAction,
    actor_user_id: Option<i64>,
    user_id: i64,
    diff: Option<Diff>,
) -> Result<(), AuthError> {
    let entry = NewAuditEntry {
        actor_user_id,
        action,
        entity: AuditEntity::User,
        entity_id: Some(user_id),
        diff,
    };
    audit::record(conn, &entry)?;
    Ok(())
}

fn record_lockout(conn: &Connection, user_id: i64) -> Result<(), AuthError> {
    record_user_event(conn, AuditAction::LoginLockedOut, None, user_id, None)
}

fn reason_label(reason: LockReason) -> &'static str {
    match reason {
        LockReason::Idle => "idle",
        LockReason::Resume => "resume",
    }
}

pub fn owner_created(
    conn: &Connection,
    user_id: i64,
    username: &str,
    role_id: i64,
) -> Result<(), AuthError> {
    let created = Diff::created(&serde_json::json!({ "username": username, "roleId": role_id }));
    record_user_event(
        conn,
        AuditAction::OwnerCreated,
        Some(user_id),
        user_id,
        created,
    )
}

pub fn login_succeeded(conn: &Connection, user_id: i64) -> Result<(), AuthError> {
    record_user_event(
        conn,
        AuditAction::LoginSucceeded,
        Some(user_id),
        user_id,
        None,
    )
}

pub fn login_failed(conn: &Connection, user_id: i64, locks_out: bool) -> Result<(), AuthError> {
    record_user_event(conn, AuditAction::LoginFailed, None, user_id, None)?;
    if locks_out {
        record_lockout(conn, user_id)?;
    }
    Ok(())
}

pub fn recovery_used(conn: &Connection, user_id: i64) -> Result<(), AuthError> {
    record_user_event(
        conn,
        AuditAction::RecoveryUsed,
        Some(user_id),
        user_id,
        None,
    )
}

pub fn recovery_failed(conn: &Connection, user_id: i64, locks_out: bool) -> Result<(), AuthError> {
    record_user_event(conn, AuditAction::RecoveryFailed, None, user_id, None)?;
    if locks_out {
        record_lockout(conn, user_id)?;
    }
    Ok(())
}

pub fn logout(conn: &Connection, user_id: i64) -> Result<(), AuthError> {
    record_user_event(conn, AuditAction::Logout, Some(user_id), user_id, None)
}

pub fn session_unlocked(conn: &Connection, user_id: i64) -> Result<(), AuthError> {
    record_user_event(
        conn,
        AuditAction::SessionUnlocked,
        Some(user_id),
        user_id,
        None,
    )
}

pub fn unlock_failed(conn: &Connection, user_id: i64, locks_out: bool) -> Result<(), AuthError> {
    record_user_event(
        conn,
        AuditAction::UnlockFailed,
        Some(user_id),
        user_id,
        None,
    )?;
    if locks_out {
        record_lockout(conn, user_id)?;
    }
    Ok(())
}

pub fn session_locked_if_new(
    conn: &Connection,
    session: &SessionState,
    observation: &Observation,
) -> Result<(), AuthError> {
    let Some(reason) = observation.locked_now else {
        return Ok(());
    };
    let user_id = observation.user_id;
    record_user_event(
        conn,
        AuditAction::SessionLocked,
        Some(user_id),
        user_id,
        Some(Diff::note(reason_label(reason))),
    )
    .inspect_err(|_| session.restore_audit_pending(user_id, reason))
}

#[cfg(test)]
#[path = "events_test.rs"]
mod tests;
