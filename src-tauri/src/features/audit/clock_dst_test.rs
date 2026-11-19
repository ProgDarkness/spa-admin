use rusqlite::Connection;

use super::*;
use crate::db::migrate;

const FALL_BACK_FIRST_PASS_LOCAL: &str = "2026-11-01T01:50:00";
const FALL_BACK_FIRST_PASS_UTC: &str = "2026-11-01T05:50:00.000Z";
const FALL_BACK_SECOND_PASS_NOW: &str = "2026-11-01T06:10:00Z";
const FALL_BACK_SECOND_PASS_LOCAL: &str = "2026-11-01T01:10:00";
const FALL_BACK_SECOND_PASS_UTC: &str = "2026-11-01T06:10:00.000Z";
const FALL_BACK_REAL_ROLLBACK_NOW: &str = "2026-11-01T05:50:00Z";
const PLAIN_RECORDED_LOCAL: &str = "2026-07-01T12:10:00";
const PLAIN_RECORDED_UTC: &str = "2026-07-01T16:10:00.000Z";
const PLAIN_NOW_OVER_TOLERANCE: &str = "2026-07-01T16:04:59Z";
const PLAIN_NOW_AT_TOLERANCE: &str = "2026-07-01T16:05:00Z";

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn insert_stamped(conn: &Connection, local: &str, utc: &str) {
    conn.execute(
        "INSERT INTO audit_log (occurred_at, occurred_at_utc, action, entity) \
         VALUES (?1, ?2, 'logout', 'system')",
        [local, utc],
    )
    .unwrap();
}

#[test]
fn clock_falling_back_for_dst_is_not_reported_as_rollback() {
    let conn = migrated();
    insert_stamped(&conn, FALL_BACK_FIRST_PASS_LOCAL, FALL_BACK_FIRST_PASS_UTC);

    let detected = detect_clock_rollback_at(&conn, FALL_BACK_SECOND_PASS_NOW).unwrap();

    assert_eq!(detected, None);
}

#[test]
fn real_rollback_during_the_repeated_dst_hour_is_still_detected() {
    let conn = migrated();
    insert_stamped(
        &conn,
        FALL_BACK_SECOND_PASS_LOCAL,
        FALL_BACK_SECOND_PASS_UTC,
    );

    let detected = detect_clock_rollback_at(&conn, FALL_BACK_REAL_ROLLBACK_NOW).unwrap();

    assert_eq!(
        detected.map(|rollback| rollback.last_recorded_at),
        Some(FALL_BACK_SECOND_PASS_LOCAL.to_string())
    );
}

#[test]
fn rollback_tolerance_is_measured_in_utc_seconds() {
    let conn = migrated();
    insert_stamped(&conn, PLAIN_RECORDED_LOCAL, PLAIN_RECORDED_UTC);

    assert!(detect_clock_rollback_at(&conn, PLAIN_NOW_OVER_TOLERANCE)
        .unwrap()
        .is_some());
    assert_eq!(
        detect_clock_rollback_at(&conn, PLAIN_NOW_AT_TOLERANCE).unwrap(),
        None
    );
}

#[test]
fn newest_utc_instant_decides_even_when_local_stamps_order_differently() {
    let conn = migrated();
    insert_stamped(&conn, FALL_BACK_FIRST_PASS_LOCAL, FALL_BACK_FIRST_PASS_UTC);
    insert_stamped(
        &conn,
        FALL_BACK_SECOND_PASS_LOCAL,
        FALL_BACK_SECOND_PASS_UTC,
    );

    let detected = detect_clock_rollback_at(&conn, FALL_BACK_REAL_ROLLBACK_NOW).unwrap();

    assert_eq!(
        detected.map(|rollback| rollback.last_recorded_at),
        Some(FALL_BACK_SECOND_PASS_LOCAL.to_string())
    );
}

#[test]
fn rollback_diff_carries_both_utc_instants_alongside_local_stamps() {
    let conn = migrated();
    insert_stamped(
        &conn,
        FALL_BACK_SECOND_PASS_LOCAL,
        FALL_BACK_SECOND_PASS_UTC,
    );

    record_clock_rollback_at(&conn, FALL_BACK_REAL_ROLLBACK_NOW).unwrap();

    let entries = crate::features::audit::repository::list_all(&conn).unwrap();
    let entry = entries
        .iter()
        .find(|entry| entry.action == crate::features::audit::AuditAction::ClockRollback)
        .unwrap();
    let diff: serde_json::Value = serde_json::from_str(entry.diff.as_deref().unwrap()).unwrap();
    assert_eq!(diff["lastRecordedAt"], FALL_BACK_SECOND_PASS_LOCAL);
    assert_eq!(diff["lastRecordedAtUtc"], FALL_BACK_SECOND_PASS_UTC);
    assert_eq!(diff["detectedAtUtc"], "2026-11-01T05:50:00.000Z");
    assert!(diff["detectedAt"].is_string());
}

#[test]
fn invalid_now_fails_closed_instead_of_hiding_a_rollback() {
    let conn = migrated();
    insert_stamped(
        &conn,
        FALL_BACK_SECOND_PASS_LOCAL,
        FALL_BACK_SECOND_PASS_UTC,
    );

    assert!(matches!(
        detect_clock_rollback_at(&conn, "basura"),
        Err(DbError::InvalidInstant)
    ));
    assert!(matches!(
        record_clock_rollback_at(&conn, "basura"),
        Err(DbError::InvalidInstant)
    ));
}
