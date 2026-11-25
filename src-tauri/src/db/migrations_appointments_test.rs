use rusqlite::{params, Connection};

use super::tests::{
    count, is_constraint_violation, is_minute_precision_local_timestamp, migrated, table_exists,
};
use super::*;

const LAST_PRE_APPOINTMENTS_VERSION: usize = 10;
const REQUIRED_COLUMNS: [&str; 8] = [
    "client_id",
    "service_id",
    "resource_id",
    "starts_at",
    "ends_at",
    "status",
    "price_cents_snapshot",
    "duration_min_snapshot",
];

fn seed_references(conn: &Connection) {
    conn.execute(
        "INSERT INTO clients (first_name, last_name, national_id, phone, search_key) \
         VALUES ('Ana', 'Perez', 'V-12345678', '0414', 'k')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO services (name, name_key, price_cents, duration_min) \
         VALUES ('Facial', 'facial', 3500, 60)",
        [],
    )
    .unwrap();
}

#[derive(Clone, Copy)]
struct Row<'a> {
    client_id: i64,
    service_id: i64,
    resource_id: i64,
    starts_at: &'a str,
    ends_at: &'a str,
    status: &'a str,
    price: i64,
    duration: i64,
    notes: Option<&'a str>,
}

const VALID: Row<'static> = Row {
    client_id: 1,
    service_id: 1,
    resource_id: 1,
    starts_at: "2026-11-12T10:00",
    ends_at: "2026-11-12T11:00",
    status: "scheduled",
    price: 3500,
    duration: 60,
    notes: None,
};

fn insert(conn: &Connection, row: &Row<'_>) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO appointments (client_id, service_id, resource_id, starts_at, ends_at, \
         status, price_cents_snapshot, duration_min_snapshot, notes) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            row.client_id,
            row.service_id,
            row.resource_id,
            row.starts_at,
            row.ends_at,
            row.status,
            row.price,
            row.duration,
            row.notes
        ],
    )
}

fn prepared() -> Connection {
    let conn = migrated();
    seed_references(&conn);
    conn
}

fn rejected(row: Row<'_>) -> bool {
    is_constraint_violation(insert(&prepared(), &row))
}

