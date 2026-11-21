use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::db::DbError;
use crate::errors::AppError;
use crate::features::auth::service::AuthError;

#[derive(Serialize, Deserialize, specta::Type, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResourceKind {
    Cabin,
    Manicure,
}

impl ResourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cabin => "cabin",
            Self::Manicure => "manicure",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "cabin" => Some(Self::Cabin),
            "manicure" => Some(Self::Manicure),
            _ => None,
        }
    }
}

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSummary {
    pub id: i64,
    pub name: String,
    pub kind: ResourceKind,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceInput {
    pub name: String,
    pub kind: ResourceKind,
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceUpdate {
    pub id: i64,
    pub name: String,
    pub kind: ResourceKind,
}

#[derive(Deserialize, specta::Type, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceFilter {
    pub include_inactive: bool,
}

#[derive(Deserialize, specta::Type, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActivation {
    pub id: i64,
    pub active: bool,
}

#[derive(Debug, Error)]
pub enum ResourcesError {
    #[error("auth failure")]
    Auth(#[from] AuthError),
    #[error("database failure")]
    Db(#[from] DbError),
    #[error("validation failed")]
    Validation { field: &'static str },
}

impl From<ResourcesError> for AppError {
    fn from(error: ResourcesError) -> Self {
        match error {
            ResourcesError::Auth(inner) => AppError::from(inner),
            ResourcesError::Validation { field } => AppError::validation(field),
            ResourcesError::Db(inner) => {
                eprintln!("resources: {inner}");
                AppError::internal()
            }
        }
    }
}

#[cfg(test)]
#[path = "model_test.rs"]
mod tests;
