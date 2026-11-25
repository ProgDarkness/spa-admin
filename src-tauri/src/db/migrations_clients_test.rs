use rusqlite::{params, Connection};

use super::tests::{
    count, is_constraint_violation, is_minute_precision_local_timestamp, migrated, table_exists,
};
use super::*;

const LAST_PRE_CLIENTS_VERSION: usize = 9;
const REQUIRED_COLUMNS: [&str; 5] = [
    "first_name",
    "last_name",
    "national_id",
    "phone",
    "search_key",
];

fn insert_client(conn: &Connection, national_id: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO clients (first_name, last_name, national_id, phone, search_key) \
         VALUES ('Ana', 'Perez', ?1, '04141234567', 'ana perez')",
        [national_id],
    )
}

fn insert_with(conn: &Connection, first_name: &str, phone: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO clients (first_name, last_name, national_id, phone, search_key) \
         VALUES (?1, 'Perez', 'V-12345678', ?2, 'k')",
        params![first_name, phone],
    )
}

fn insert_without(conn: &Connection, column: &str) -> rusqlite::Result<usize> {
    let present: Vec<&str> = REQUIRED_COLUMNS
        .into_iter()
        .filter(|name| *name != column)
        .collect();
    let values = vec!["'V-12345678'"; present.len()].join(", ");
    conn.execute(
        &format!(
            "INSERT INTO clients ({}) VALUES ({values})",
            present.join(", ")
        ),
        [],
    )
}

fn row_counts(conn: &Connection) -> [i64; 4] {
    ["users", "payment_methods", "exchange_rates", "audit_log"].map(|table| count(conn, table))
}

#[test]
fn clients_table_exists_after_migrating() {
    assert!(table_exists(&migrated(), "clients"));
}

#[test]
fn clients_start_empty_and_active_with_minute_precision_timestamps() {
    let conn = migrated();
    assert_eq!(count(&conn, "clients"), 0);
    insert_client(&conn, "V-12345678").unwrap();

    let (deleted_at, created, updated): (Option<String>, String, String) = conn
        .query_row(
            "SELECT deleted_at, created_at, updated_at FROM clients",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();

    assert_eq!(deleted_at, None);
    assert!(is_minute_precision_local_timestamp(&created), "{created}");
    assert!(is_minute_precision_local_timestamp(&updated), "{updated}");
}

#[test]
fn national_id_accepts_the_three_prefixes_and_six_to_nine_digits() {
    let conn = migrated();
    for good in ["V-123456", "E-123456789", "J-1234567", "V-00000000"] {
        assert!(insert_client(&conn, good).is_ok(), "{good}");
    }
}

#[test]
fn national_id_rejects_every_malformed_shape() {
    let conn = migrated();
    for bad in [
        "",
        "V-12345",
        "V-1234567890",
        "G-12345678",
        "v-12345678",
        "V12345678",
        "V-1234567a",
        "V-12 45678",
        "V-12345678\n",
        "-12345678",
        "VV-1234567",
        "V--1234567",
    ] {
        assert!(
            is_constraint_violation(insert_client(&conn, bad)),
            "{bad:?}"
        );
    }
}

#[test]
fn national_id_is_unique_even_for_a_soft_deleted_client() {
    let conn = migrated();
    insert_client(&conn, "V-12345678").unwrap();
    conn.execute(
        "UPDATE clients SET deleted_at = '2026-11-12T10:00' WHERE national_id = 'V-12345678'",
        [],
    )
    .unwrap();

    assert!(is_constraint_violation(insert_client(&conn, "V-12345678")));
    assert!(insert_client(&conn, "V-87654321").is_ok());
}

#[test]
fn required_columns_reject_null() {
    let conn = migrated();

    for column in REQUIRED_COLUMNS {
        assert!(
            is_constraint_violation(insert_without(&conn, column)),
            "{column}"
        );
    }
}

#[test]
fn blank_names_and_phones_are_rejected() {
    let conn = migrated();

    assert!(is_constraint_violation(insert_with(&conn, "", "0414")));
    assert!(is_constraint_violation(insert_with(&conn, "   ", "0414")));
    assert!(is_constraint_violation(insert_with(&conn, "Ana", "")));
    assert!(insert_with(&conn, "Ana", "0414").is_ok());
}

#[test]
fn phone_longer_than_thirty_two_characters_is_rejected() {
    let conn = migrated();

    assert!(is_constraint_violation(insert_with(
        &conn,
        "Ana",
        &"1".repeat(33)
    )));
    assert!(insert_with(&conn, "Ana", &"1".repeat(32)).is_ok());
}

#[test]
fn clients_keep_the_foreign_keys_to_users() {
    let conn = migrated();

    let orphan_creator = conn.execute(
        "INSERT INTO clients (first_name, last_name, national_id, phone, search_key, created_by) \
         VALUES ('A', 'B', 'V-12345678', '0414', 'k', 999)",
        [],
    );
    let orphan_updater = conn.execute(
        "INSERT INTO clients (first_name, last_name, national_id, phone, search_key, updated_by) \
         VALUES ('A', 'B', 'V-12345679', '0414', 'k', 999)",
        [],
    );

    assert!(is_constraint_violation(orphan_creator));
    assert!(is_constraint_violation(orphan_updater));
}

#[test]
fn client_ids_are_never_reused_after_the_highest_row_is_removed() {
    let conn = migrated();
    insert_client(&conn, "V-12345678").unwrap();
    let first = conn.last_insert_rowid();
    conn.execute("DELETE FROM clients WHERE id = ?1", [first])
        .unwrap();

    insert_client(&conn, "V-12345679").unwrap();

    assert!(conn.last_insert_rowid() > first);
}

#[test]
fn migrating_from_version_nine_keeps_every_existing_row() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    apply(&mut conn, &MIGRATIONS[..LAST_PRE_CLIENTS_VERSION]).unwrap();
    conn.execute(
        "INSERT INTO users (username, password_hash, role_id) VALUES ('ana', 'h', 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO exchange_rates (date, rate_bs_per_usd_e4) VALUES ('2026-11-12', 365000)",
        [],
    )
    .unwrap();
    let before = row_counts(&conn);

    migrate(&mut conn).unwrap();

    assert_eq!(row_counts(&conn), before);
    assert_eq!(count(&conn, "clients"), 0);
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, i64::from(supported_version()));
    assert!(insert_client(&conn, "V-12345678").is_ok());
}
