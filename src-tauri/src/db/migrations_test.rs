use std::collections::BTreeSet;

use rusqlite::{Connection, ErrorCode};

use super::*;

const PERMISSION_KEYS: [&str; 15] = [
    "clients.read",
    "clients.write",
    "catalog.read",
    "catalog.write",
    "resources.manage",
    "appointments.read",
    "appointments.write",
    "appointments.reopen",
    "payments.read",
    "payments.write",
    "rates.manage",
    "metrics.read",
    "audit.read",
    "users.manage",
    "backup.manage",
];

const RECEPTION_PERMISSIONS: [&str; 8] = [
    "clients.read",
    "clients.write",
    "catalog.read",
    "appointments.read",
    "appointments.write",
    "payments.read",
    "payments.write",
    "rates.manage",
];

const READ_ONLY_PERMISSIONS: [&str; 4] = [
    "clients.read",
    "catalog.read",
    "appointments.read",
    "payments.read",
];

pub(super) fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn text_set(conn: &Connection, sql: &str, params: &[&dyn rusqlite::ToSql]) -> BTreeSet<String> {
    let mut statement = conn.prepare(sql).unwrap();
    statement
        .query_map(params, |row| row.get::<_, String>(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn expected(keys: &[&str]) -> BTreeSet<String> {
    keys.iter().map(|key| key.to_string()).collect()
}

fn permissions_of(conn: &Connection, role_id: i64) -> BTreeSet<String> {
    text_set(
        conn,
        "SELECT permission_key FROM role_permissions WHERE role_id = ?1",
        &[&role_id],
    )
}

pub(super) fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap()
}

#[test]
fn migration_versions_are_contiguous_from_one() {
    let versions: Vec<u32> = MIGRATIONS.iter().map(|(version, _)| *version).collect();
    let expected: Vec<u32> = (1..=MIGRATIONS.len() as u32).collect();
    assert_eq!(versions, expected);
}

#[test]
fn every_migration_has_sql() {
    assert!(MIGRATIONS.iter().all(|(_, sql)| !sql.trim().is_empty()));
}

#[test]
fn failing_statement_rolls_back_the_whole_migration() {
    let mut conn = Connection::open_in_memory().unwrap();
    let broken = [(1, "CREATE TABLE a (x); INSERT INTO missing VALUES (1);")];
    assert!(apply(&mut conn, &broken).is_err());
    assert_eq!((user_version(&conn), table_exists(&conn, "a")), (0, false));
}

#[test]
fn apply_stops_at_the_first_failing_migration_keeping_earlier_ones() {
    let mut conn = Connection::open_in_memory().unwrap();
    let steps = [
        (1, "CREATE TABLE a (x);"),
        (2, "CREATE TABLE b (x); BOGUS;"),
        (3, "CREATE TABLE c (x);"),
    ];
    assert!(apply(&mut conn, &steps).is_err());
    assert_eq!(
        (
            user_version(&conn),
            table_exists(&conn, "a"),
            table_exists(&conn, "b"),
            table_exists(&conn, "c")
        ),
        (1, true, false, false)
    );
}

#[test]
fn apply_skips_already_applied_versions() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA user_version = 1;").unwrap();
    let steps = [(1, "CREATE TABLE a (x);"), (2, "CREATE TABLE b (x);")];
    apply(&mut conn, &steps).unwrap();
    assert_eq!(
        (
            user_version(&conn),
            table_exists(&conn, "a"),
            table_exists(&conn, "b")
        ),
        (2, false, true)
    );
}

#[test]
fn negative_user_version_fails_closed() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA user_version = -1;").unwrap();
    assert!(migrate(&mut conn).is_err());
    assert_eq!(user_version(&conn), -1);
}

#[test]
fn seeds_fifteen_permissions_matching_the_frontend_list() {
    let conn = migrated();
    let stored = text_set(&conn, "SELECT key FROM permissions", &[]);
    assert_eq!(stored, expected(&PERMISSION_KEYS));
}

#[test]
fn seeds_three_roles_with_expected_permissions() {
    let conn = migrated();
    let names = text_set(&conn, "SELECT name FROM roles", &[]);
    assert_eq!(
        names,
        expected(&["Propietaria", "Recepción", "Solo lectura"])
    );
    assert_eq!(permissions_of(&conn, 1), expected(&PERMISSION_KEYS));
    assert_eq!(permissions_of(&conn, 2), expected(&RECEPTION_PERMISSIONS));
    assert_eq!(permissions_of(&conn, 3), expected(&READ_ONLY_PERMISSIONS));
}

#[test]
fn role_ids_match_their_names() {
    let conn = migrated();
    let names: Vec<String> = (1..=3)
        .map(|id| {
            conn.query_row("SELECT name FROM roles WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .unwrap()
        })
        .collect();
    assert_eq!(names, ["Propietaria", "Recepción", "Solo lectura"]);
}

#[test]
fn migration_is_idempotent() {
    let mut conn = migrated();
    migrate(&mut conn).unwrap();
    assert_eq!(
        (count(&conn, "permissions"), count(&conn, "roles")),
        (15, 3)
    );
}

pub(super) fn insert_user(
    conn: &Connection,
    username: &str,
    role_id: i64,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO users (username, password_hash, role_id) VALUES (?1, 'h', ?2)",
        rusqlite::params![username, role_id],
    )
}

