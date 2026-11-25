use serde::Serialize;
use thiserror::Error;

use crate::db::DbError;
use crate::errors::AppError;
use crate::features::auth::service::AuthError;
use crate::features::named_records::RecordFailure;
use crate::features::payments::model::AmountsByCurrency;

#[derive(Serialize, specta::Type, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentCounts {
    pub scheduled: i64,
    pub in_progress: i64,
    pub completed: i64,
    pub cancelled: i64,
    pub no_show: i64,
}

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyMetrics {
    pub month: String,
    pub new_clients: i64,
    pub recurring_clients: i64,
    pub appointments: AppointmentCounts,
    pub revenue_by_currency: AmountsByCurrency,
    pub collected_on_non_completed_by_currency: AmountsByCurrency,
    pub pending_by_currency: AmountsByCurrency,
}

pub(crate) const LOG_SCOPE: &str = "metrics";
pub(crate) const MONTH_FIELD: &str = "month";

#[derive(Debug, Error)]
pub enum MetricsError {
    #[error("auth failure")]
    Auth(#[from] AuthError),
    #[error("database failure")]
    Db(#[from] DbError),
    #[error("validation failed")]
    Validation { field: &'static str },
    #[error("unknown appointment status")]
    UnknownStatus,
    #[error("aggregated total exceeds the safe integer range")]
    TotalExceedsSafeRange,
}

impl From<MetricsError> for AppError {
    fn from(error: MetricsError) -> Self {
        match error {
            MetricsError::Auth(inner) => AppError::from(inner),
            MetricsError::Db(inner) => RecordFailure::Db(inner).into_app_error(LOG_SCOPE),
            MetricsError::Validation { field } => {
                RecordFailure::Validation { field }.into_app_error(LOG_SCOPE)
            }
            MetricsError::UnknownStatus => {
                eprintln!("{LOG_SCOPE}: unknown appointment status");
                AppError::internal()
            }
            MetricsError::TotalExceedsSafeRange => {
                eprintln!("{LOG_SCOPE}: aggregated total exceeds the safe integer range");
                AppError::internal()
            }
        }
    }
}

#[cfg(test)]
#[path = "model_test.rs"]
mod tests;
