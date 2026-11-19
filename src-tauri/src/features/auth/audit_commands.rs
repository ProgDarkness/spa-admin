use rusqlite::Connection;
use tauri::State;

use super::model::PermissionKey;
use super::service::{require_permission, AuthError, Beat, SessionState};
use crate::db::Database;
use crate::errors::AppError;
use crate::features::audit::model::{AuditPage, AuditQuery, MAX_AUDIT_PAGE};
use crate::features::audit::repository::list_page;

const LIMIT_FIELD: &str = "limit";

fn validated_limit(limit: u32) -> Result<u32, AuthError> {
    if (1..=MAX_AUDIT_PAGE).contains(&limit) {
        Ok(limit)
    } else {
        Err(AuthError::Validation(LIMIT_FIELD))
    }
}

fn read_page(
    conn: &Connection,
    query: &AuditQuery,
    session: &SessionState,
) -> Result<AuditPage, AuthError> {
    require_permission(conn, session, PermissionKey::AuditRead, Beat::now())?;
    let limit = validated_limit(query.limit)?;
    let fetched = list_page(conn, query.before_id, limit + 1)?;
    Ok(AuditPage::from_fetched(fetched, limit as usize))
}

#[tauri::command]
#[specta::specta]
pub fn list_audit(
    query: AuditQuery,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<AuditPage, AppError> {
    let outcome = db.with_conn(|conn| Ok(read_page(conn, &query, &session)));
    Ok(outcome.map_err(AuthError::from)??)
}

#[cfg(test)]
#[path = "audit_commands_test.rs"]
mod tests;
