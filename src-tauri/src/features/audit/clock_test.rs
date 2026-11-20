use rusqlite::Connection;

use super::*;
use crate::db::migrate;
use crate::features::audit::repository::list_all;
use crate::features::audit::{AuditAction, AuditEntity};

const FUTURE_BEYOND_TOLERANCE: &str = "+10 minutes";
const FUTURE_WITHIN_TOLERANCE: &str = "+2 minutes";
const FUTURE_NEAR_BOUNDARY: &str = "+295 seconds";
const PAST: &str = "-3 hours";

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn insert_at(conn: &Connection, offset: &str) -> String {
    let (stamp, stamp_utc): (String, String) = conn
        .query_row(
            "SELECT strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', ?1), \
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?1)",
            [offset],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    conn.execute(
        "INSERT INTO audit_log (occurred_at, occurred_at_utc, action, entity) \
         VALUES (?1, ?2, 'logout', 'system')",
        [&stamp, &stamp_utc],
    )
    .unwrap();
    stamp
}

fn rollback_rows(conn: &Connection) -> Vec<crate::features::audit::AuditEntry> {
    list_all(conn)
        .unwrap()
        .into_iter()
        .filter(|entry| entry.action == AuditAction::ClockRollback)
        .collect()
}

#[test]
fn tolerance_is_five_minutes() {
    assert_eq!(CLOCK_ROLLBACK_TOLERANCE_SECS, 300);
}

#[test]
fn rollback_over_5min_is_detected_with_both_stamps() {
    let conn = migrated();
    let recorded = insert_at(&conn, FUTURE_BEYOND_TOLERANCE);

    let detected = detect_clock_rollback(&conn).unwrap().unwrap();

    assert_eq!(detected.last_recorded_at, recorded);
    assert_eq!(detected.detected_at.len(), 19);
    assert!(detected.detected_at < detected.last_recorded_at);
}

#[test]
fn rollback_within_5min_silent() {
    let conn = migrated();
    insert_at(&conn, FUTURE_WITHIN_TOLERANCE);

    assert_eq!(detect_clock_rollback(&conn).unwrap(), None);
}

#[test]
fn rollback_just_inside_tolerance_is_silent() {
    let conn = migrated();
    insert_at(&conn, FUTURE_NEAR_BOUNDARY);

    assert_eq!(detect_clock_rollback(&conn).unwrap(), None);
}

#[test]
fn empty_audit_log_no_warning() {
    let conn = migrated();

    assert_eq!(detect_clock_rollback(&conn).unwrap(), None);
}

#[test]
fn past_entries_do_not_warn() {
    let conn = migrated();
    insert_at(&conn, PAST);

    assert_eq!(detect_clock_rollback(&conn).unwrap(), None);
}

#[test]
fn newest_entry_decides_not_an_older_future_one() {
    let conn = migrated();
    insert_at(&conn, PAST);
    insert_at(&conn, FUTURE_BEYOND_TOLERANCE);

    assert!(detect_clock_rollback(&conn).unwrap().is_some());
}

#[test]
fn clock_rollback_over_5min_warns_and_audits_once() {
    let conn = migrated();
    let recorded = insert_at(&conn, FUTURE_BEYOND_TOLERANCE);

    let outcome = record_clock_rollback(&conn).unwrap();

    assert_eq!(outcome.unwrap().last_recorded_at, recorded);
    assert_eq!(rollback_rows(&conn).len(), 1);
}

#[test]
fn no_rollback_means_nothing_is_audited() {
    let conn = migrated();
    insert_at(&conn, PAST);

    let outcome = record_clock_rollback(&conn).unwrap();

    assert_eq!(outcome, None);
    assert!(rollback_rows(&conn).is_empty());
}

#[test]
fn rollback_audit_has_no_actor_and_system_entity() {
    let conn = migrated();
    let recorded = insert_at(&conn, FUTURE_BEYOND_TOLERANCE);

    let detected = record_clock_rollback(&conn).unwrap().unwrap();

    let rows = rollback_rows(&conn);
    let entry = &rows[0];
    let diff: serde_json::Value = serde_json::from_str(entry.diff.as_deref().unwrap()).unwrap();
    assert_eq!(entry.actor_user_id, None);
    assert_eq!(entry.actor_username, None);
    assert_eq!(entry.entity, AuditEntity::System);
    assert_eq!(entry.entity_id, None);
    assert_eq!(diff["lastRecordedAt"], recorded);
    assert_eq!(diff["detectedAt"], detected.detected_at);
}

#[test]
fn notice_wraps_optional_rollback() {
    let notice = ClockRollbackNotice(None);

    assert_eq!(notice.0, None);
}
