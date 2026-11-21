use crate::db::DbError;
use crate::errors::AppError;

#[derive(Debug)]
pub enum RecordFailure {
    Validation { field: &'static str },
    Db(DbError),
}

pub fn log_line(scope: &str, cause: &DbError) -> String {
    format!("{scope}: {cause}")
}

impl RecordFailure {
    pub fn into_app_error(self, scope: &str) -> AppError {
        match self {
            Self::Validation { field } => AppError::validation(field),
            Self::Db(cause) => {
                eprintln!("{}", log_line(scope, &cause));
                AppError::internal()
            }
        }
    }
}

#[cfg(test)]
#[path = "failure_test.rs"]
mod tests;
