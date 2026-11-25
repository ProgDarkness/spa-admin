use rusqlite::Connection;

use super::tests::{
    is_constraint_violation, is_minute_precision_local_timestamp, migrated, table_exists,
};

fn insert_resource(conn: &Connection, name: &str, kind: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO resources (name, name_key, kind) VALUES (?1, ?2, ?3)",
        rusqlite::params![name, name.to_lowercase(), kind],
    )
}

fn insert_resource_with_key(
    conn: &Connection,
    name: &str,
    name_key: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO resources (name, name_key, kind) VALUES (?1, ?2, 'cabin')",
        rusqlite::params![name, name_key],
    )
}

type SeededResource = (i64, String, String, String, i64, Option<i64>, Option<i64>);

fn seeded_resources(conn: &Connection) -> Vec<SeededResource> {
    let mut statement = conn
        .prepare(
            "SELECT id, name, name_key, kind, active, created_by, updated_by \
             FROM resources ORDER BY id",
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
                row.get(6)?,
            ))
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap()
}

#[test]
fn resources_table_exists_after_migrating() {
    assert!(table_exists(&migrated(), "resources"));
}

#[test]
fn migrations_seed_exactly_the_two_cabins_and_the_inactive_manicure_post() {
    let seeded = seeded_resources(&migrated());

    let expected: Vec<SeededResource> = vec![
        (
            1,
            "Cabina 1".into(),
            "cabina 1".into(),
            "cabin".into(),
            1,
            None,
            None,
        ),
        (
            2,
            "Cabina 2".into(),
            "cabina 2".into(),
            "cabin".into(),
            1,
            None,
            None,
        ),
        (
            3,
            "Manicure (Rosa)".into(),
            "manicure (rosa)".into(),
            "manicure".into(),
            0,
            None,
            None,
        ),
    ];
    assert_eq!(seeded, expected);
}

#[test]
fn resources_defaults_are_active_with_minute_precision_timestamps() {
    let conn = migrated();
    insert_resource(&conn, "Cabina 3", "cabin").unwrap();

    let (active, created, updated): (i64, String, String) = conn
        .query_row(
            "SELECT active, created_at, updated_at FROM resources WHERE name = 'Cabina 3'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();

    assert_eq!(active, 1);
    assert!(is_minute_precision_local_timestamp(&created), "{created}");
    assert!(is_minute_precision_local_timestamp(&updated), "{updated}");
}

#[test]
fn seeded_resources_have_minute_precision_timestamps() {
    let conn = migrated();

    let stamps: Vec<(String, String)> = conn
        .prepare("SELECT created_at, updated_at FROM resources")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();

    assert_eq!(stamps.len(), 3);
    for (created, updated) in stamps {
        assert!(is_minute_precision_local_timestamp(&created), "{created}");
        assert!(is_minute_precision_local_timestamp(&updated), "{updated}");
    }
}

#[test]
fn resources_accept_only_cabin_and_manicure_kinds() {
    let conn = migrated();

    assert!(is_constraint_violation(insert_resource(
        &conn, "A", "sauna"
    )));
    assert!(is_constraint_violation(insert_resource(&conn, "B", "")));
    assert!(is_constraint_violation(insert_resource(
        &conn, "C", "Cabin"
    )));
    assert!(insert_resource(&conn, "D", "cabin").is_ok());
    assert!(insert_resource(&conn, "E", "manicure").is_ok());
}

#[test]
fn resources_reject_an_invalid_active_flag() {
    let conn = migrated();

    let bad_flag = conn.execute(
        "INSERT INTO resources (name, name_key, kind, active) VALUES ('Y', 'y', 'cabin', 2)",
        [],
    );
    let good_flag = conn.execute(
        "INSERT INTO resources (name, name_key, kind, active) VALUES ('Z', 'z', 'cabin', 0)",
        [],
    );

    assert!(is_constraint_violation(bad_flag));
    assert!(good_flag.is_ok());
}

#[test]
fn resource_name_keys_are_unique() {
    let conn = migrated();
    insert_resource_with_key(&conn, "Sala", "sala").unwrap();

    let same_key_other_name = insert_resource_with_key(&conn, "SALA", "sala");
    let colliding_with_the_seed = insert_resource_with_key(&conn, "CABINA 1", "cabina 1");
    let other_key = insert_resource_with_key(&conn, "Patio", "patio");

    assert!(is_constraint_violation(same_key_other_name));
    assert!(is_constraint_violation(colliding_with_the_seed));
    assert!(other_key.is_ok());
}

#[test]
fn resource_name_key_and_kind_are_required() {
    let conn = migrated();

    let without_key = conn.execute(
        "INSERT INTO resources (name, kind) VALUES ('Sala', 'cabin')",
        [],
    );
    let without_kind = conn.execute(
        "INSERT INTO resources (name, name_key) VALUES ('Sala', 'sala')",
        [],
    );
    let without_name = conn.execute(
        "INSERT INTO resources (name_key, kind) VALUES ('sala', 'cabin')",
        [],
    );

    assert!(is_constraint_violation(without_key));
    assert!(is_constraint_violation(without_kind));
    assert!(is_constraint_violation(without_name));
}

#[test]
fn resources_keep_the_foreign_keys_to_users() {
    let conn = migrated();

    let orphan_creator = conn.execute(
        "INSERT INTO resources (name, name_key, kind, created_by) VALUES ('Z', 'z', 'cabin', 999)",
        [],
    );
    let orphan_updater = conn.execute(
        "INSERT INTO resources (name, name_key, kind, updated_by) VALUES ('W', 'w', 'cabin', 999)",
        [],
    );

    assert!(is_constraint_violation(orphan_creator));
    assert!(is_constraint_violation(orphan_updater));
}

#[test]
fn resource_ids_are_never_reused_after_the_highest_row_is_removed() {
    let conn = migrated();
    insert_resource(&conn, "Sala", "cabin").unwrap();
    let first: i64 = conn.last_insert_rowid();
    conn.execute("DELETE FROM resources WHERE id = ?1", [first])
        .unwrap();

    insert_resource(&conn, "Patio", "cabin").unwrap();

    assert!(conn.last_insert_rowid() > first);
}
