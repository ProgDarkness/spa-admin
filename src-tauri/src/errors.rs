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
    Overlap,
    CrossesMidnight,
    InvalidTransition,
    ResourceInactive,
    ResourceHasFutureAppointments,
    RateMissing,
    AlreadyVoided,
    BackupUnreadable,
    BackupNotRecognized,
    BackupFromNewerApp,
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
const OVERLAP_MESSAGE: &str = "El recurso ya tiene una cita en ese horario";
const CROSSES_MIDNIGHT_MESSAGE: &str = "La cita no puede terminar después de la medianoche";
const INVALID_TRANSITION_MESSAGE: &str = "La cita no admite esa operación en su estado actual";
const RESOURCE_INACTIVE_MESSAGE: &str = "El recurso está inactivo";
const HAS_FUTURE_APPOINTMENTS_MESSAGE: &str =
    "El recurso tiene citas futuras que deben reubicarse antes de desactivarlo";
const APPOINTMENT_NOT_FOUND_MESSAGE: &str = "La cita no existe";
const CLIENT_MISSING_MESSAGE: &str = "El cliente no existe";
const SERVICE_MISSING_MESSAGE: &str = "El servicio no existe";
const RESOURCE_MISSING_MESSAGE: &str = "El recurso no existe";
const UNKNOWN_REFERENCE_MESSAGE: &str = "El registro no existe";
const RATE_MISSING_MESSAGE: &str = "Falta la tasa de hoy; registra la tasa o indícala manualmente";
const ALREADY_VOIDED_MESSAGE: &str = "El pago ya fue anulado";
const PAYMENT_NOT_FOUND_MESSAGE: &str = "El pago no existe";
const APPOINTMENT_MISSING_MESSAGE: &str = "La cita no existe";
const METHOD_MISSING_MESSAGE: &str = "El método de pago no existe";
const BACKUP_UNREADABLE_MESSAGE: &str = "La frase no coincide o el archivo está dañado";
const BACKUP_NOT_RECOGNIZED_MESSAGE: &str = "El archivo no es un respaldo reconocido";
const BACKUP_FROM_NEWER_APP_MESSAGE: &str =
    "El respaldo fue creado con una versión más nueva de la aplicación";
const BACKUP_ROLLBACK_FAILED_MESSAGE: &str = "La restauración quedó a medias; reinicie la aplicación para completarla o recuperar el estado anterior";
const BACKUP_TOO_LARGE_MESSAGE: &str =
    "La base de datos supera el tamaño máximo admitido para un respaldo";
const RATE_FIELD: &str = "rateBsPerUsdE4";
const NATIONAL_ID_FIELD: &str = "nationalId";
const STARTS_AT_FIELD: &str = "startsAt";
const RESOURCE_ID_FIELD: &str = "resourceId";

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

    pub fn overlap(conflicting_ids: Vec<i64>) -> Self {
        Self {
            field: Some(STARTS_AT_FIELD.to_string()),
            entity_ids: Some(conflicting_ids),
            ..Self::without_details(AppErrorCode::Overlap, OVERLAP_MESSAGE)
        }
    }

    pub fn crosses_midnight() -> Self {
        Self {
            field: Some(STARTS_AT_FIELD.to_string()),
            ..Self::without_details(AppErrorCode::CrossesMidnight, CROSSES_MIDNIGHT_MESSAGE)
        }
    }

    pub fn invalid_transition() -> Self {
        Self::without_details(AppErrorCode::InvalidTransition, INVALID_TRANSITION_MESSAGE)
    }

    pub fn resource_inactive() -> Self {
        Self {
            field: Some(RESOURCE_ID_FIELD.to_string()),
            ..Self::without_details(AppErrorCode::ResourceInactive, RESOURCE_INACTIVE_MESSAGE)
        }
    }

    pub fn resource_has_future_appointments(blocking_ids: Vec<i64>) -> Self {
        Self {
            entity_ids: Some(blocking_ids),
            ..Self::without_details(
                AppErrorCode::ResourceHasFutureAppointments,
                HAS_FUTURE_APPOINTMENTS_MESSAGE,
            )
        }
    }

    pub fn appointment_not_found() -> Self {
        Self::without_details(AppErrorCode::NotFound, APPOINTMENT_NOT_FOUND_MESSAGE)
    }

    pub fn missing_reference(field: &str) -> Self {
        let message = match field {
            "clientId" => CLIENT_MISSING_MESSAGE,
            "serviceId" => SERVICE_MISSING_MESSAGE,
            "resourceId" => RESOURCE_MISSING_MESSAGE,
            "appointmentId" => APPOINTMENT_MISSING_MESSAGE,
            "methodId" => METHOD_MISSING_MESSAGE,
            _ => UNKNOWN_REFERENCE_MESSAGE,
        };
        Self {
            field: Some(field.to_string()),
            ..Self::without_details(AppErrorCode::NotFound, message)
        }
    }

    pub fn rate_missing() -> Self {
        Self {
            field: Some(RATE_FIELD.to_string()),
            ..Self::without_details(AppErrorCode::RateMissing, RATE_MISSING_MESSAGE)
        }
    }

    pub fn already_voided(payment_id: i64) -> Self {
        Self {
            entity_ids: Some(vec![payment_id]),
            ..Self::without_details(AppErrorCode::AlreadyVoided, ALREADY_VOIDED_MESSAGE)
        }
    }

    pub fn payment_not_found() -> Self {
        Self::without_details(AppErrorCode::NotFound, PAYMENT_NOT_FOUND_MESSAGE)
    }

    pub fn backup_unreadable() -> Self {
        Self::without_details(AppErrorCode::BackupUnreadable, BACKUP_UNREADABLE_MESSAGE)
    }

    pub fn backup_not_recognized() -> Self {
        Self::without_details(
            AppErrorCode::BackupNotRecognized,
            BACKUP_NOT_RECOGNIZED_MESSAGE,
        )
    }

    pub fn backup_from_newer_app() -> Self {
        Self::without_details(
            AppErrorCode::BackupFromNewerApp,
            BACKUP_FROM_NEWER_APP_MESSAGE,
        )
    }

    pub fn backup_rollback_failed() -> Self {
        Self::without_details(AppErrorCode::Internal, BACKUP_ROLLBACK_FAILED_MESSAGE)
    }

    pub fn backup_too_large() -> Self {
        Self::without_details(AppErrorCode::Internal, BACKUP_TOO_LARGE_MESSAGE)
    }

    pub fn internal() -> Self {
        Self::without_details(AppErrorCode::Internal, INTERNAL_MESSAGE)
    }
}

#[cfg(test)]
#[path = "errors_test.rs"]
mod tests;
