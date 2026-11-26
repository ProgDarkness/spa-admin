use std::io;

use thiserror::Error;

use crate::db::DbError;
use crate::errors::AppError;
use crate::features::auth::service::AuthError;
use crate::keystore::KeyStoreError;

const LOG_SCOPE: &str = "backup";

#[derive(Debug, Error)]
pub enum BackupError {
    #[error("backup file not recognized")]
    NotRecognized,
    #[error("backup created by a newer app version")]
    FromNewerApp,
    #[error("backup unreadable")]
    Unreadable,
    #[error("validation failed")]
    Validation { field: &'static str },
    #[error("auth failure")]
    Auth(#[from] AuthError),
    #[error("database failure")]
    Db(#[from] DbError),
    #[error("file failure")]
    Io(#[from] io::Error),
    #[error("key store failure")]
    KeyStore(#[from] KeyStoreError),
    #[error("encryption failure")]
    Crypto,
    #[error("database too large for a backup file")]
    TooLarge,
    #[error("restore could not be undone")]
    RollbackFailed,
}

impl From<BackupError> for AppError {
    fn from(error: BackupError) -> Self {
        match error {
            BackupError::NotRecognized => AppError::backup_not_recognized(),
            BackupError::FromNewerApp => AppError::backup_from_newer_app(),
            BackupError::Unreadable => AppError::backup_unreadable(),
            BackupError::Validation { field } => AppError::validation(field),
            BackupError::Auth(inner) => AppError::from(inner),
            BackupError::TooLarge => {
                eprintln!("{LOG_SCOPE}: {:?}", BackupError::TooLarge);
                AppError::backup_too_large()
            }
            BackupError::RollbackFailed => {
                eprintln!("{LOG_SCOPE}: {:?}", BackupError::RollbackFailed);
                AppError::backup_rollback_failed()
            }
            internal => {
                eprintln!("{LOG_SCOPE}: {internal:?}");
                AppError::internal()
            }
        }
    }
}

#[cfg(test)]
#[path = "errors_test.rs"]
mod tests;
