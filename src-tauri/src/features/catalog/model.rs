use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::db::DbError;
use crate::errors::AppError;
use crate::features::auth::service::AuthError;

pub const MAX_AMOUNT_CENTS: i64 = 100_000_000_000;

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSummary {
    pub id: i64,
    pub name: String,
    pub price_cents: i64,
    pub currency: String,
    pub duration_min: i64,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInput {
    pub name: String,
    pub price_cents: i64,
    pub duration_min: i64,
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceUpdate {
    pub id: i64,
    pub name: String,
    pub price_cents: i64,
    pub duration_min: i64,
}

#[derive(Deserialize, specta::Type, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceFilter {
    pub include_inactive: bool,
}

#[derive(Deserialize, specta::Type, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceActivation {
    pub id: i64,
    pub active: bool,
}

#[derive(Debug, Error)]
pub enum CatalogError {
    #[error("auth failure")]
    Auth(#[from] AuthError),
    #[error("database failure")]
    Db(#[from] DbError),
    #[error("validation failed")]
    Validation { field: &'static str },
}

impl From<CatalogError> for AppError {
    fn from(error: CatalogError) -> Self {
        match error {
            CatalogError::Auth(inner) => AppError::from(inner),
            CatalogError::Validation { field } => AppError::validation(field),
            CatalogError::Db(inner) => {
                eprintln!("catalog: {inner}");
                AppError::internal()
            }
        }
    }
}

#[cfg(test)]
#[path = "model_test.rs"]
mod tests;
