use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::db::DbError;
use crate::errors::AppError;
use crate::features::auth::service::AuthError;
use crate::features::named_records::RecordFailure;

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethodSummary {
    pub id: i64,
    pub name: String,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethodInput {
    pub name: String,
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethodUpdate {
    pub id: i64,
    pub name: String,
}

#[derive(Deserialize, specta::Type, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethodFilter {
    pub include_inactive: bool,
}

#[derive(Deserialize, specta::Type, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethodActivation {
    pub id: i64,
    pub active: bool,
}

pub(crate) const LOG_SCOPE: &str = "payment_methods";

#[derive(Debug, Error)]
pub enum PaymentMethodsError {
    #[error("auth failure")]
    Auth(#[from] AuthError),
    #[error("database failure")]
    Db(#[from] DbError),
    #[error("validation failed")]
    Validation { field: &'static str },
}

impl From<PaymentMethodsError> for AppError {
    fn from(error: PaymentMethodsError) -> Self {
        match error {
            PaymentMethodsError::Auth(inner) => AppError::from(inner),
            PaymentMethodsError::Validation { field } => {
                RecordFailure::Validation { field }.into_app_error(LOG_SCOPE)
            }
            PaymentMethodsError::Db(inner) => RecordFailure::Db(inner).into_app_error(LOG_SCOPE),
        }
    }
}

#[cfg(test)]
#[path = "model_test.rs"]
mod tests;