#[test]
fn users_table_enforces_unique_username_and_fk() {
    let conn = migrated();
    insert_user(&conn, "ana", 1).unwrap();
    let duplicate = insert_user(&conn, "ana", 1).unwrap_err();
    let orphan = insert_user(&conn, "luis", 999).unwrap_err();
    assert_eq!(
        duplicate.sqlite_error_code(),
        Some(ErrorCode::ConstraintViolation)
    );
    assert_eq!(
        orphan.sqlite_error_code(),
        Some(ErrorCode::ConstraintViolation)
    );
}

pub(super) fn is_minute_precision_local_timestamp(value: &str) -> bool {
    const SHAPE: &str = "dddd-dd-ddTdd:dd";
    value.len() == SHAPE.len()
        && value.chars().zip(SHAPE.chars()).all(|(actual, expected)| {
            if expected == 'd' {
                actual.is_ascii_digit()
            } else {
                actual == expected
            }
        })
}

#[test]
fn users_defaults_are_active_with_minute_precision_timestamps() {
    let conn = migrated();
    insert_user(&conn, "ana", 1).unwrap();
    let (active, created, updated): (i64, String, String) = conn
        .query_row(
            "SELECT active, created_at, updated_at FROM users",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(active, 1);
    assert!(
        is_minute_precision_local_timestamp(&created),
        "created_at: {created}"
    );
    assert!(
        is_minute_precision_local_timestamp(&updated),
        "updated_at: {updated}"
    );
}

#[test]
fn usernames_are_unique_ignoring_case() {
    let conn = migrated();
    insert_user(&conn, "Ana", 1).unwrap();
    let duplicate = insert_user(&conn, "aNA", 1).unwrap_err();
    assert_eq!(
        duplicate.sqlite_error_code(),
        Some(ErrorCode::ConstraintViolation)
    );
}

const FIRST_MIGRATION_SQL: &str = include_str!("migrations/0001_auth.sql");

fn user_version(conn: &Connection) -> i64 {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap()
}

pub(super) fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE name = ?1",
        [name],
        |row| row.get::<_, i64>(0),
    )
    .unwrap()
        == 1
}

#[test]
fn user_version_equals_number_of_applied_migrations() {
    let conn = migrated();
    assert_eq!(user_version(&conn), 7);
}

#[test]
fn fresh_database_starts_at_user_version_zero() {
    let conn = Connection::open_in_memory().unwrap();
    assert_eq!(user_version(&conn), 0);
}

#[test]
fn reopening_a_persisted_database_does_not_reapply_migrations() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db.sqlite");
    {
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn).unwrap();
        insert_user(&conn, "ana", 1).unwrap();
    }
    let mut reopened = Connection::open(&path).unwrap();
    migrate(&mut reopened).unwrap();
    assert_eq!((user_version(&reopened), count(&reopened, "users")), (7, 1));
}

#[test]
fn upgrades_a_database_left_at_version_one() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(FIRST_MIGRATION_SQL).unwrap();
    conn.execute_batch("PRAGMA user_version = 1;").unwrap();
    migrate(&mut conn).unwrap();
    insert_user(&conn, "Ana", 1).unwrap();
    let duplicate = insert_user(&conn, "ANA", 1).unwrap_err();
    assert_eq!(
        (user_version(&conn), duplicate.sqlite_error_code()),
        (7, Some(ErrorCode::ConstraintViolation))
    );
}

#[test]
fn failing_first_migration_rolls_back_and_keeps_user_version_zero() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE users (id INTEGER);")
        .unwrap();
    assert!(migrate(&mut conn).is_err());
    assert_eq!(
        (
            user_version(&conn),
            table_exists(&conn, "roles"),
            table_exists(&conn, "permissions")
        ),
        (0, false, false)
    );
}

#[test]
fn failing_second_migration_keeps_first_applied_and_user_version_one() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(FIRST_MIGRATION_SQL).unwrap();
    conn.execute_batch("PRAGMA user_version = 1;").unwrap();
    conn.execute_batch("CREATE INDEX users_username_nocase ON users (username);")
        .unwrap();
    assert!(migrate(&mut conn).is_err());
    assert_eq!(user_version(&conn), 1);
}

#[test]
fn database_newer_than_binary_fails_closed_without_changes() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA user_version = 99;").unwrap();
    assert!(migrate(&mut conn).is_err());
    assert_eq!(
        (user_version(&conn), table_exists(&conn, "roles")),
        (99, false)
    );
}

#[test]
fn newer_schema_is_reported_with_found_and_supported_versions() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA user_version = 99;").unwrap();
    let failure = migrate(&mut conn).unwrap_err();
    assert!(matches!(
        failure,
        DbError::SchemaNewerThanApp {
            found: 99,
            supported: 7
        }
    ));
}

#[test]
fn audit_log_table_exists_after_migrating() {
    let conn = migrated();
    assert!(table_exists(&conn, "audit_log"));
}

#[test]
fn login_throttle_table_exists_after_migrating() {
    let conn = migrated();
    assert!(table_exists(&conn, "login_throttle"));
}

pub(super) fn is_constraint_violation(outcome: rusqlite::Result<usize>) -> bool {
    outcome.is_err_and(|error| error.sqlite_error_code() == Some(ErrorCode::ConstraintViolation))
}
