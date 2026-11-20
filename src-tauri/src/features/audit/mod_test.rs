use rusqlite::Connection;

use super::*;
use crate::db::{migrate, Database, DbError};

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn entry() -> NewAuditEntry {
    NewAuditEntry {
        actor_user_id: None,
        action: AuditAction::OwnerCreated,
        entity: AuditEntity::User,
        entity_id: None,
        diff: None,
    }
}

fn row_count(database: &Database) -> i64 {
    database
        .with_conn(|conn| {
            Ok(conn.query_row("SELECT count(*) FROM audit_log", [], |row| row.get(0))?)
        })
        .unwrap()
}

#[test]
fn record_returns_increasing_ids() {
    let conn = migrated();
    let first = record(&conn, &entry()).unwrap();
    let second = record(&conn, &entry()).unwrap();
    assert!(second > first);
}

#[test]
fn record_in_rolled_back_tx_leaves_no_row() {
    let database = Database::new(migrated());
    let outcome: Result<(), DbError> = database.with_tx(|tx| {
        record(tx, &entry())?;
        Err(DbError::UnknownPermission)
    });
    assert!(outcome.is_err());
    assert_eq!(row_count(&database), 0);
}

#[test]
fn record_in_committed_tx_persists_row() {
    let database = Database::new(migrated());
    let outcome: Result<i64, DbError> = database.with_tx(|tx| record(tx, &entry()));
    assert!(outcome.is_ok());
    assert_eq!(row_count(&database), 1);
}

#[test]
fn audit_is_a_leaf_module_that_never_imports_auth() {
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/features/audit");
    let forbidden = [concat!("features", "::auth"), concat!("super", "::auth")];
    for file in std::fs::read_dir(directory).unwrap() {
        let path = file.unwrap().path();
        let source = std::fs::read_to_string(&path).unwrap();
        for needle in forbidden {
            assert!(!source.contains(needle), "{path:?} imports {needle}");
        }
    }
}
