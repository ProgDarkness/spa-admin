use rusqlite::{Connection, ErrorCode};

use super::tests::{count, insert_user, migrated, table_exists};
use super::*;

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
