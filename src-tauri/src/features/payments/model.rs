use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::db::DbError;
use crate::errors::AppError;
use crate::features::auth::service::AuthError;
use crate::features::named_records::RecordFailure;

#[derive(Serialize, Deserialize, specta::Type, Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaymentCurrency {
    #[serde(rename = "USD")]
    Usd,
    #[serde(rename = "VES")]
    Ves,
}

impl PaymentCurrency {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Usd => "USD",
            Self::Ves => "VES",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "USD" => Some(Self::Usd),
            "VES" => Some(Self::Ves),
            _ => None,
        }
    }
}

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentSummary {
    pub id: i64,
    pub appointment_id: i64,
    pub method_id: i64,
    pub currency: PaymentCurrency,
    pub amount_cents: i64,
    pub rate_bs_per_usd_e4: Option<i64>,
    pub usd_equivalent_cents: i64,
    pub paid_at: String,
    pub voided_at: Option<String>,
    pub voided_by: Option<i64>,
    pub void_reason: Option<String>,
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInput {
    pub appointment_id: i64,
    pub method_id: i64,
    pub currency: PaymentCurrency,
    pub amount_cents: i64,
    pub rate_bs_per_usd_e4: Option<i64>,
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentVoidRequest {
    pub id: i64,
    pub reason: String,
}

pub(crate) const LOG_SCOPE: &str = "payments";

#[derive(Debug, Error)]
pub enum PaymentError {
    #[error("auth failure")]
    Auth(#[from] AuthError),
    #[error("database failure")]
    Db(#[from] DbError),
    #[error("validation failed")]
    Validation { field: &'static str },
    #[error("payment not found")]
    NotFound,
    #[error("referenced record not found")]
    ReferenceMissing { field: &'static str },
    #[error("exchange rate missing")]
    RateMissing,
    #[error("payment already voided")]
    AlreadyVoided { payment_id: i64 },
}

impl From<PaymentError> for AppError {
    fn from(error: PaymentError) -> Self {
        match error {
            PaymentError::Auth(inner) => AppError::from(inner),
            PaymentError::Db(inner) => RecordFailure::Db(inner).into_app_error(LOG_SCOPE),
            PaymentError::Validation { field } => {
                RecordFailure::Validation { field }.into_app_error(LOG_SCOPE)
            }
            PaymentError::NotFound => AppError::payment_not_found(),
            PaymentError::ReferenceMissing { field } => AppError::missing_reference(field),
            PaymentError::RateMissing => AppError::rate_missing(),
            PaymentError::AlreadyVoided { payment_id } => AppError::already_voided(payment_id),
        }
    }
}

#[cfg(test)]
#[path = "model_test.rs"]
mod tests;
