use rusqlite::{Connection, Transaction};
use tauri::State;

use super::model::{
    ClientDeletion, ClientError, ClientFilter, ClientInput, ClientSummary, ClientUpdate,
};
use super::{repository, service};
use crate::db::Database;
use crate::errors::AppError;
use crate::features::auth::model::{PermissionKey, SessionUser};
use crate::features::auth::service::{
    require_any_permission, require_permission, Beat, SessionState,
};

const READ_PERMISSIONS: [PermissionKey; 2] =
    [PermissionKey::ClientsRead, PermissionKey::ClientsWrite];

fn authorize_read(conn: &Connection, session: &SessionState) -> Result<SessionUser, ClientError> {
    Ok(require_any_permission(
        conn,
        session,
        &READ_PERMISSIONS,
        Beat::now(),
    )?)
}

fn authorize_write(
    conn: &Connection,
    session: &SessionState,
    beat: Beat,
) -> Result<SessionUser, ClientError> {
    Ok(require_permission(
        conn,
        session,
        PermissionKey::ClientsWrite,
        beat,
    )?)
}

fn authorize_write_outside_transaction(
    db: &Database,
    session: &SessionState,
) -> Result<(), ClientError> {
    db.with_conn_mapped(|conn| authorize_write(conn, session, Beat::now()).map(|_| ()))
}

fn create_client_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    input: &ClientInput,
) -> Result<ClientSummary, ClientError> {
    let actor = authorize_write(tx, session, beat)?;
    service::create_client(tx, actor.id, input)
}

fn update_client_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    update: &ClientUpdate,
) -> Result<ClientSummary, ClientError> {
    let actor = authorize_write(tx, session, beat)?;
    service::update_client(tx, actor.id, update)
}

fn set_client_deleted_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    deletion: &ClientDeletion,
) -> Result<ClientSummary, ClientError> {
    let actor = authorize_write(tx, session, beat)?;
    service::set_client_deleted(tx, actor.id, deletion)
}

#[tauri::command]
#[specta::specta]
pub fn list_clients(
    filter: ClientFilter,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<Vec<ClientSummary>, AppError> {
    Ok(
        db.with_conn_mapped(|conn| -> Result<Vec<ClientSummary>, ClientError> {
            authorize_read(conn, &session)?;
            Ok(repository::list_clients(conn, &filter)?)
        })?,
    )
}

#[tauri::command]
#[specta::specta]
pub fn get_client(
    id: i64,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<ClientSummary, AppError> {
    Ok(
        db.with_conn_mapped(|conn| -> Result<ClientSummary, ClientError> {
            authorize_read(conn, &session)?;
            service::get_client(conn, id)
        })?,
    )
}

#[tauri::command]
#[specta::specta]
pub fn create_client(
    input: ClientInput,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<ClientSummary, AppError> {
    authorize_write_outside_transaction(&db, &session)?;
    Ok(db.with_tx(|tx| create_client_in_transaction(tx, &session, Beat::now(), &input))?)
}

#[tauri::command]
#[specta::specta]
pub fn update_client(
    update: ClientUpdate,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<ClientSummary, AppError> {
    authorize_write_outside_transaction(&db, &session)?;
    Ok(db.with_tx(|tx| update_client_in_transaction(tx, &session, Beat::now(), &update))?)
}

#[tauri::command]
#[specta::specta]
pub fn set_client_deleted(
    deletion: ClientDeletion,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<ClientSummary, AppError> {
    authorize_write_outside_transaction(&db, &session)?;
    Ok(db.with_tx(|tx| set_client_deleted_in_transaction(tx, &session, Beat::now(), &deletion))?)
}

#[cfg(test)]
#[path = "commands_test.rs"]
mod tests;
