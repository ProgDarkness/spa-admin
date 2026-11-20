use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use rusqlite::{Connection, ErrorCode};
use tempfile::TempDir;

use super::*;

const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";

fn key_of(digit: &str) -> DbKey {
    DbKey::from_hex(digit.repeat(64)).unwrap()
}

fn fresh_path() -> (TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("spa.db");
    (dir, path)
}

fn create_with_row(path: &Path, key: &DbKey) {
    let conn = open_encrypted(path, key).unwrap();
    conn.execute_batch("CREATE TABLE t(v TEXT); INSERT INTO t VALUES ('hello');")
        .unwrap();
}

fn read_row(conn: &Connection) -> String {
    conn.query_row("SELECT v FROM t", [], |row| row.get(0))
        .unwrap()
}

fn count_master(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get(0))
}

#[test]
fn opens_with_key_and_persists() {
    let (_dir, path) = fresh_path();
    let key = key_of("a");
    create_with_row(&path, &key);
    let reopened = open_encrypted(&path, &key).unwrap();
    assert_eq!(read_row(&reopened), "hello");
}

#[test]
fn file_is_not_readable_as_plain_sqlite() {
    let (_dir, path) = fresh_path();
    create_with_row(&path, &key_of("a"));
    let plain = Connection::open(&path).unwrap();
    let failure = count_master(&plain).unwrap_err();
    assert_eq!(failure.sqlite_error_code(), Some(ErrorCode::NotADatabase));
    let header = fs::read(&path).unwrap();
    assert_ne!(&header[..16], SQLITE_MAGIC);
}

#[test]
fn wrong_key_is_rejected() {
    let (_dir, path) = fresh_path();
    create_with_row(&path, &key_of("a"));
    let result = open_encrypted(&path, &key_of("b"));
    assert!(matches!(result, Err(DbError::NotADatabase)));
}

#[test]
fn missing_key_is_rejected() {
    let (_dir, path) = fresh_path();
    create_with_row(&path, &key_of("a"));
    let plain = Connection::open(&path).unwrap();
    assert!(count_master(&plain).is_err());
}

#[test]
fn foreign_keys_are_enforced() {
    let (_dir, path) = fresh_path();
    let conn = open_encrypted(&path, &key_of("a")).unwrap();
    conn.execute_batch(
        "CREATE TABLE parent(id INTEGER PRIMARY KEY);
         CREATE TABLE child(parent_id INTEGER REFERENCES parent(id));",
    )
    .unwrap();
    let violation = conn
        .execute("INSERT INTO child VALUES (99)", [])
        .unwrap_err();
    assert_eq!(
        violation.sqlite_error_code(),
        Some(ErrorCode::ConstraintViolation)
    );
}

#[test]
fn with_conn_runs_the_closure_on_the_connection() {
    let (_dir, path) = fresh_path();
    let database = Database::new(open_encrypted(&path, &key_of("a")).unwrap());
    let answer = database
        .with_conn(|conn| Ok(conn.query_row("SELECT 41 + 1", [], |row| row.get::<_, i64>(0))?))
        .unwrap();
    assert_eq!(answer, 42);
}

#[test]
fn with_conn_converts_a_panicking_operation_into_an_error_and_stays_usable() {
    let (_dir, path) = fresh_path();
    let database = Database::new(open_encrypted(&path, &key_of("a")).unwrap());
    let result = database.with_conn::<()>(|_| panic!("boom"));
    assert!(matches!(result, Err(DbError::OperationPanicked)));
    let answer = database
        .with_conn(|conn| Ok(conn.query_row("SELECT 7", [], |row| row.get::<_, i64>(0))?))
        .unwrap();
    assert_eq!(answer, 7);
}

#[test]
fn with_conn_rolls_back_a_transaction_left_open_by_a_panic() {
    let (_dir, path) = fresh_path();
    create_with_row(&path, &key_of("a"));
    let database = Database::new(open_encrypted(&path, &key_of("a")).unwrap());
    let _ = database.with_conn::<()>(|conn| {
        conn.execute_batch("BEGIN; INSERT INTO t VALUES ('perdido');")
            .unwrap();
        panic!("boom");
    });
    let rows = database
        .with_conn(|conn| {
            Ok(conn.query_row("SELECT count(*) FROM t", [], |row| row.get::<_, i64>(0))?)
        })
        .unwrap();
    assert_eq!(rows, 1);
}

#[test]
fn with_conn_recovers_from_a_lock_poisoned_elsewhere() {
    let (_dir, path) = fresh_path();
    let database = Arc::new(Database::new(open_encrypted(&path, &key_of("a")).unwrap()));
    let poisoner = Arc::clone(&database);
    let _ = std::thread::spawn(move || poisoner.poison_for_test()).join();
    assert!(database.with_conn(|_| Ok(())).is_ok());
}

