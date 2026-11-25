use rusqlite::{Connection, Transaction};
use tauri::State;

use super::model::{
    PaymentMethodActivation, PaymentMethodFilter, PaymentMethodInput, PaymentMethodSummary,
    PaymentMethodUpdate, PaymentMethodsError,
};
use super::{repository, service};
use crate::db::Database;
use crate::errors::AppError;
use crate::features::auth::model::{PermissionKey, SessionUser};
use crate::features::auth::service::{
    require_any_permission, require_permission, Beat, SessionState,
};

const READ_PERMISSIONS: [PermissionKey; 2] =
    [PermissionKey::CatalogRead, PermissionKey::PaymentsRead];

fn authorize_read(
    conn: &Connection,
    session: &SessionState,
) -> Result<SessionUser, PaymentMethodsError> {
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
) -> Result<SessionUser, PaymentMethodsError> {
    Ok(require_permission(
        conn,
        session,
        PermissionKey::CatalogWrite,
        beat,
    )?)
}

fn authorize_write_outside_transaction(
    db: &Database,
    session: &SessionState,
) -> Result<(), PaymentMethodsError> {
    db.with_conn_mapped(|conn| authorize_write(conn, session, Beat::now()).map(|_| ()))
}

fn create_payment_method_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    input: &PaymentMethodInput,
) -> Result<PaymentMethodSummary, PaymentMethodsError> {
    let actor = authorize_write(tx, session, beat)?;
    service::create_payment_method(tx, actor.id, input)
}

fn update_payment_method_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    update: &PaymentMethodUpdate,
) -> Result<PaymentMethodSummary, PaymentMethodsError> {
    let actor = authorize_write(tx, session, beat)?;
    service::update_payment_method(tx, actor.id, update)
}

fn set_payment_method_active_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    activation: &PaymentMethodActivation,
) -> Result<PaymentMethodSummary, PaymentMethodsError> {
    let actor = authorize_write(tx, session, beat)?;
    service::set_payment_method_active(tx, actor.id, activation)
}

#[tauri::command]
#[specta::specta]
pub fn list_payment_methods(
    filter: PaymentMethodFilter,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<Vec<PaymentMethodSummary>, AppError> {
    Ok(db.with_conn_mapped(
        |conn| -> Result<Vec<PaymentMethodSummary>, PaymentMethodsError> {
            authorize_read(conn, &session)?;
            Ok(repository::list_payment_methods(conn, filter)?)
        },
    )?)
}

#[tauri::command]
#[specta::specta]
pub fn create_payment_method(
    input: PaymentMethodInput,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<PaymentMethodSummary, AppError> {
    authorize_write_outside_transaction(&db, &session)?;
    Ok(db.with_tx(|tx| create_payment_method_in_transaction(tx, &session, Beat::now(), &input))?)
}

#[tauri::command]
#[specta::specta]
pub fn update_payment_method(
    update: PaymentMethodUpdate,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<PaymentMethodSummary, AppError> {
    authorize_write_outside_transaction(&db, &session)?;
    Ok(db.with_tx(|tx| update_payment_method_in_transaction(tx, &session, Beat::now(), &update))?)
}

#[tauri::command]
#[specta::specta]
pub fn set_payment_method_active(
    activation: PaymentMethodActivation,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<PaymentMethodSummary, AppError> {
    authorize_write_outside_transaction(&db, &session)?;
    Ok(db.with_tx(|tx| {
        set_payment_method_active_in_transaction(tx, &session, Beat::now(), &activation)
    })?)
}

#[cfg(test)]
#[path = "commands_test.rs"]
mod tests;
