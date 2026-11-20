use rusqlite::{Connection, ErrorCode};

use super::*;
use crate::db::migrate;
use crate::features::audit::{AuditAction, AuditEntity, Diff};

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn system_entry(action: AuditAction) -> NewAuditEntry {
    NewAuditEntry {
        actor_user_id: None,
        action,
        entity: AuditEntity::System,
        entity_id: None,
        diff: None,
    }
}

fn is_constraint_violation(result: rusqlite::Result<usize>) -> bool {
    result.unwrap_err().sqlite_error_code() == Some(ErrorCode::ConstraintViolation)
}

fn is_append_only_abort(result: rusqlite::Result<usize>) -> bool {
    result
        .unwrap_err()
        .to_string()
        .contains("audit_log is append-only")
}

#[test]
fn update_on_audit_log_aborts() {
    let conn = migrated();
    let id = insert(&conn, &system_entry(AuditAction::LoginSucceeded)).unwrap();
    let result = conn.execute("UPDATE audit_log SET action = 'logout' WHERE id = ?1", [id]);
    assert!(is_append_only_abort(result));
    assert_eq!(
        find_by_id(&conn, id).unwrap().unwrap().action,
        AuditAction::LoginSucceeded
    );
}

#[test]
fn delete_on_audit_log_aborts() {
    let conn = migrated();
    let id = insert(&conn, &system_entry(AuditAction::LoginSucceeded)).unwrap();
    let result = conn.execute("DELETE FROM audit_log WHERE id = ?1", [id]);
    assert!(is_append_only_abort(result));
    assert!(find_by_id(&conn, id).unwrap().is_some());
}

#[test]
fn record_rejects_unknown_action_via_check() {
    let conn = migrated();
    let result = conn.execute(
        "INSERT INTO audit_log (action, entity) VALUES ('hack', 'system')",
        [],
    );
    assert!(is_constraint_violation(result));
}

#[test]
fn unknown_kind_rejected_by_check() {
    let conn = migrated();
    let result = conn.execute(
        "INSERT INTO audit_log (action, entity) VALUES ('login_succeeded', 'invoice')",
        [],
    );
    assert!(is_constraint_violation(result));
}

#[test]
fn invalid_json_diff_rejected_by_check() {
    let conn = migrated();
    let result = conn.execute(
        "INSERT INTO audit_log (action, entity, diff) VALUES ('login_succeeded', 'system', '{no')",
        [],
    );
    assert!(is_constraint_violation(result));
}

#[test]
fn record_persists_seconds_precision_at() {
    let conn = migrated();
    let id = insert(&conn, &system_entry(AuditAction::LoginSucceeded)).unwrap();
    let stored = find_by_id(&conn, id).unwrap().unwrap().occurred_at;
    let shape = "dddd-dd-ddTdd:dd:dd";
    let matches_shape = stored.len() == shape.len()
        && stored.chars().zip(shape.chars()).all(|(actual, expected)| {
            if expected == 'd' {
                actual.is_ascii_digit()
            } else {
                actual == expected
            }
        });
    assert!(matches_shape, "occurred_at: {stored}");
}

#[test]
fn insert_round_trips_actor_entity_and_diff() {
    let conn = migrated();
    conn.execute(
        "INSERT INTO users (username, password_hash, role_id) VALUES ('ana', 'h', 1)",
        [],
    )
    .unwrap();
    let entry = NewAuditEntry {
        actor_user_id: Some(1),
        action: AuditAction::UserUpdated,
        entity: AuditEntity::User,
        entity_id: Some(1),
        diff: Some(Diff::note("x")),
    };
    let id = insert(&conn, &entry).unwrap();
    let stored = find_by_id(&conn, id).unwrap().unwrap();
    assert_eq!(
        (
            stored.actor_user_id,
            stored.action.as_str(),
            stored.entity.as_str(),
            stored.entity_id,
            stored.diff
        ),
        (
            Some(1),
            "user_updated",
            "user",
            Some(1),
            Some(r#"{"note":"x"}"#.to_string())
        )
    );
}

#[test]
fn unknown_actor_is_rejected_by_foreign_key() {
    let conn = migrated();
    let entry = NewAuditEntry {
        actor_user_id: Some(999),
        ..system_entry(AuditAction::LoginSucceeded)
    };
    assert!(matches!(insert(&conn, &entry), Err(DbError::Sqlite(_))));
}

#[test]
fn find_by_id_returns_none_when_missing() {
    let conn = migrated();
    assert_eq!(find_by_id(&conn, 42).unwrap(), None);
}

#[test]
fn every_audit_action_is_accepted_by_the_check() {
    let conn = migrated();
    let actions = [
        AuditAction::LoginSucceeded,
        AuditAction::LoginFailed,
        AuditAction::LoginLockedOut,
        AuditAction::Logout,
        AuditAction::SessionLocked,
        AuditAction::SessionUnlocked,
        AuditAction::UnlockFailed,
        AuditAction::OwnerCreated,
        AuditAction::RecoveryUsed,
        AuditAction::RecoveryFailed,
        AuditAction::UserCreated,
        AuditAction::UserUpdated,
        AuditAction::PasswordReset,
        AuditAction::RoleCreated,
        AuditAction::RolePermissionsChanged,
        AuditAction::ClockRollback,
    ];
    assert!(actions
        .into_iter()
        .all(|action| insert(&conn, &system_entry(action)).is_ok()));
}
