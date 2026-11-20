use rusqlite::Connection;

use super::migrate;

const VALID_INSTANT: &str = "2026-07-01T12:00:00.000Z";
const WRONG_FORMAT_SAME_LENGTH: [&str; 4] = [
    "XXXXXXXXXXXXXXXXXXXXXXXX",
    "2026-07-01 12:00:00.000Z",
    "2026-07-01T12:00:00.000Q",
    "2026-07-01T12:00:00,000Z",
];

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn.execute(
        "INSERT INTO users (id, username, password_hash, role_id) VALUES (50, 'ana', 'h', 2)",
        [],
    )
    .unwrap();
    conn
}

fn insert_audit(conn: &Connection, utc: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO audit_log (occurred_at_utc, action, entity) VALUES (?1, 'logout', 'system')",
        [utc],
    )
}

fn insert_throttle(
    conn: &Connection,
    failures: i64,
    last_failure: &str,
    locked_until: Option<&str>,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO login_throttle (user_id, failures, last_failure_at_utc, locked_until_utc) \
         VALUES (50, ?1, ?2, ?3)",
        rusqlite::params![failures, last_failure, locked_until],
    )
}

#[test]
fn audit_log_rejects_24_char_values_with_wrong_format() {
    let conn = migrated();

    for bad in WRONG_FORMAT_SAME_LENGTH {
        assert_eq!(bad.len(), 24);
        assert!(insert_audit(&conn, bad).is_err(), "{bad}");
    }
    assert_eq!(insert_audit(&conn, VALID_INSTANT).unwrap(), 1);
}

#[test]
fn throttle_last_failure_rejects_24_char_values_with_wrong_format() {
    let conn = migrated();

    for bad in WRONG_FORMAT_SAME_LENGTH {
        assert!(insert_throttle(&conn, 1, bad, None).is_err(), "{bad}");
    }
    assert_eq!(insert_throttle(&conn, 1, VALID_INSTANT, None).unwrap(), 1);
}

#[test]
fn throttle_locked_until_rejects_wrong_format_but_allows_null() {
    let conn = migrated();

    for bad in WRONG_FORMAT_SAME_LENGTH {
        assert!(
            insert_throttle(&conn, 5, VALID_INSTANT, Some(bad)).is_err(),
            "{bad}"
        );
    }
    assert_eq!(
        insert_throttle(&conn, 5, VALID_INSTANT, Some(VALID_INSTANT)).unwrap(),
        1
    );
    conn.execute("DELETE FROM login_throttle", []).unwrap();
    assert_eq!(insert_throttle(&conn, 1, VALID_INSTANT, None).unwrap(), 1);
}
