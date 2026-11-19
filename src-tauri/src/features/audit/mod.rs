pub mod clock;
pub mod model;
pub mod repository;

use rusqlite::Connection;

use crate::db::DbError;

pub use clock::{record_clock_rollback, ClockRollbackNotice};
pub use model::{
    AuditAction, AuditEntity, AuditEntry, AuditPage, AuditQuery, ClockRollback, Diff, NewAuditEntry,
};

pub fn record(conn: &Connection, entry: &NewAuditEntry) -> Result<i64, DbError> {
    repository::insert(conn, entry)
}

#[cfg(test)]
#[path = "mod_test.rs"]
mod tests;
