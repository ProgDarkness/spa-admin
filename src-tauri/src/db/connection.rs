use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};

use rusqlite::{Connection, ErrorCode};
use zeroize::Zeroizing;

use super::{DbError, DbKey};

pub struct Database(Mutex<Connection>);

impl Database {
    pub fn new(conn: Connection) -> Self {
        Self(Mutex::new(conn))
    }

    fn acquire(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn with_conn<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, DbError>,
    ) -> Result<T, DbError> {
        let guard = self.acquire();
        let outcome = catch_unwind(AssertUnwindSafe(|| operation(&guard)));
        match outcome {
            Ok(result) => result,
            Err(_) => {
                abandon_open_transaction(&guard);
                Err(DbError::OperationPanicked)
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn poison_for_test(&self) {
        let _guard = self.0.lock().unwrap();
        panic!("poison");
    }
}

fn abandon_open_transaction(conn: &Connection) {
    if !conn.is_autocommit() {
        let _ = conn.execute_batch("ROLLBACK");
    }
}
pub fn open_encrypted(path: &Path, key: &DbKey) -> Result<Connection, DbError> {
    let conn = Connection::open(path)?;
    apply_key(&conn, key)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    verify_readable(&conn)?;
    Ok(conn)
}

fn apply_key(conn: &Connection, key: &DbKey) -> Result<(), DbError> {
    let statement = Zeroizing::new(format!("PRAGMA key = \"x'{}'\";", key.as_hex()));
    conn.execute_batch(&statement)?;
    Ok(())
}

fn verify_readable(conn: &Connection) -> Result<(), DbError> {
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })
    .map(|_| ())
    .map_err(|failure| match failure.sqlite_error_code() {
        Some(ErrorCode::NotADatabase) => DbError::NotADatabase,
        _ => DbError::Sqlite(failure),
    })
}

#[cfg(test)]
#[path = "connection_test.rs"]
mod tests;