fn names_of(conn: &Connection, sql: &str) -> Vec<String> {
    let mut statement = conn.prepare(sql).unwrap();
    statement
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn indexed_columns(conn: &Connection) -> Vec<Vec<String>> {
    let index_names = names_of(
        conn,
        "SELECT name FROM sqlite_master WHERE type = 'index' \
         AND tbl_name = 'appointments' AND name NOT LIKE 'sqlite_%'",
    );
    let mut column_sets: Vec<Vec<String>> = index_names
        .iter()
        .map(|name| {
            names_of(
                conn,
                &format!("SELECT name FROM pragma_index_info('{name}') ORDER BY seqno"),
            )
        })
        .collect();
    column_sets.sort();
    column_sets
}

#[test]
fn appointments_table_exists_and_starts_empty() {
    let conn = migrated();
    assert!(table_exists(&conn, "appointments"));
    assert_eq!(count(&conn, "appointments"), 0);
}

#[test]
fn a_valid_row_is_accepted_with_minute_precision_timestamps() {
    let conn = prepared();
    insert(&conn, &VALID).unwrap();

    let (created, updated): (String, String) = conn
        .query_row(
            "SELECT created_at, updated_at FROM appointments",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert!(is_minute_precision_local_timestamp(&created), "{created}");
    assert!(is_minute_precision_local_timestamp(&updated), "{updated}");
}

#[test]
fn every_status_is_accepted_and_unknown_ones_are_rejected() {
    let conn = prepared();
    for status in [
        "scheduled",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
    ] {
        assert!(insert(&conn, &Row { status, ..VALID }).is_ok(), "{status}");
    }
    for status in ["inProgress", "noShow", "done", "", "SCHEDULED"] {
        assert!(rejected(Row { status, ..VALID }), "{status:?}");
    }
}

#[test]
fn start_must_be_an_existing_local_minute() {
    for bad in [
        "2026-11-12 10:00",
        "2026-11-12T25:00",
        "2026-11-12T10:60",
        "2026-02-30T10:00",
        "2026-13-01T10:00",
        "2026-11-12T10:00:30",
        "2026-11-12",
        "",
        "2026-11-12T10:00Z",
    ] {
        assert!(
            rejected(Row {
                starts_at: bad,
                ..VALID
            }),
            "{bad:?}"
        );
    }
}

#[test]
fn end_must_equal_start_plus_the_frozen_duration() {
    assert!(rejected(Row {
        ends_at: "2026-11-12T11:05",
        ..VALID
    }));
    assert!(rejected(Row {
        duration: 45,
        ..VALID
    }));
    assert!(insert(
        &prepared(),
        &Row {
            ends_at: "2026-11-12T10:45",
            duration: 45,
            ..VALID
        }
    )
    .is_ok());
}

#[test]
fn end_may_cross_into_the_next_day_only_at_exactly_midnight() {
    let conn = prepared();
    let midnight_endings = [
        ("2026-11-12T23:00", "2026-11-13T00:00", 60),
        ("2026-12-31T23:00", "2027-01-01T00:00", 60),
        ("2026-11-13T00:00", "2026-11-14T00:00", 1440),
    ];
    for (starts_at, ends_at, duration) in midnight_endings {
        let row = Row {
            starts_at,
            ends_at,
            duration,
            ..VALID
        };
        assert!(insert(&conn, &row).is_ok(), "{starts_at}");
    }
    assert!(rejected(Row {
        starts_at: "2026-11-12T23:30",
        ends_at: "2026-11-13T00:30",
        ..VALID
    }));
    assert!(rejected(Row {
        starts_at: "2026-11-13T00:05",
        ends_at: "2026-11-14T00:05",
        duration: 1440,
        ..VALID
    }));
}

#[test]
fn duration_snapshot_must_be_between_one_and_a_full_day() {
    for bad in [0, -5, 1441] {
        assert!(
            rejected(Row {
                duration: bad,
                ..VALID
            }),
            "{bad}"
        );
    }
}

#[test]
fn price_snapshot_cannot_be_negative_but_zero_is_allowed() {
    assert!(rejected(Row { price: -1, ..VALID }));
    assert!(insert(&prepared(), &Row { price: 0, ..VALID }).is_ok());
}

#[test]
fn notes_are_limited_to_five_hundred_characters() {
    let at_limit = "n".repeat(500);
    let over_limit = "n".repeat(501);

    assert!(insert(
        &prepared(),
        &Row {
            notes: Some(&at_limit),
            ..VALID
        }
    )
    .is_ok());
    assert!(rejected(Row {
        notes: Some(&over_limit),
        ..VALID
    }));
}

#[test]
fn required_columns_reject_null() {
    for column in REQUIRED_COLUMNS {
        let conn = prepared();
        let values: Vec<String> = REQUIRED_COLUMNS
            .iter()
            .map(|name| {
                if *name == column {
                    "NULL".to_string()
                } else {
                    format!("(SELECT {name} FROM valid_row)")
                }
            })
            .collect();
        conn.execute_batch(
            "CREATE TEMP TABLE valid_row AS SELECT 1 AS client_id, 1 AS service_id, \
             1 AS resource_id, '2026-11-12T10:00' AS starts_at, '2026-11-12T11:00' AS ends_at, \
             'scheduled' AS status, 3500 AS price_cents_snapshot, 60 AS duration_min_snapshot",
        )
        .unwrap();
        let sql = format!(
            "INSERT INTO appointments ({}) VALUES ({})",
            REQUIRED_COLUMNS.join(", "),
            values.join(", ")
        );
        assert!(is_constraint_violation(conn.execute(&sql, [])), "{column}");
    }
}

#[test]
fn foreign_keys_to_clients_services_and_resources_are_enforced() {
    for row in [
        Row {
            client_id: 999,
            ..VALID
        },
        Row {
            service_id: 999,
            ..VALID
        },
        Row {
            resource_id: 999,
            ..VALID
        },
    ] {
        assert!(rejected(row));
    }
}

#[test]
fn foreign_keys_to_users_are_enforced() {
    let conn = prepared();
    for column in ["created_by", "updated_by"] {
        let sql = format!(
            "INSERT INTO appointments (client_id, service_id, resource_id, starts_at, ends_at, \
             status, price_cents_snapshot, duration_min_snapshot, {column}) \
             VALUES (1, 1, 1, '2026-11-12T10:00', '2026-11-12T11:00', 'scheduled', 3500, 60, 999)"
        );
        assert!(is_constraint_violation(conn.execute(&sql, [])), "{column}");
    }
}

#[test]
fn indexes_cover_resource_day_client_day_and_start() {
    let expected: Vec<Vec<String>> = vec![
        vec!["client_id".to_string(), "starts_at".to_string()],
        vec!["resource_id".to_string(), "starts_at".to_string()],
        vec!["starts_at".to_string()],
    ];

    assert_eq!(indexed_columns(&migrated()), expected);
}

#[test]
fn appointment_ids_are_never_reused() {
    let conn = prepared();
    insert(&conn, &VALID).unwrap();
    let first = conn.last_insert_rowid();
    conn.execute("DELETE FROM appointments WHERE id = ?1", [first])
        .unwrap();

    insert(&conn, &VALID).unwrap();

    assert!(conn.last_insert_rowid() > first);
}

#[test]
fn migrating_from_version_ten_keeps_every_existing_row() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    apply(&mut conn, &MIGRATIONS[..LAST_PRE_APPOINTMENTS_VERSION]).unwrap();
    seed_references(&conn);
    conn.execute(
        "INSERT INTO exchange_rates (date, rate_bs_per_usd_e4) VALUES ('2026-11-12', 365000)",
        [],
    )
    .unwrap();
    let tables = [
        "users",
        "clients",
        "services",
        "resources",
        "exchange_rates",
        "audit_log",
    ];
    let before = tables.map(|table| count(&conn, table));

    migrate(&mut conn).unwrap();

    assert_eq!(tables.map(|table| count(&conn, table)), before);
    assert_eq!(count(&conn, "appointments"), 0);
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, i64::from(supported_version()));
    assert!(insert(&conn, &VALID).is_ok());
}
