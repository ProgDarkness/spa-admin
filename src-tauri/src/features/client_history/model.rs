use serde::Serialize;
use thiserror::Error;

use crate::db::DbError;
use crate::errors::AppError;
use crate::features::appointments::model::AppointmentSummary;
use crate::features::auth::service::AuthError;
use crate::features::clients::model::ClientSummary;
use crate::features::named_records::RecordFailure;
use crate::features::payments::model::PaymentSummary;

#[derive(Serialize, specta::Type, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AmountsByCurrency {
    #[serde(rename = "USD")]
    pub usd: i64,
    #[serde(rename = "VES")]
    pub ves: i64,
}

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientHistoryEntry {
    #[serde(flatten)]
    pub appointment: AppointmentSummary,
    pub service_name: String,
    pub resource_name: String,
    pub payments: Vec<PaymentSummary>,
}

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientHistory {
    pub client: ClientSummary,
    pub entries: Vec<ClientHistoryEntry>,
    pub total_minutes: i64,
    pub paid_by_currency: AmountsByCurrency,
    pub collected_on_non_completed_by_currency: AmountsByCurrency,
    pub pending_by_currency: AmountsByCurrency,
    pub ves_usd_equivalent_of_completed: i64,
}

pub(crate) const LOG_SCOPE: &str = "client_history";

#[derive(Debug, Error)]
pub enum ClientHistoryError {
    #[error("auth failure")]
    Auth(#[from] AuthError),
    #[error("database failure")]
    Db(#[from] DbError),
    #[error("client not found")]
    NotFound,
}

impl From<ClientHistoryError> for AppError {
    fn from(error: ClientHistoryError) -> Self {
        match error {
            ClientHistoryError::Auth(inner) => AppError::from(inner),
            ClientHistoryError::Db(inner) => RecordFailure::Db(inner).into_app_error(LOG_SCOPE),
            ClientHistoryError::NotFound => AppError::not_found(),
        }
    }
}

#[cfg(test)]
#[path = "model_test.rs"]
mod tests;
