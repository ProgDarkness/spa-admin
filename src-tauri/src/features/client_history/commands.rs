use rusqlite::Connection;
use tauri::State;

use super::model::{ClientHistory, ClientHistoryError};
use super::service;
use crate::db::Database;
use crate::errors::AppError;
use crate::features::auth::model::PermissionKey;
use crate::features::auth::service::{require_permission, Beat, SessionState};

const REQUIRED_PERMISSIONS: [PermissionKey; 3] = [
    PermissionKey::ClientsRead,
    PermissionKey::AppointmentsRead,
    PermissionKey::PaymentsRead,
];

fn authorize(conn: &Connection, session: &SessionState) -> Result<(), ClientHistoryError> {
    let beat = Beat::now();
    REQUIRED_PERMISSIONS
        .into_iter()
        .try_for_each(|permission| require_permission(conn, session, permission, beat).map(|_| ()))
        .map_err(ClientHistoryError::from)
}

#[tauri::command]
#[specta::specta]
pub fn get_client_history(
    client_id: i64,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<ClientHistory, AppError> {
    Ok(
        db.with_conn_mapped(|conn| -> Result<ClientHistory, ClientHistoryError> {
            authorize(conn, &session)?;
            service::client_history(conn, client_id)
        })?,
    )
}

#[cfg(test)]
#[path = "commands_test.rs"]
mod tests;
