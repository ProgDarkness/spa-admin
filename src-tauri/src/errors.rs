use serde::Serialize;

#[derive(Serialize, specta::Type, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppErrorCode {
    InvalidCredentials,
    Validation,
    Unauthenticated,
    Forbidden,
    SessionLocked,
    Internal,
}

#[derive(Serialize, specta::Type, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: AppErrorCode,
    pub message: String,
    pub field: Option<String>,
    pub entity_ids: Option<Vec<i64>>,
}

const INVALID_CREDENTIALS_MESSAGE: &str = "Usuario o contraseña incorrectos";
const INTERNAL_MESSAGE: &str = "No se pudo completar la operación";
const UNAUTHENTICATED_MESSAGE: &str = "Inicia sesión para continuar";
const FORBIDDEN_MESSAGE: &str = "No tienes permiso para esta acción";
const SESSION_LOCKED_MESSAGE: &str = "Sesión bloqueada. Ingresa tu contraseña para continuar";
const VALIDATION_MESSAGE: &str = "Revisa el dato ingresado";

impl AppError {
    fn without_details(code: AppErrorCode, message: &str) -> Self {
        Self {
            code,
            message: message.to_string(),
            field: None,
            entity_ids: None,
        }
    }

    pub fn invalid_credentials() -> Self {
        Self::without_details(
            AppErrorCode::InvalidCredentials,
            INVALID_CREDENTIALS_MESSAGE,
        )
    }

    pub fn unauthenticated() -> Self {
        Self::without_details(AppErrorCode::Unauthenticated, UNAUTHENTICATED_MESSAGE)
    }

    pub fn forbidden() -> Self {
        Self::without_details(AppErrorCode::Forbidden, FORBIDDEN_MESSAGE)
    }

    pub fn session_locked() -> Self {
        Self::without_details(AppErrorCode::SessionLocked, SESSION_LOCKED_MESSAGE)
    }

    pub fn validation(field: &str) -> Self {
        Self {
            field: Some(field.to_string()),
            ..Self::without_details(AppErrorCode::Validation, VALIDATION_MESSAGE)
        }
    }

    pub fn internal() -> Self {
        Self::without_details(AppErrorCode::Internal, INTERNAL_MESSAGE)
    }
}

#[cfg(test)]
#[path = "errors_test.rs"]
mod tests;
