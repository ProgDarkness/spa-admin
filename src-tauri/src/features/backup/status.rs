use rusqlite::{Connection, OptionalExtension};

use super::errors::BackupError;
use super::model::BackupStatus;
use super::service::authorize;
#[cfg(test)]
use crate::db::require_valid_instant;
use crate::db::{Database, DbError};
use crate::features::auth::service::SessionState;

pub const BACKUP_REMINDER_INTERVAL_SECONDS: i64 = 7 * 24 * 60 * 60;

pub fn get_backup_status(
    db: &Database,
    session: &SessionState,
) -> Result<BackupStatus, BackupError> {
    db.with_conn_mapped(|conn| {
        authorize(conn, session)?;
        let now_utc = current_instant(conn)?;
        status_of(conn, &now_utc)
    })
}

#[cfg(test)]
pub fn backup_status_at(
    db: &Database,
    session: &SessionState,
    now_utc: &str,
) -> Result<BackupStatus, BackupError> {
    db.with_conn_mapped(|conn| {
        authorize(conn, session)?;
        require_valid_instant(conn, now_utc)?;
        status_of(conn, now_utc)
    })
}

fn current_instant(conn: &Connection) -> Result<String, BackupError> {
    Ok(conn
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(DbError::from)?)
}

fn status_of(conn: &Connection, now_utc: &str) -> Result<BackupStatus, BackupError> {
    let latest: Option<(String, String)> = conn
        .query_row(
            "SELECT occurred_at, occurred_at_utc FROM audit_log \
             WHERE action IN ('backup_created', 'backup_restored') \
             ORDER BY occurred_at_utc DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(DbError::from)?;
    let Some((local, utc)) = latest else {
        return Ok(BackupStatus {
            last_backup_at: None,
            is_due: true,
        });
    };
    let elapsed_seconds: i64 = conn
        .query_row(
            "SELECT CAST(strftime('%s', ?1) AS INTEGER) - CAST(strftime('%s', ?2) AS INTEGER)",
            [now_utc, utc.as_str()],
            |row| row.get(0),
        )
        .map_err(DbError::from)?;
    Ok(BackupStatus {
        last_backup_at: Some(local),
        is_due: elapsed_seconds >= BACKUP_REMINDER_INTERVAL_SECONDS,
    })
}

#[cfg(test)]
#[path = "status_test.rs"]
mod tests;
