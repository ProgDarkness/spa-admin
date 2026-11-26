use rusqlite::Transaction;
use tauri::State;

use super::model::{MetricsError, MonthlyMetrics};
use super::service;
use crate::db::Database;
use crate::errors::AppError;
use crate::features::auth::model::PermissionKey;
use crate::features::auth::service::{require_permission, Beat, SessionState};

fn authorize_outside_transaction(
    db: &Database,
    session: &SessionState,
) -> Result<(), MetricsError> {
    db.with_conn_mapped(|conn| {
        require_permission(conn, session, PermissionKey::MetricsRead, Beat::now())
            .map(|_| ())
            .map_err(MetricsError::from)
    })
}

fn metrics_in_transaction(
    tx: &Transaction<'_>,
    session: &SessionState,
    beat: Beat,
    month: &str,
) -> Result<MonthlyMetrics, MetricsError> {
    require_permission(tx, session, PermissionKey::MetricsRead, beat)?;
    service::monthly_metrics(tx, month)
}

#[tauri::command]
#[specta::specta]
pub fn get_monthly_metrics(
    month: String,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<MonthlyMetrics, AppError> {
    authorize_outside_transaction(&db, &session)?;
    Ok(db.with_tx(|tx| metrics_in_transaction(tx, &session, Beat::now(), &month))?)
}

#[cfg(test)]
#[path = "commands_test.rs"]
mod tests;
