use rusqlite::Connection;

use super::*;
use crate::db::migrate;

const RECEPTION_ROLE_ID: i64 = 2;
const LOCKOUT_SECONDS: i64 = 300;
const FAILURE_LIMIT: u32 = MAX_PERSISTED_FAILURES;
const SECONDS_PER_MINUTE: i64 = 60;

const SET_ROW_SQL: &str = "INSERT OR REPLACE INTO login_throttle \
     (user_id, failures, last_failure_at_utc, locked_until_utc) VALUES (?1, ?2, \
     strftime('%Y-%m-%dT%H:%M:%fZ','now', printf('%+d seconds', ?3)), \
     CASE WHEN ?4 IS NULL THEN NULL ELSE \
     strftime('%Y-%m-%dT%H:%M:%fZ','now', printf('%+d seconds', ?4)) END)";

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn add_user(conn: &Connection, username: &str) -> i64 {
    let user = NewUser {
        username: username.to_string(),
        password_hash: format!("hash-de-{username}"),
        role_id: RECEPTION_ROLE_ID,
    };
    insert_user(conn, &user).unwrap()
}

fn set_row(
    conn: &Connection,
    user_id: i64,
    failures: u32,
    last_failure_age: i64,
    locked_offset: Option<i64>,
) -> rusqlite::Result<usize> {
    conn.execute(
        SET_ROW_SQL,
        rusqlite::params![user_id, failures, -last_failure_age, locked_offset],
    )
}

