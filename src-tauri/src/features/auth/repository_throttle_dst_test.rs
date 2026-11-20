use rusqlite::Connection;

use super::*;
use crate::db::migrate;

const RECEPTION_ROLE_ID: i64 = 2;
const FAILURE_LIMIT: u32 = MAX_PERSISTED_FAILURES;

const FALL_BACK_LOCKED_AT: &str = "2026-11-01T05:58:00Z";
const FALL_BACK_STILL_LOCKED: &str = "2026-11-01T06:02:59Z";
const FALL_BACK_EXPIRED: &str = "2026-11-01T06:03:01Z";
const FALL_BACK_WINDOW_EXPIRED: &str = "2026-11-01T06:04:00Z";

const SPRING_FORWARD_LOCKED_AT: &str = "2026-03-08T06:58:00Z";
const SPRING_FORWARD_STILL_LOCKED: &str = "2026-03-08T07:02:00Z";
const SPRING_FORWARD_WINDOW_OPEN: &str = "2026-03-08T07:02:00Z";
const SPRING_FORWARD_EXPIRED: &str = "2026-03-08T07:03:01Z";

const PLAIN_LOCKED_AT: &str = "2026-07-01T12:00:00Z";
const PLAIN_LAST_LOCKED_SECOND: &str = "2026-07-01T12:04:59Z";
const PLAIN_FIRST_FREE_SECOND: &str = "2026-07-01T12:05:01Z";
const PLAIN_EXPIRY_INSTANT: &str = "2026-07-01T12:05:00Z";

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn add_user(conn: &Connection) -> i64 {
    let user = NewUser {
        username: "ana".to_string(),
        password_hash: "hash-de-ana".to_string(),
        role_id: RECEPTION_ROLE_ID,
    };
    insert_user(conn, &user).unwrap()
}

fn fail_times(conn: &Connection, user_id: i64, times: u32, at: &str) -> PersistedFailure {
    (0..times)
        .map(|_| record_persisted_failure_at(conn, user_id, at).unwrap())
        .last()
        .unwrap()
}

fn is_locked_at(conn: &Connection, user_id: i64, at: &str) -> bool {
    find_credentials_by_id_at(conn, user_id, at)
        .unwrap()
        .unwrap()
        .is_locked_out
}

#[test]
fn lockout_ends_five_real_minutes_after_the_clock_falls_back() {
    let conn = migrated();
    let id = add_user(&conn);

    let locked = fail_times(&conn, id, FAILURE_LIMIT, FALL_BACK_LOCKED_AT);

    assert!(locked.locked_now);
    assert!(is_locked_at(&conn, id, FALL_BACK_STILL_LOCKED));
    assert!(!is_locked_at(&conn, id, FALL_BACK_EXPIRED));
}

#[test]
fn lockout_holds_five_real_minutes_when_the_clock_springs_forward() {
    let conn = migrated();
    let id = add_user(&conn);

    fail_times(&conn, id, FAILURE_LIMIT, SPRING_FORWARD_LOCKED_AT);

    assert!(is_locked_at(&conn, id, SPRING_FORWARD_STILL_LOCKED));
    assert!(!is_locked_at(&conn, id, SPRING_FORWARD_EXPIRED));
}

#[test]
fn failure_window_resets_after_five_real_minutes_across_fall_back() {
    let conn = migrated();
    let id = add_user(&conn);
    fail_times(&conn, id, 3, FALL_BACK_LOCKED_AT);

    let next = record_persisted_failure_at(&conn, id, FALL_BACK_WINDOW_EXPIRED).unwrap();

    assert_eq!(next.failures, 1);
}

#[test]
fn failure_window_does_not_reset_early_across_spring_forward() {
    let conn = migrated();
    let id = add_user(&conn);
    fail_times(&conn, id, 3, SPRING_FORWARD_LOCKED_AT);

    let next = record_persisted_failure_at(&conn, id, SPRING_FORWARD_WINDOW_OPEN).unwrap();

    assert_eq!(next.failures, 4);
}

#[test]
fn lockout_boundary_is_exactly_five_minutes_in_plain_time() {
    let conn = migrated();
    let id = add_user(&conn);

    fail_times(&conn, id, FAILURE_LIMIT, PLAIN_LOCKED_AT);

    assert!(is_locked_at(&conn, id, PLAIN_LAST_LOCKED_SECOND));
    assert!(!is_locked_at(&conn, id, PLAIN_FIRST_FREE_SECOND));
}

#[test]
fn lockout_is_released_at_the_exact_expiry_instant() {
    let conn = migrated();
    let id = add_user(&conn);
    fail_times(&conn, id, FAILURE_LIMIT, PLAIN_LOCKED_AT);

    let by_id = find_credentials_by_id_at(&conn, id, PLAIN_EXPIRY_INSTANT).unwrap();
    let by_username = find_credentials_by_username_at(&conn, "ana", PLAIN_EXPIRY_INSTANT).unwrap();

    assert!(!by_id.unwrap().is_locked_out);
    assert!(!by_username.unwrap().is_locked_out);
}

#[test]
fn lockout_by_username_holds_before_expiry() {
    let conn = migrated();
    let id = add_user(&conn);
    fail_times(&conn, id, FAILURE_LIMIT, PLAIN_LOCKED_AT);

    let by_username = find_credentials_by_username_at(&conn, "ana", PLAIN_LAST_LOCKED_SECOND);

    assert!(by_username.unwrap().unwrap().is_locked_out);
}

#[test]
fn failure_window_boundary_is_exactly_five_minutes_in_plain_time() {
    let conn = migrated();
    let id = add_user(&conn);
    fail_times(&conn, id, 2, PLAIN_LOCKED_AT);
    let fresh = record_persisted_failure_at(&conn, id, PLAIN_LAST_LOCKED_SECOND).unwrap();
    let conn_two = migrated();
    let id_two = add_user(&conn_two);
    fail_times(&conn_two, id_two, 2, PLAIN_LOCKED_AT);
    let stale = record_persisted_failure_at(&conn_two, id_two, PLAIN_EXPIRY_INSTANT).unwrap();

    assert_eq!(fresh.failures, 3);
    assert_eq!(stale.failures, 1);
}

#[test]
fn failure_recorded_at_the_exact_expiry_instant_starts_a_fresh_window() {
    let conn = migrated();
    let id = add_user(&conn);
    fail_times(&conn, id, FAILURE_LIMIT, PLAIN_LOCKED_AT);

    let next = record_persisted_failure_at(&conn, id, PLAIN_EXPIRY_INSTANT).unwrap();

    assert_eq!(next.failures, 1);
}

#[test]
fn invalid_now_fails_closed_instead_of_unlocking_the_account() {
    let conn = migrated();
    let id = add_user(&conn);
    fail_times(&conn, id, FAILURE_LIMIT, PLAIN_LOCKED_AT);

    assert!(matches!(
        find_credentials_by_username_at(&conn, "ana", "basura"),
        Err(DbError::InvalidInstant)
    ));
    assert!(matches!(
        find_credentials_by_id_at(&conn, id, "basura"),
        Err(DbError::InvalidInstant)
    ));
    assert!(matches!(
        record_persisted_failure_at(&conn, id, "basura"),
        Err(DbError::InvalidInstant)
    ));
    assert!(is_locked_at(&conn, id, PLAIN_LAST_LOCKED_SECOND));
}
