use rusqlite::Connection;

use super::*;

fn conn() -> Connection {
    Connection::open_in_memory().unwrap()
}

#[test]
fn accepts_an_existing_local_minute() {
    let conn = conn();

    for valid in ["2026-11-12T10:00", "2028-02-29T23:59", "2026-12-31T00:00"] {
        assert!(require_valid_local_minute(&conn, valid).is_ok(), "{valid}");
    }
}

#[test]
fn rejects_anything_that_is_not_exactly_a_minute_precision_local_time() {
    let conn = conn();

    for invalid in [
        "",
        "2026-11-12",
        "2026-11-12 10:00",
        "2026-11-12T10:00:00",
        "2026-11-12T10:00Z",
        "2026-11-12T25:00",
        "2026-02-30T10:00",
        "now",
        "2026-11-12T10:00; DROP TABLE users",
    ] {
        assert!(
            matches!(
                require_valid_local_minute(&conn, invalid),
                Err(DbError::InvalidLocalMinute)
            ),
            "{invalid:?}"
        );
    }
}
