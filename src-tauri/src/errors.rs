use serde::Serialize;

#[derive(Serialize, specta::Type, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppErrorCode {
    InvalidCredentials,
    Validation,
    Unauthenticated,
    Forbidden,
    SessionLocked,
    NotFound,
    NationalIdTaken,
    ClientDeletedReactivate,
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
const NOT_FOUND_MESSAGE: &str = "Cliente no encontrado";
const NATIONAL_ID_TAKEN_MESSAGE: &str = "Ya existe un cliente con esa cédula";
const CLIENT_DELETED_REACTIVATE_MESSAGE: &str =
    "Ya existió un cliente eliminado con esa cédula. ¿Reactivarlo?";
const NATIONAL_ID_FIELD: &str = "nationalId";

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

    pub fn not_found() -> Self {
        Self::without_details(AppErrorCode::NotFound, NOT_FOUND_MESSAGE)
    }

    pub fn national_id_taken() -> Self {
        Self {
            field: Some(NATIONAL_ID_FIELD.to_string()),
            ..Self::without_details(AppErrorCode::NationalIdTaken, NATIONAL_ID_TAKEN_MESSAGE)
        }
    }

    pub fn client_deleted_reactivate(client_id: i64) -> Self {
        Self {
            field: Some(NATIONAL_ID_FIELD.to_string()),
            entity_ids: Some(vec![client_id]),
            ..Self::without_details(
                AppErrorCode::ClientDeletedReactivate,
                CLIENT_DELETED_REACTIVATE_MESSAGE,
            )
        }
    }

    pub fn internal() -> Self {
        Self::without_details(AppErrorCode::Internal, INTERNAL_MESSAGE)
    }
}

#[cfg(test)]
#[path = "errors_test.rs"]
mod tests;