fn row_of(conn: &Connection, user_id: i64) -> Option<(u32, Option<String>)> {
    conn.query_row(
        "SELECT failures, locked_until_utc FROM login_throttle WHERE user_id = ?1",
        [user_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .unwrap()
}

fn is_locked_out_of(conn: &Connection, user_id: i64) -> bool {
    find_credentials_by_id(conn, user_id)
        .unwrap()
        .unwrap()
        .is_locked_out
}

fn fail_times(conn: &Connection, user_id: i64, times: u32) -> PersistedFailure {
    (0..times)
        .map(|_| record_persisted_failure(conn, user_id).unwrap())
        .last()
        .unwrap()
}

#[test]
fn first_failure_creates_a_row_with_one_failure() {
    let conn = migrated();
    let id = add_user(&conn, "ana");

    let outcome = record_persisted_failure(&conn, id).unwrap();

    assert_eq!(
        outcome,
        PersistedFailure {
            failures: 1,
            locked_now: false
        }
    );
    assert_eq!(row_of(&conn, id), Some((1, None)));
}

#[test]
fn fifth_failure_sets_locked_until() {
    let conn = migrated();
    let id = add_user(&conn, "ana");

    let before_limit = fail_times(&conn, id, FAILURE_LIMIT - 1);
    assert!(!before_limit.locked_now);
    assert!(row_of(&conn, id).unwrap().1.is_none());
    assert!(!is_locked_out_of(&conn, id));

    let at_limit = record_persisted_failure(&conn, id).unwrap();

    assert_eq!(
        at_limit,
        PersistedFailure {
            failures: FAILURE_LIMIT,
            locked_now: true
        }
    );
    let (_, locked_until) = row_of(&conn, id).unwrap();
    assert_eq!(locked_until.unwrap().len(), 24);
    assert!(is_locked_out_of(&conn, id));
    let remaining: i64 = conn
        .query_row(
            "SELECT CAST(strftime('%s', locked_until_utc) AS INTEGER) \
             - CAST(strftime('%s', 'now') AS INTEGER) \
             FROM login_throttle WHERE user_id = ?1",
            [id],
            |row| row.get(0),
        )
        .unwrap();
    assert!(
        (LOCKOUT_SECONDS - 2..=LOCKOUT_SECONDS).contains(&remaining),
        "{remaining}"
    );
}

#[test]
fn failure_while_locked_changes_nothing_and_reports_no_transition() {
    let conn = migrated();
    let id = add_user(&conn, "ana");
    fail_times(&conn, id, FAILURE_LIMIT);
    let locked_row = row_of(&conn, id);

    let outcome = record_persisted_failure(&conn, id).unwrap();

    assert_eq!(
        outcome,
        PersistedFailure {
            failures: FAILURE_LIMIT,
            locked_now: false
        }
    );
    assert_eq!(row_of(&conn, id), locked_row);
}

#[test]
fn failures_reset_when_row_is_stale() {
    let conn = migrated();
    let id = add_user(&conn, "ana");
    set_row(&conn, id, 4, LOCKOUT_SECONDS + SECONDS_PER_MINUTE, None).unwrap();

    let outcome = record_persisted_failure(&conn, id).unwrap();

    assert_eq!(
        outcome,
        PersistedFailure {
            failures: 1,
            locked_now: false
        }
    );
    assert_eq!(row_of(&conn, id), Some((1, None)));
}

#[test]
fn recent_failures_keep_accumulating() {
    let conn = migrated();
    let id = add_user(&conn, "ana");
    set_row(&conn, id, 3, SECONDS_PER_MINUTE, None).unwrap();

    let outcome = record_persisted_failure(&conn, id).unwrap();

    assert_eq!(outcome.failures, 4);
}

#[test]
fn lockout_expires_after_300s() {
    let conn = migrated();
    let id = add_user(&conn, "ana");
    set_row(
        &conn,
        id,
        FAILURE_LIMIT,
        LOCKOUT_SECONDS + 1,
        Some(-SECONDS_PER_MINUTE),
    )
    .unwrap();
    assert!(!is_locked_out_of(&conn, id));

    let outcome = record_persisted_failure(&conn, id).unwrap();

    assert_eq!(
        outcome,
        PersistedFailure {
            failures: 1,
            locked_now: false
        }
    );
    assert_eq!(row_of(&conn, id), Some((1, None)));
}

#[test]
fn unexpired_lockout_reports_locked_out() {
    let conn = migrated();
    let id = add_user(&conn, "ana");
    set_row(&conn, id, FAILURE_LIMIT, 10, Some(SECONDS_PER_MINUTE)).unwrap();

    assert!(is_locked_out_of(&conn, id));
}

#[test]
fn clear_removes_the_row_and_the_lock() {
    let conn = migrated();
    let id = add_user(&conn, "ana");
    fail_times(&conn, id, FAILURE_LIMIT);

    clear_persisted_failures(&conn, id).unwrap();

    assert_eq!(row_of(&conn, id), None);
    assert!(!is_locked_out_of(&conn, id));
}

#[test]
fn clear_without_a_row_is_a_no_op() {
    let conn = migrated();
    let id = add_user(&conn, "ana");

    clear_persisted_failures(&conn, id).unwrap();

    assert_eq!(row_of(&conn, id), None);
}

#[test]
fn counters_are_independent_per_user() {
    let conn = migrated();
    let ana = add_user(&conn, "ana");
    let beto = add_user(&conn, "beto");

    fail_times(&conn, ana, FAILURE_LIMIT);

    assert!(is_locked_out_of(&conn, ana));
    assert!(!is_locked_out_of(&conn, beto));
}

#[test]
fn check_constraint_rejects_inconsistent_row() {
    let conn = migrated();
    let id = add_user(&conn, "ana");

    let limit_without_lock = set_row(&conn, id, FAILURE_LIMIT, 0, None);
    let lock_below_limit = set_row(&conn, id, 2, 0, Some(SECONDS_PER_MINUTE));
    let lock_just_below_limit = set_row(&conn, id, FAILURE_LIMIT - 1, 0, Some(SECONDS_PER_MINUTE));
    let zero_failures = set_row(&conn, id, 0, 0, None);
    let over_limit = set_row(&conn, id, FAILURE_LIMIT + 1, 0, Some(SECONDS_PER_MINUTE));

    assert!(limit_without_lock.is_err());
    assert!(lock_below_limit.is_err());
    assert!(lock_just_below_limit.is_err());
    assert!(zero_failures.is_err());
    assert!(over_limit.is_err());
    assert_eq!(row_of(&conn, id), None);
    set_row(&conn, id, FAILURE_LIMIT, 0, Some(SECONDS_PER_MINUTE)).unwrap();
    assert_eq!(
        row_of(&conn, id).map(|(failures, _)| failures),
        Some(FAILURE_LIMIT)
    );
}

#[test]
fn check_constraint_rejects_badly_formatted_timestamps() {
    let conn = migrated();
    let id = add_user(&conn, "ana");

    let short_last_failure = conn.execute(
        "INSERT INTO login_throttle (user_id, failures, last_failure_at_utc) VALUES (?1, 1, '2026-01-01T10:00')",
        [id],
    );
    let short_lock = conn.execute(
        "INSERT INTO login_throttle (user_id, failures, last_failure_at_utc, locked_until_utc) \
         VALUES (?1, 5, '2026-01-01T10:00:00.000Z', '2026-01-01T10:05')",
        [id],
    );

    assert!(short_last_failure.is_err());
    assert!(short_lock.is_err());
}

#[test]
fn throttle_row_requires_an_existing_user() {
    let conn = migrated();

    assert!(record_persisted_failure(&conn, 9999).is_err());
}

#[test]
fn credentials_expose_recovery_code_hash() {
    let conn = migrated();
    let with_code = add_user(&conn, "ana");
    let without_code = add_user(&conn, "beto");
    conn.execute(
        "UPDATE users SET recovery_code_hash = 'hash-recuperacion' WHERE id = ?1",
        [with_code],
    )
    .unwrap();

    let ana = find_credentials_by_username(&conn, "ana").unwrap().unwrap();
    let beto = find_credentials_by_id(&conn, without_code)
        .unwrap()
        .unwrap();

    assert_eq!(ana.recovery_code_hash.as_deref(), Some("hash-recuperacion"));
    assert_eq!(beto.recovery_code_hash, None);
}
