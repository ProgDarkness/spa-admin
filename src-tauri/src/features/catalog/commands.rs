use rusqlite::Connection;
use tauri::State;

use super::model::{
    CatalogError, ServiceActivation, ServiceFilter, ServiceInput, ServiceSummary, ServiceUpdate,
};
use super::{repository, service};
use crate::db::Database;
use crate::errors::AppError;
use crate::features::auth::model::{PermissionKey, SessionUser};
use crate::features::auth::service::{
    require_any_permission, require_permission, Beat, SessionState,
};

const READ_PERMISSIONS: [PermissionKey; 2] =
    [PermissionKey::CatalogRead, PermissionKey::CatalogWrite];

fn authorize_read(conn: &Connection, session: &SessionState) -> Result<SessionUser, CatalogError> {
    Ok(require_any_permission(
        conn,
        session,
        &READ_PERMISSIONS,
        Beat::now(),
    )?)
}

fn authorize_write(conn: &Connection, session: &SessionState) -> Result<SessionUser, CatalogError> {
    Ok(require_permission(
        conn,
        session,
        PermissionKey::CatalogWrite,
        Beat::now(),
    )?)
}

fn authorize_write_outside_transaction(
    db: &Database,
    session: &SessionState,
) -> Result<(), CatalogError> {
    db.with_conn_mapped(|conn| authorize_write(conn, session).map(|_| ()))
}

#[tauri::command]
#[specta::specta]
pub fn list_services(
    filter: ServiceFilter,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<Vec<ServiceSummary>, AppError> {
    Ok(
        db.with_conn_mapped(|conn| -> Result<Vec<ServiceSummary>, CatalogError> {
            authorize_read(conn, &session)?;
            Ok(repository::list_services(conn, filter)?)
        })?,
    )
}

#[tauri::command]
#[specta::specta]
pub fn create_service(
    input: ServiceInput,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<ServiceSummary, AppError> {
    authorize_write_outside_transaction(&db, &session)?;
    Ok(db.with_tx(|tx| {
        let actor = authorize_write(tx, &session)?;
        service::create_service(tx, actor.id, &input)
    })?)
}

#[tauri::command]
#[specta::specta]
pub fn update_service(
    update: ServiceUpdate,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<ServiceSummary, AppError> {
    authorize_write_outside_transaction(&db, &session)?;
    Ok(db.with_tx(|tx| {
        let actor = authorize_write(tx, &session)?;
        service::update_service(tx, actor.id, &update)
    })?)
}

#[tauri::command]
#[specta::specta]
pub fn set_service_active(
    activation: ServiceActivation,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<ServiceSummary, AppError> {
    authorize_write_outside_transaction(&db, &session)?;
    Ok(db.with_tx(|tx| {
        let actor = authorize_write(tx, &session)?;
        service::set_service_active(tx, actor.id, &activation)
    })?)
}

#[cfg(test)]
#[path = "commands_test.rs"]
mod tests;
