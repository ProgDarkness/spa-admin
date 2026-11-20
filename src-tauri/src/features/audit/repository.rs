use rusqlite::types::Type;
use rusqlite::{params, Connection, OptionalExtension, Row};

use super::model::{AuditAction, AuditEntity, AuditEntry, Diff, NewAuditEntry};
use crate::db::DbError;

const ENTRY_COLUMNS: &str = "SELECT a.id, a.occurred_at, a.actor_user_id, u.username, \
     a.action, a.entity, a.entity_id, a.diff \
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id";

pub fn insert(conn: &Connection, entry: &NewAuditEntry) -> Result<i64, DbError> {
    conn.execute(
        "INSERT INTO audit_log (actor_user_id, action, entity, entity_id, diff)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            entry.actor_user_id,
            entry.action.as_str(),
            entry.entity.as_str(),
            entry.entity_id,
            entry.diff.as_ref().map(Diff::to_json),
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn find_by_id(conn: &Connection, id: i64) -> Result<Option<AuditEntry>, DbError> {
    Ok(conn
        .query_row(
            &format!("{ENTRY_COLUMNS} WHERE a.id = ?1"),
            [id],
            entry_from_row,
        )
        .optional()?)
}

pub fn list_page(
    conn: &Connection,
    before_id: Option<i64>,
    limit: u32,
) -> Result<Vec<AuditEntry>, DbError> {
    let mut statement = conn.prepare(&format!(
        "{ENTRY_COLUMNS} WHERE (?1 IS NULL OR a.id < ?1) ORDER BY a.id DESC LIMIT ?2"
    ))?;
    let entries = statement
        .query_map(params![before_id, limit], entry_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(entries)
}

#[cfg(test)]
pub(crate) fn list_all(conn: &Connection) -> Result<Vec<AuditEntry>, DbError> {
    let mut statement = conn.prepare(&format!("{ENTRY_COLUMNS} ORDER BY a.id"))?;
    let entries = statement
        .query_map([], entry_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(entries)
}

fn unreadable_column(index: usize, stored: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        index,
        Type::Text,
        format!("unrecognized audit value: {stored}").into(),
    )
}

fn action_at(row: &Row<'_>, index: usize) -> rusqlite::Result<AuditAction> {
    let stored: String = row.get(index)?;
    AuditAction::parse(&stored).ok_or_else(|| unreadable_column(index, stored))
}

fn entity_at(row: &Row<'_>, index: usize) -> rusqlite::Result<AuditEntity> {
    let stored: String = row.get(index)?;
    AuditEntity::parse(&stored).ok_or_else(|| unreadable_column(index, stored))
}

fn entry_from_row(row: &Row<'_>) -> rusqlite::Result<AuditEntry> {
    Ok(AuditEntry {
        id: row.get(0)?,
        occurred_at: row.get(1)?,
        actor_user_id: row.get(2)?,
        actor_username: row.get(3)?,
        action: action_at(row, 4)?,
        entity: entity_at(row, 5)?,
        entity_id: row.get(6)?,
        diff: row.get(7)?,
    })
}

#[cfg(test)]
#[path = "repository_test.rs"]
mod tests;
