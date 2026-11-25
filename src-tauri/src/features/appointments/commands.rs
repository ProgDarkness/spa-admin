use rusqlite::{Connection, Transaction};
use tauri::State;

use super::model::{
    AppointmentError, AppointmentInput, AppointmentMove, AppointmentRange, AppointmentSummary,
    AppointmentTransition, AppointmentTransitionRequest,
};
use super::{service, service_change};
use crate::db::Database;
use crate::errors::AppError;
use crate::features::auth::model::{PermissionKey, SessionUser};
use crate::features::auth::service::{
    require_any_permission, require_permission, Beat, SessionState,
};

const READ_PERMISSIONS: [PermissionKey; 2] = [
    PermissionKey::AppointmentsRead,
    PermissionKey::AppointmentsWrite,
];

fn authorize_read(
    conn: &Connection,
    session: &SessionState,
) -> Result<SessionUser, AppointmentError> {
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
) -> Result<SessionUser, AppointmentError> {
    Ok(require_permission(
        conn,
        session,
        PermissionKey::AppointmentsWrite,
        beat,
    )?)
}

fn authorize_transition(
    conn: &Connection,
    session: &SessionState,
    beat: Beat,
    transition: AppointmentTransition,
) -> Result<SessionUser, AppointmentError> {
    let actor = authorize_write(conn, session, beat)?;
    if transition == AppointmentTransition::Reopen {
        require_permission(conn, session, PermissionKey::AppointmentsReopen, beat)?;
    }
    Ok(actor)
}

fn authorize_outside_transaction(
    db: &Database,
    session: &SessionState,
    transition: Option<AppointmentTransition>,
) -> Result<(), AppointmentError> {
    db.with_conn_mapped(|conn| {
        let beat = Beat::now();
        match transition {
            Some(kind) => authorize_transition(conn, session, beat, kind).map(|_| ()),
            None => authorize_write(conn, session, beat).map(|_| ()),
        }
    })
}

fn create_appointment_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    input: &AppointmentInput,
) -> Result<AppointmentSummary, AppointmentError> {
    let actor = authorize_write(tx, session, beat)?;
    service::create_appointment(tx, actor.id, input)
}

fn move_appointment_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    movement: &AppointmentMove,
) -> Result<AppointmentSummary, AppointmentError> {
    let actor = authorize_write(tx, session, beat)?;
    service_change::move_appointment(tx, actor.id, movement)
}

fn transition_appointment_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    request: &AppointmentTransitionRequest,
) -> Result<AppointmentSummary, AppointmentError> {
    let actor = authorize_transition(tx, session, beat, request.transition)?;
    service_change::transition_appointment(tx, actor.id, request)
}

#[tauri::command]
#[specta::specta]
pub fn list_appointments(
    range: AppointmentRange,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<Vec<AppointmentSummary>, AppError> {
    Ok(db.with_conn_mapped(
        |conn| -> Result<Vec<AppointmentSummary>, AppointmentError> {
            authorize_read(conn, &session)?;
            service::list_appointments(conn, &range)
        },
    )?)
}

#[tauri::command]
#[specta::specta]
pub fn create_appointment(
    input: AppointmentInput,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<AppointmentSummary, AppError> {
    authorize_outside_transaction(&db, &session, None)?;
    Ok(db.with_tx(|tx| create_appointment_in_transaction(tx, &session, Beat::now(), &input))?)
}

#[tauri::command]
#[specta::specta]
pub fn move_appointment(
    movement: AppointmentMove,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<AppointmentSummary, AppError> {
    authorize_outside_transaction(&db, &session, None)?;
    Ok(db.with_tx(|tx| move_appointment_in_transaction(tx, &session, Beat::now(), &movement))?)
}

#[tauri::command]
#[specta::specta]
pub fn transition_appointment(
    request: AppointmentTransitionRequest,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<AppointmentSummary, AppError> {
    authorize_outside_transaction(&db, &session, Some(request.transition))?;
    Ok(db
        .with_tx(|tx| transition_appointment_in_transaction(tx, &session, Beat::now(), &request))?)
}

#[cfg(test)]
#[path = "commands_test.rs"]
mod tests;
