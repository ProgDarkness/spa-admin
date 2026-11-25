use rusqlite::{Connection, Transaction};
use tauri::State;

use super::model::{ExchangeRate, RatesError};
use super::{repository, service};
use crate::db::Database;
use crate::errors::AppError;
use crate::features::auth::model::{PermissionKey, SessionUser};
use crate::features::auth::service::{
    require_any_permission, require_permission, Beat, SessionState,
};

const READ_PERMISSIONS: [PermissionKey; 2] =
    [PermissionKey::RatesManage, PermissionKey::PaymentsRead];

fn authorize_read(conn: &Connection, session: &SessionState) -> Result<SessionUser, RatesError> {
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
) -> Result<SessionUser, RatesError> {
    Ok(require_permission(
        conn,
        session,
        PermissionKey::RatesManage,
        beat,
    )?)
}

fn authorize_write_outside_transaction(
    db: &Database,
    session: &SessionState,
) -> Result<(), RatesError> {
    db.with_conn_mapped(|conn| authorize_write(conn, session, Beat::now()).map(|_| ()))
}

fn upsert_rate_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    date: &str,
    rate_bs_per_usd_e4: i64,
) -> Result<ExchangeRate, RatesError> {
    let actor = authorize_write(tx, session, beat)?;
    service::upsert_rate(tx, actor.id, date, rate_bs_per_usd_e4)
}

#[tauri::command]
#[specta::specta]
pub fn list_rates(
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<Vec<ExchangeRate>, AppError> {
    Ok(
        db.with_conn_mapped(|conn| -> Result<Vec<ExchangeRate>, RatesError> {
            authorize_read(conn, &session)?;
            Ok(repository::list_rates(conn)?)
        })?,
    )
}

#[tauri::command]
#[specta::specta]
pub fn get_rate(
    date: String,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<Option<ExchangeRate>, AppError> {
    Ok(
        db.with_conn_mapped(|conn| -> Result<Option<ExchangeRate>, RatesError> {
            authorize_read(conn, &session)?;
            service::get_rate(conn, &date)
        })?,
    )
}

#[tauri::command]
#[specta::specta]
pub fn upsert_rate(
    date: String,
    rate_bs_per_usd_e4: i64,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<ExchangeRate, AppError> {
    authorize_write_outside_transaction(&db, &session)?;
    Ok(db.with_tx(|tx| {
        upsert_rate_in_transaction(tx, &session, Beat::now(), &date, rate_bs_per_usd_e4)
    })?)
}

#[cfg(test)]
#[path = "commands_test.rs"]
mod tests;
