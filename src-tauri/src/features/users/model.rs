use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::{Zeroize, Zeroizing};

use crate::db::DbError;
use crate::errors::AppError;
use crate::features::auth::model::PermissionKey;
use crate::features::auth::service::AuthError;

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserSummary {
    pub id: i64,
    pub username: String,
    pub role_id: i64,
    pub role_name: String,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoleSummary {
    pub id: i64,
    pub name: String,
    pub permissions: Vec<PermissionKey>,
    pub user_count: i64,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NewUserInput {
    pub username: String,
    pub password: String,
    pub role_id: i64,
}

impl NewUserInput {
    pub(crate) fn take_password(&mut self) -> Zeroizing<String> {
        Zeroizing::new(std::mem::take(&mut self.password))
    }
}

impl Drop for NewUserInput {
    fn drop(&mut self) {
        self.password.zeroize();
    }
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserUpdate {
    pub id: i64,
    pub username: Option<String>,
    pub role_id: Option<i64>,
    pub active: Option<bool>,
}

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PasswordReset {
    pub user_id: i64,
    pub new_password: String,
}

impl PasswordReset {
    pub(crate) fn take_password(&mut self) -> Zeroizing<String> {
        Zeroizing::new(std::mem::take(&mut self.new_password))
    }
}

impl Drop for PasswordReset {
    fn drop(&mut self) {
        self.new_password.zeroize();
    }
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NewRole {
    pub name: String,
    pub permissions: Vec<PermissionKey>,
}

#[derive(Deserialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RolePermissionsUpdate {
    pub role_id: i64,
    pub permissions: Vec<PermissionKey>,
}

#[derive(Debug, Error)]
pub enum UsersError {
    #[error("auth failure")]
    Auth(#[from] AuthError),
    #[error("database failure")]
    Db(#[from] DbError),
    #[error("validation failed")]
    Validation { field: &'static str },
    #[error("operation would leave no active administrator")]
    LastAdmin { field: &'static str },
}

impl From<UsersError> for AppError {
    fn from(error: UsersError) -> Self {
        match error {
            UsersError::Auth(inner) => AppError::from(inner),
            UsersError::Validation { field } | UsersError::LastAdmin { field } => {
                AppError::validation(field)
            }
            UsersError::Db(inner) => {
                eprintln!("users: {inner}");
                AppError::internal()
            }
        }
    }
}

#[cfg(test)]
#[path = "model_test.rs"]
mod tests;
