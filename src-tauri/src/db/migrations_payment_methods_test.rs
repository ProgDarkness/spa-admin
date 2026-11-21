use rusqlite::Connection;

use super::tests::{
    is_constraint_violation, is_minute_precision_local_timestamp, migrated, table_exists,
};
use crate::features::named_records::name_key;

fn insert_method(conn: &Connection, name: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO payment_methods (name, name_key) VALUES (?1, ?2)",
        rusqlite::params![name, name.to_lowercase()],
    )
}

fn insert_method_with_key(
    conn: &Connection,
    name: &str,
    name_key: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO payment_methods (name, name_key) VALUES (?1, ?2)",
        rusqlite::params![name, name_key],
    )
}

type SeededMethod = (i64, String, String, i64, Option<i64>, Option<i64>);

fn seeded_methods(conn: &Connection) -> Vec<SeededMethod> {
    let mut statement = conn
        .prepare(
            "SELECT id, name, name_key, active, created_by, updated_by \
             FROM payment_methods ORDER BY id",
        )
        .unwrap();
    statement
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap()
}

#[test]
fn payment_methods_table_exists_after_migrating() {
    assert!(table_exists(&migrated(), "payment_methods"));
}

#[test]
fn migrations_seed_exactly_the_five_active_methods_of_the_mock() {
    let seeded = seeded_methods(&migrated());

    let expected: Vec<SeededMethod> = [
        (1, "Efectivo", "efectivo"),
        (2, "Pago móvil", "pago móvil"),
        (3, "Zelle", "zelle"),
        (4, "Transferencia", "transferencia"),
        (5, "Punto de venta", "punto de venta"),
    ]
    .into_iter()
    .map(|(id, name, key)| (id, name.into(), key.into(), 1, None, None))
    .collect();
    assert_eq!(seeded, expected);
}

#[test]
fn seeded_name_keys_match_the_ones_rust_computes() {
    for (_, name, key, ..) in seeded_methods(&migrated()) {
        assert_eq!(key, name_key(&name), "{name}");
    }
}

#[test]
fn payment_methods_defaults_are_active_with_minute_precision_timestamps() {
    let conn = migrated();
    insert_method(&conn, "Cripto").unwrap();

    let (active, created, updated): (i64, String, String) = conn
        .query_row(
            "SELECT active, created_at, updated_at FROM payment_methods WHERE name = 'Cripto'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();

    assert_eq!(active, 1);
    assert!(is_minute_precision_local_timestamp(&created), "{created}");
    assert!(is_minute_precision_local_timestamp(&updated), "{updated}");
}

#[test]
fn seeded_payment_methods_have_minute_precision_timestamps() {
    let conn = migrated();

    let stamps: Vec<(String, String)> = conn
        .prepare("SELECT created_at, updated_at FROM payment_methods")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();

    assert_eq!(stamps.len(), 5);
    for (created, updated) in stamps {
        assert!(is_minute_precision_local_timestamp(&created), "{created}");
        assert!(is_minute_precision_local_timestamp(&updated), "{updated}");
    }
}

#[test]
fn payment_methods_reject_an_invalid_active_flag() {
    let conn = migrated();

    let bad_flag = conn.execute(
        "INSERT INTO payment_methods (name, name_key, active) VALUES ('Y', 'y', 2)",
        [],
    );
    let good_flag = conn.execute(
        "INSERT INTO payment_methods (name, name_key, active) VALUES ('Z', 'z', 0)",
        [],
    );

    assert!(is_constraint_violation(bad_flag));
    assert!(good_flag.is_ok());
}

#[test]
fn payment_method_name_keys_are_unique() {
    let conn = migrated();
    insert_method_with_key(&conn, "Cripto", "cripto").unwrap();

    let same_key_other_name = insert_method_with_key(&conn, "CRIPTO", "cripto");
    let colliding_with_the_seed = insert_method_with_key(&conn, "ZELLE", "zelle");
    let other_key = insert_method_with_key(&conn, "Cheque", "cheque");

    assert!(is_constraint_violation(same_key_other_name));
    assert!(is_constraint_violation(colliding_with_the_seed));
    assert!(other_key.is_ok());
}

#[test]
fn payment_method_name_and_key_are_required() {
    let conn = migrated();

    let without_key = conn.execute("INSERT INTO payment_methods (name) VALUES ('Cheque')", []);
    let without_name = conn.execute(
        "INSERT INTO payment_methods (name_key) VALUES ('cheque')",
        [],
    );

    assert!(is_constraint_violation(without_key));
    assert!(is_constraint_violation(without_name));
}

#[test]
fn payment_methods_keep_the_foreign_keys_to_users() {
    let conn = migrated();

    let orphan_creator = conn.execute(
        "INSERT INTO payment_methods (name, name_key, created_by) VALUES ('Z', 'z', 999)",
        [],
    );
    let orphan_updater = conn.execute(
        "INSERT INTO payment_methods (name, name_key, updated_by) VALUES ('W', 'w', 999)",
        [],
    );

    assert!(is_constraint_violation(orphan_creator));
    assert!(is_constraint_violation(orphan_updater));
}

#[test]
fn payment_method_ids_are_never_reused_after_the_highest_row_is_removed() {
    let conn = migrated();
    insert_method(&conn, "Cripto").unwrap();
    let first: i64 = conn.last_insert_rowid();
    conn.execute("DELETE FROM payment_methods WHERE id = ?1", [first])
        .unwrap();

    insert_method(&conn, "Cheque").unwrap();

    assert!(conn.last_insert_rowid() > first);
}
