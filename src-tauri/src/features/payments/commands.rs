use rusqlite::{Connection, Transaction};
use tauri::State;

use super::model::{PaymentError, PaymentInput, PaymentSummary, PaymentVoidRequest};
use super::{repository, service};
use crate::db::Database;
use crate::errors::AppError;
use crate::features::auth::model::{PermissionKey, SessionUser};
use crate::features::auth::service::{
    require_any_permission, require_permission, Beat, SessionState,
};

const READ_PERMISSIONS: [PermissionKey; 2] =
    [PermissionKey::PaymentsRead, PermissionKey::PaymentsWrite];

fn authorize_read(conn: &Connection, session: &SessionState) -> Result<SessionUser, PaymentError> {
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
) -> Result<SessionUser, PaymentError> {
    Ok(require_permission(
        conn,
        session,
        PermissionKey::PaymentsWrite,
        beat,
    )?)
}

fn authorize_outside_transaction(
    db: &Database,
    session: &SessionState,
) -> Result<(), PaymentError> {
    db.with_conn_mapped(|conn| authorize_write(conn, session, Beat::now()).map(|_| ()))
}

fn create_payment_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    input: &PaymentInput,
) -> Result<PaymentSummary, PaymentError> {
    let actor = authorize_write(tx, session, beat)?;
    service::create_payment(tx, actor.id, input)
}

fn void_payment_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    request: &PaymentVoidRequest,
) -> Result<PaymentSummary, PaymentError> {
    let actor = authorize_write(tx, session, beat)?;
    service::void_payment(tx, actor.id, request)
}

#[tauri::command]
#[specta::specta]
pub fn list_payments(
    appointment_id: i64,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<Vec<PaymentSummary>, AppError> {
    Ok(
        db.with_conn_mapped(|conn| -> Result<Vec<PaymentSummary>, PaymentError> {
            authorize_read(conn, &session)?;
            Ok(repository::list_payments_of_appointment(
                conn,
                appointment_id,
            )?)
        })?,
    )
}

#[tauri::command]
#[specta::specta]
pub fn create_payment(
    input: PaymentInput,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<PaymentSummary, AppError> {
    authorize_outside_transaction(&db, &session)?;
    Ok(db.with_tx(|tx| create_payment_in_transaction(tx, &session, Beat::now(), &input))?)
}

#[tauri::command]
#[specta::specta]
pub fn void_payment(
    request: PaymentVoidRequest,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<PaymentSummary, AppError> {
    authorize_outside_transaction(&db, &session)?;
    Ok(db.with_tx(|tx| void_payment_in_transaction(tx, &session, Beat::now(), &request))?)
}

#[cfg(test)]
#[path = "commands_test.rs"]
mod tests;
