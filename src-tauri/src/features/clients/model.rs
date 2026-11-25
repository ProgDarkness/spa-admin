use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::db::DbError;
use crate::errors::AppError;
use crate::features::auth::service::AuthError;
use crate::features::named_records::RecordFailure;

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientSummary {
    pub id: i64,
    pub first_name: String,
    pub last_name: String,
    pub national_id: String,
    pub phone: String,
    pub deleted_at: Option<String>,
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientInput {
    pub first_name: String,
    pub last_name: String,
    pub national_id: String,
    pub phone: String,
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientUpdate {
    pub id: i64,
    pub first_name: String,
    pub last_name: String,
    pub national_id: String,
    pub phone: String,
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientFilter {
    pub query: String,
    pub include_deleted: bool,
}

#[derive(Deserialize, specta::Type, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientDeletion {
    pub id: i64,
    pub deleted: bool,
}

pub(crate) const LOG_SCOPE: &str = "clients";

#[derive(Debug, Error)]
pub enum ClientError {
    #[error("auth failure")]
    Auth(#[from] AuthError),
    #[error("database failure")]
    Db(#[from] DbError),
    #[error("validation failed")]
    Validation { field: &'static str },
    #[error("client not found")]
    NotFound,
    #[error("national id taken")]
    NationalIdTaken,
    #[error("national id belongs to a deleted client")]
    DeletedHolder { client_id: i64 },
}

impl From<ClientError> for AppError {
    fn from(error: ClientError) -> Self {
        match error {
            ClientError::Auth(inner) => AppError::from(inner),
            ClientError::Validation { field } => {
                RecordFailure::Validation { field }.into_app_error(LOG_SCOPE)
            }
            ClientError::Db(inner) => RecordFailure::Db(inner).into_app_error(LOG_SCOPE),
            ClientError::NotFound => AppError::not_found(),
            ClientError::NationalIdTaken => AppError::national_id_taken(),
            ClientError::DeletedHolder { client_id } => {
                AppError::client_deleted_reactivate(client_id)
            }
        }
    }
}

#[cfg(test)]
#[path = "model_test.rs"]
mod tests;
