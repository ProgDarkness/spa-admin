pub mod connection;
pub mod key;
pub mod migrations;

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
}
