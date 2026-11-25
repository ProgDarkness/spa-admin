use rusqlite::{Connection, Transaction};
use tauri::State;

use super::model::{
    FutureAppointment, ResourceActivation, ResourceFilter, ResourceInput, ResourceSummary,
    ResourceUpdate, ResourcesError,
};
use super::{repository, service};
use crate::db::Database;
use crate::errors::AppError;
use crate::features::auth::model::{PermissionKey, SessionUser};
use crate::features::auth::service::{
    require_any_permission, require_permission, Beat, SessionState,
};

const READ_PERMISSIONS: [PermissionKey; 2] = [
    PermissionKey::AppointmentsRead,
    PermissionKey::ResourcesManage,
];

fn authorize_read(
    conn: &Connection,
    session: &SessionState,
) -> Result<SessionUser, ResourcesError> {
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
) -> Result<SessionUser, ResourcesError> {
    Ok(require_permission(
        conn,
        session,
        PermissionKey::ResourcesManage,
        beat,
    )?)
}

fn authorize_write_outside_transaction(
    db: &Database,
    session: &SessionState,
) -> Result<(), ResourcesError> {
    db.with_conn_mapped(|conn| authorize_write(conn, session, Beat::now()).map(|_| ()))
}

fn create_resource_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    input: &ResourceInput,
) -> Result<ResourceSummary, ResourcesError> {
    let actor = authorize_write(tx, session, beat)?;
    service::create_resource(tx, actor.id, input)
}

fn update_resource_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    update: &ResourceUpdate,
) -> Result<ResourceSummary, ResourcesError> {
    let actor = authorize_write(tx, session, beat)?;
    service::update_resource(tx, actor.id, update)
}

fn set_resource_active_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    activation: &ResourceActivation,
) -> Result<ResourceSummary, ResourcesError> {
    let actor = authorize_write(tx, session, beat)?;
    service::set_resource_active(tx, actor.id, activation)
}

#[tauri::command]
#[specta::specta]
pub fn list_resources(
    filter: ResourceFilter,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<Vec<ResourceSummary>, AppError> {
    Ok(
        db.with_conn_mapped(|conn| -> Result<Vec<ResourceSummary>, ResourcesError> {
            authorize_read(conn, &session)?;
            Ok(repository::list_resources(conn, filter)?)
        })?,
    )
}

#[tauri::command]
#[specta::specta]
pub fn list_future_appointments_of_resource(
    id: i64,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<Vec<FutureAppointment>, AppError> {
    Ok(
        db.with_conn_mapped(|conn| -> Result<Vec<FutureAppointment>, ResourcesError> {
            authorize_write(conn, &session, Beat::now())?;
            service::list_future_appointments(conn, id)
        })?,
    )
}

#[tauri::command]
#[specta::specta]
pub fn create_resource(
    input: ResourceInput,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<ResourceSummary, AppError> {
    authorize_write_outside_transaction(&db, &session)?;
    Ok(db.with_tx(|tx| create_resource_in_transaction(tx, &session, Beat::now(), &input))?)
}

#[tauri::command]
#[specta::specta]
pub fn update_resource(
    update: ResourceUpdate,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<ResourceSummary, AppError> {
    authorize_write_outside_transaction(&db, &session)?;
    Ok(db.with_tx(|tx| update_resource_in_transaction(tx, &session, Beat::now(), &update))?)
}

#[tauri::command]
#[specta::specta]
pub fn set_resource_active(
    activation: ResourceActivation,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<ResourceSummary, AppError> {
    authorize_write_outside_transaction(&db, &session)?;
    Ok(db
        .with_tx(|tx| set_resource_active_in_transaction(tx, &session, Beat::now(), &activation))?)
}

#[cfg(test)]
#[path = "commands_test.rs"]
mod tests;

#[cfg(test)]
#[path = "commands_future_test.rs"]
mod future_tests;