fn database_with_row() -> (TempDir, Database) {
    let (dir, path) = fresh_path();
    create_with_row(&path, &key_of("a"));
    let database = Database::new(open_encrypted(&path, &key_of("a")).unwrap());
    (dir, database)
}

fn row_count(database: &Database) -> i64 {
    database
        .with_conn(|conn| {
            Ok(conn.query_row("SELECT count(*) FROM t", [], |row| row.get::<_, i64>(0))?)
        })
        .unwrap()
}

#[test]
fn with_tx_commits() {
    let (_dir, database) = database_with_row();
    let outcome: Result<i64, DbError> = database.with_tx(|tx| {
        tx.execute("INSERT INTO t VALUES ('nuevo')", [])?;
        Ok(5)
    });
    assert_eq!(outcome.unwrap(), 5);
    assert_eq!(row_count(&database), 2);
}

#[test]
fn with_tx_rolls_back_on_err() {
    let (_dir, database) = database_with_row();
    let outcome: Result<(), DbError> = database.with_tx(|tx| {
        tx.execute("INSERT INTO t VALUES ('perdido')", [])?;
        Err(DbError::UnknownPermission)
    });
    assert!(matches!(outcome, Err(DbError::UnknownPermission)));
    assert_eq!(row_count(&database), 1);
}

#[test]
fn with_tx_rolls_back_on_panic() {
    let (_dir, database) = database_with_row();
    let outcome: Result<(), DbError> = database.with_tx(|tx| {
        tx.execute("INSERT INTO t VALUES ('perdido')", []).unwrap();
        panic!("boom");
    });
    assert!(matches!(outcome, Err(DbError::OperationPanicked)));
    assert_eq!(row_count(&database), 1);
    let again: Result<(), DbError> = database.with_tx(|tx| {
        tx.execute("INSERT INTO t VALUES ('luego')", [])?;
        Ok(())
    });
    assert!(again.is_ok());
    assert_eq!(row_count(&database), 2);
}

#[test]
fn with_tx_recovers_from_a_lock_poisoned_elsewhere() {
    let (_dir, path) = fresh_path();
    let database = Arc::new(Database::new(open_encrypted(&path, &key_of("a")).unwrap()));
    let poisoner = Arc::clone(&database);
    let _ = std::thread::spawn(move || poisoner.poison_for_test()).join();
    let outcome: Result<(), DbError> = database.with_tx(|_| Ok(()));
    assert!(outcome.is_ok());
}

fn version_parts(text: &str) -> Vec<u32> {
    text.split(|c: char| !c.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .take(3)
        .map(|part| part.parse().unwrap())
        .collect()
}

#[test]
fn encrypted_database_runs_patched_sqlite_and_sqlcipher() {
    let (_dir, path) = fresh_path();
    let conn = open_encrypted(&path, &key_of("a")).unwrap();
    let sqlite: String = conn
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .unwrap();
    let cipher: String = conn
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .unwrap();
    assert!(version_parts(&sqlite) >= vec![3, 54, 0], "sqlite {sqlite}");
    assert!(version_parts(&cipher) >= vec![4, 20, 0], "cipher {cipher}");
}

#[derive(Debug, PartialEq)]
enum CallerError {
    Database,
    Custom,
}

impl From<DbError> for CallerError {
    fn from(_: DbError) -> Self {
        Self::Database
    }
}

impl From<rusqlite::Error> for CallerError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Database
    }
}

fn open_database() -> (TempDir, Database) {
    let (dir, path) = fresh_path();
    (
        dir,
        Database::new(open_encrypted(&path, &key_of("a")).unwrap()),
    )
}

#[test]
fn with_conn_mapped_returns_the_value_without_a_double_result() {
    let (_dir, database) = open_database();

    let answer: Result<i64, CallerError> = database.with_conn_mapped(|conn| {
        Ok(conn.query_row("SELECT 40 + 2", [], |row| row.get::<_, i64>(0))?)
    });

    assert_eq!(answer, Ok(42));
}

#[test]
fn with_conn_mapped_keeps_the_caller_error_untouched() {
    let (_dir, database) = open_database();

    let outcome: Result<(), CallerError> = database.with_conn_mapped(|_| Err(CallerError::Custom));

    assert_eq!(outcome, Err(CallerError::Custom));
}

#[test]
fn with_conn_mapped_converts_a_panic_into_the_caller_error_and_rolls_back() {
    let (_dir, database) = open_database();

    let outcome: Result<(), CallerError> = database.with_conn_mapped(|conn| {
        conn.execute_batch("BEGIN").unwrap();
        panic!("boom");
    });

    assert_eq!(outcome, Err(CallerError::Database));
    let autocommit: Result<bool, DbError> = database.with_conn(|conn| Ok(conn.is_autocommit()));
    assert!(autocommit.unwrap());
    let usable: Result<i64, DbError> =
        database.with_conn(|conn| Ok(conn.query_row("SELECT 1", [], |row| row.get(0))?));
    assert_eq!(usable.unwrap(), 1);
}
