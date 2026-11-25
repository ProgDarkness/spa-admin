use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::db::DbError;
use crate::errors::AppError;
use crate::features::auth::service::AuthError;
use crate::features::named_records::RecordFailure;

#[derive(Serialize, specta::Type, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppointmentStatus {
    Scheduled,
    InProgress,
    Completed,
    Cancelled,
    NoShow,
}

impl AppointmentStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Scheduled => "scheduled",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::NoShow => "no_show",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "scheduled" => Some(Self::Scheduled),
            "in_progress" => Some(Self::InProgress),
            "completed" => Some(Self::Completed),
            "cancelled" => Some(Self::Cancelled),
            "no_show" => Some(Self::NoShow),
            _ => None,
        }
    }
}

#[derive(Deserialize, specta::Type, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppointmentTransition {
    Start,
    Complete,
    MarkNoShow,
    Cancel,
    Reopen,
}

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentSummary {
    pub id: i64,
    pub client_id: i64,
    pub service_id: i64,
    pub resource_id: i64,
    pub starts_at: String,
    pub ends_at: String,
    pub status: AppointmentStatus,
    pub price_cents_snapshot: i64,
    pub duration_min_snapshot: i64,
    pub notes: Option<String>,
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentInput {
    pub client_id: i64,
    pub service_id: i64,
    pub resource_id: i64,
    pub starts_at: String,
    pub notes: Option<String>,
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentMove {
    pub id: i64,
    pub starts_at: String,
    pub resource_id: i64,
}

#[derive(Deserialize, specta::Type, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentTransitionRequest {
    pub id: i64,
    pub transition: AppointmentTransition,
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentRange {
    pub from: String,
    pub to: String,
    pub resource_id: Option<i64>,
}

pub(crate) const LOG_SCOPE: &str = "appointments";

#[derive(Debug, Error)]
pub enum AppointmentError {
    #[error("auth failure")]
    Auth(#[from] AuthError),
    #[error("database failure")]
    Db(#[from] DbError),
    #[error("validation failed")]
    Validation { field: &'static str },
    #[error("appointment not found")]
    NotFound,
    #[error("referenced record not found")]
    ReferenceMissing { field: &'static str },
    #[error("resource inactive")]
    ResourceInactive,
    #[error("slot overlaps another appointment")]
    Overlap { conflicting_ids: Vec<i64> },
    #[error("appointment crosses midnight")]
    CrossesMidnight,
    #[error("transition not allowed from current status")]
    InvalidTransition,
}

impl From<AppointmentError> for AppError {
    fn from(error: AppointmentError) -> Self {
        match error {
            AppointmentError::Auth(inner) => AppError::from(inner),
            AppointmentError::Db(inner) => RecordFailure::Db(inner).into_app_error(LOG_SCOPE),
            AppointmentError::Validation { field } => {
                RecordFailure::Validation { field }.into_app_error(LOG_SCOPE)
            }
            AppointmentError::NotFound => AppError::appointment_not_found(),
            AppointmentError::ReferenceMissing { field } => AppError::missing_reference(field),
            AppointmentError::ResourceInactive => AppError::resource_inactive(),
            AppointmentError::Overlap { conflicting_ids } => AppError::overlap(conflicting_ids),
            AppointmentError::CrossesMidnight => AppError::crosses_midnight(),
            AppointmentError::InvalidTransition => AppError::invalid_transition(),
        }
    }
}

#[cfg(test)]
#[path = "model_test.rs"]
mod tests;
