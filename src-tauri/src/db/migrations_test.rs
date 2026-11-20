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

fn migrated() -> Connection {
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

fn count(conn: &Connection, table: &str) -> i64 {
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

fn insert_user(conn: &Connection, username: &str, role_id: i64) -> rusqlite::Result<usize> {
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

fn is_minute_precision_local_timestamp(value: &str) -> bool {
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

fn table_exists(conn: &Connection, name: &str) -> bool {
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
    assert_eq!(user_version(&conn), 6);
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
    assert_eq!((user_version(&reopened), count(&reopened, "users")), (6, 1));
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
        (6, Some(ErrorCode::ConstraintViolation))
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
            supported: 6
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

const BUSINESS_ACTIONS: [&str; 8] = [
    "create",
    "update",
    "deactivate",
    "soft_delete",
    "reactivate",
    "void",
    "backup_created",
    "backup_restored",
];

const BUSINESS_ENTITIES: [&str; 7] = [
    "client",
    "service",
    "resource",
    "appointment",
    "payment",
    "payment_method",
    "exchange_rate",
];

fn at_version_four_with_audit_rows() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    apply(&mut conn, &MIGRATIONS[..4]).unwrap();
    insert_user(&conn, "ana", 1).unwrap();
    conn.execute_batch(
        "INSERT INTO audit_log (id, occurred_at, occurred_at_utc, actor_user_id, action, entity, entity_id, diff)
         VALUES (1, '2026-01-02T03:04:05', '2026-01-02T08:04:05.123Z', NULL, 'login_succeeded', 'system', NULL, NULL);
         INSERT INTO audit_log (id, occurred_at, occurred_at_utc, actor_user_id, action, entity, entity_id, diff)
         VALUES (5, '2026-02-03T04:05:06', '2026-02-03T09:05:06.456Z', 1, 'user_created', 'user', 7, '{\"a\":1}');
         INSERT INTO audit_log (id, occurred_at, occurred_at_utc, actor_user_id, action, entity, entity_id, diff)
         VALUES (10, '2026-03-04T05:06:07', '2026-03-04T10:06:07.789Z', NULL, 'clock_rollback', 'system', NULL, NULL);",
    )
    .unwrap();
    conn
}

#[derive(Debug, PartialEq)]
struct StoredAuditRow {
    id: i64,
    actor_user_id: Option<i64>,
    action: String,
    entity: String,
    entity_id: Option<i64>,
    diff: Option<String>,
    occurred_at: String,
    occurred_at_utc: String,
}

fn audit_rows(conn: &Connection) -> Vec<StoredAuditRow> {
    let mut statement = conn
        .prepare(
            "SELECT id, actor_user_id, action, entity, entity_id, diff, occurred_at, occurred_at_utc FROM audit_log ORDER BY id",
        )
        .unwrap();
    statement
        .query_map([], |row| {
            Ok(StoredAuditRow {
                id: row.get(0)?,
                actor_user_id: row.get(1)?,
                action: row.get(2)?,
                entity: row.get(3)?,
                entity_id: row.get(4)?,
                diff: row.get(5)?,
                occurred_at: row.get(6)?,
                occurred_at_utc: row.get(7)?,
            })
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn insert_audit(conn: &Connection, action: &str, entity: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO audit_log (action, entity) VALUES (?1, ?2)",
        [action, entity],
    )
}

#[test]
fn migration_five_preserves_existing_audit_rows_and_ids() {
    let mut conn = at_version_four_with_audit_rows();
    let before = audit_rows(&conn);

    apply(&mut conn, &MIGRATIONS).unwrap();

    assert_eq!(before.len(), 3);
    assert_eq!(
        before.iter().map(|row| row.id).collect::<Vec<_>>(),
        [1, 5, 10]
    );
    assert_eq!(before[1].actor_user_id, Some(1));
    assert_eq!(audit_rows(&conn), before);
}

#[test]
fn migration_five_continues_audit_ids_after_the_preserved_ones() {
    let mut conn = at_version_four_with_audit_rows();
    apply(&mut conn, &MIGRATIONS).unwrap();

    insert_audit(&conn, "create", "client").unwrap();

    let last_id: i64 = conn
        .query_row("SELECT max(id) FROM audit_log", [], |row| row.get(0))
        .unwrap();
    assert_eq!(last_id, 11);
}

#[test]
fn audit_log_stays_append_only_after_migration_five() {
    let conn = migrated();
    insert_audit(&conn, "create", "client").unwrap();

    let update = conn.execute("UPDATE audit_log SET action = 'logout'", []);
    let delete = conn.execute("DELETE FROM audit_log", []);

    for result in [update, delete] {
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("audit_log is append-only"));
    }
}

#[test]
fn migration_five_leaves_no_staging_table_behind() {
    let conn = migrated();
    assert!(!table_exists(&conn, "audit_log_v1"));
}

fn index_columns(conn: &Connection, index: &str) -> Vec<String> {
    let mut statement = conn
        .prepare(&format!("PRAGMA index_info('{index}')"))
        .unwrap();
    statement
        .query_map([], |row| row.get::<_, String>(2))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn index_is_unique(conn: &Connection, table: &str, index: &str) -> bool {
    let mut statement = conn
        .prepare(&format!("PRAGMA index_list('{table}')"))
        .unwrap();
    let flags: Vec<(String, bool)> = statement
        .query_map([], |row| Ok((row.get(1)?, row.get(2)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    flags
        .into_iter()
        .find(|(name, _)| name == index)
        .map(|(_, unique)| unique)
        .expect("index present")
}

#[test]
fn migration_five_recreates_the_occurred_at_utc_index_as_non_unique_on_that_column() {
    let conn = migrated();
    assert_eq!(
        index_columns(&conn, "audit_log_occurred_at_utc"),
        ["occurred_at_utc"]
    );
    assert!(!index_is_unique(
        &conn,
        "audit_log",
        "audit_log_occurred_at_utc"
    ));
}

fn trigger_sql(conn: &Connection, name: &str) -> String {
    conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?1",
        [name],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn migration_five_keeps_the_append_only_triggers_identical_to_migration_three() {
    let mut at_three = Connection::open_in_memory().unwrap();
    apply(&mut at_three, &MIGRATIONS[..3]).unwrap();
    let at_five = migrated();

    for name in ["audit_log_no_update", "audit_log_no_delete"] {
        assert_eq!(trigger_sql(&at_five, name), trigger_sql(&at_three, name));
    }
    assert!(trigger_sql(&at_five, "audit_log_no_update").contains("audit_log is append-only"));
}

#[test]
fn migration_five_keeps_the_audit_row_count() {
    let mut conn = at_version_four_with_audit_rows();
    let before = count(&conn, "audit_log");

    apply(&mut conn, &MIGRATIONS).unwrap();

    assert_eq!((before, count(&conn, "audit_log")), (3, 3));
}

#[test]
fn migration_five_accepts_every_business_action() {
    let conn = migrated();
    for action in BUSINESS_ACTIONS {
        insert_audit(&conn, action, "system").unwrap();
    }
    assert_eq!(count(&conn, "audit_log"), BUSINESS_ACTIONS.len() as i64);
}

#[test]
fn migration_five_accepts_every_business_entity() {
    let conn = migrated();
    for entity in BUSINESS_ENTITIES {
        insert_audit(&conn, "create", entity).unwrap();
    }
    assert_eq!(count(&conn, "audit_log"), BUSINESS_ENTITIES.len() as i64);
}

#[test]
fn migration_five_still_rejects_unknown_action_and_entity() {
    let conn = migrated();
    let unknown_action = insert_audit(&conn, "hack", "system").unwrap_err();
    let unknown_entity = insert_audit(&conn, "create", "invoice").unwrap_err();
    assert_eq!(
        (
            unknown_action.sqlite_error_code(),
            unknown_entity.sqlite_error_code()
        ),
        (
            Some(ErrorCode::ConstraintViolation),
            Some(ErrorCode::ConstraintViolation)
        )
    );
}

#[test]
fn migration_five_keeps_the_foreign_key_to_users() {
    let conn = migrated();
    let orphan = conn.execute(
        "INSERT INTO audit_log (actor_user_id, action, entity) VALUES (999, 'create', 'client')",
        [],
    );
    assert_eq!(
        orphan.unwrap_err().sqlite_error_code(),
        Some(ErrorCode::ConstraintViolation)
    );
}

const VALID_SERVICE: &str = "INSERT INTO services (name, name_key, price_cents, duration_min) \
     VALUES ('Masaje', 'masaje', 3500, 60)";

fn insert_service(
    conn: &Connection,
    name: &str,
    price_cents: i64,
    duration_min: i64,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO services (name, name_key, price_cents, duration_min) \
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![name, name.to_lowercase(), price_cents, duration_min],
    )
}

fn insert_service_with_key(
    conn: &Connection,
    name: &str,
    name_key: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO services (name, name_key, price_cents, duration_min) \
         VALUES (?1, ?2, 100, 30)",
        rusqlite::params![name, name_key],
    )
}

fn is_constraint_violation(outcome: rusqlite::Result<usize>) -> bool {
    outcome.is_err_and(|error| error.sqlite_error_code() == Some(ErrorCode::ConstraintViolation))
}

#[test]
fn services_table_exists_after_migrating() {
    assert!(table_exists(&migrated(), "services"));
}

#[test]
fn migrations_seed_no_services() {
    assert_eq!(count(&migrated(), "services"), 0);
}

#[test]
fn services_defaults_are_active_usd_with_minute_precision_timestamps() {
    let conn = migrated();
    conn.execute(VALID_SERVICE, []).unwrap();

    let (active, currency, created, updated): (i64, String, String, String) = conn
        .query_row(
            "SELECT active, currency, created_at, updated_at FROM services",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();

    assert_eq!((active, currency.as_str()), (1, "USD"));
    assert!(is_minute_precision_local_timestamp(&created), "{created}");
    assert!(is_minute_precision_local_timestamp(&updated), "{updated}");
}

#[test]
fn services_reject_non_positive_prices() {
    let conn = migrated();

    assert!(is_constraint_violation(insert_service(&conn, "A", 0, 30)));
    assert!(is_constraint_violation(insert_service(&conn, "B", -1, 30)));
    assert!(insert_service(&conn, "C", 1, 30).is_ok());
}

#[test]
fn services_reject_invalid_durations() {
    let conn = migrated();

    for (index, minutes) in [0, -5, 7, 1445, 1500].into_iter().enumerate() {
        let name = format!("S{index}");
        assert!(
            is_constraint_violation(insert_service(&conn, &name, 100, minutes)),
            "{minutes}"
        );
    }
    assert!(insert_service(&conn, "min", 100, 5).is_ok());
    assert!(insert_service(&conn, "max", 100, 1440).is_ok());
}

#[test]
fn services_reject_non_usd_currency_and_invalid_active_flag() {
    let conn = migrated();

    let other_currency = conn.execute(
        "INSERT INTO services (name, name_key, price_cents, currency, duration_min) \
         VALUES ('X', 'x', 100, 'VES', 30)",
        [],
    );
    let bad_flag = conn.execute(
        "INSERT INTO services (name, name_key, price_cents, duration_min, active) \
         VALUES ('Y', 'y', 100, 30, 2)",
        [],
    );

    assert!(is_constraint_violation(other_currency));
    assert!(is_constraint_violation(bad_flag));
}

#[test]
fn service_name_keys_are_unique() {
    let conn = migrated();
    insert_service_with_key(&conn, "Masaje", "masaje").unwrap();

    let same_key_other_name = insert_service_with_key(&conn, "MASAJE", "masaje");
    let other_key = insert_service_with_key(&conn, "Facial", "facial");

    assert!(is_constraint_violation(same_key_other_name));
    assert!(other_key.is_ok());
}

#[test]
fn service_name_key_is_required() {
    let conn = migrated();

    let missing = conn.execute(
        "INSERT INTO services (name, price_cents, duration_min) VALUES ('Masaje', 100, 30)",
        [],
    );

    assert!(is_constraint_violation(missing));
}

#[test]
fn services_price_is_bounded_between_one_cent_and_the_maximum() {
    let conn = migrated();

    for (index, price) in [0_i64, -1, 100_000_000_001, i64::MAX]
        .into_iter()
        .enumerate()
    {
        let name = format!("S{index}");
        assert!(
            is_constraint_violation(insert_service(&conn, &name, price, 30)),
            "{price}"
        );
    }
    assert!(insert_service(&conn, "min", 1, 30).is_ok());
    assert!(insert_service(&conn, "max", 100_000_000_000, 30).is_ok());
}

#[test]
fn services_keep_the_foreign_keys_to_users() {
    let conn = migrated();

    let orphan = conn.execute(
        "INSERT INTO services (name, name_key, price_cents, duration_min, created_by) \
         VALUES ('Z', 'z', 100, 30, 999)",
        [],
    );

    assert!(is_constraint_violation(orphan));
}
