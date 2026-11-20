pub mod connection;
pub mod key;
pub mod migrations;
pub mod snapshot;

use thiserror::Error;

pub use connection::{open_encrypted, Database};
pub use key::DbKey;
pub use migrations::migrate;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("database error")]
    Sqlite(#[from] rusqlite::Error),
    #[error("database schema version {found} is not supported (latest known: {supported})")]
    SchemaNewerThanApp { found: i64, supported: u32 },
    #[error("not a database or wrong key")]
    NotADatabase,
    #[error("database operation panicked")]
    OperationPanicked,
    #[error("unknown permission")]
    UnknownPermission,
    #[error("invalid instant")]
    InvalidInstant,
}

pub(crate) fn require_valid_instant(
    conn: &rusqlite::Connection,
    instant: &str,
) -> Result<(), DbError> {
    let is_valid: bool = conn.query_row(
        "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', ?1) IS NOT NULL",
        [instant],
        |row| row.get(0),
    )?;
    if is_valid {
        Ok(())
    } else {
        Err(DbError::InvalidInstant)
    }
}

#[cfg(test)]
#[path = "utc_format_test.rs"]
mod utc_format_tests;
