use serde_json::json;

use super::*;

#[test]
fn app_error_serializes_camel_case_with_null_details() {
    let value = serde_json::to_value(AppError::invalid_credentials()).unwrap();
    assert_eq!(
        value,
        json!({
            "code": "invalidCredentials",
            "message": "Usuario o contraseña incorrectos",
            "field": null,
            "entityIds": null
        })
    );
}

#[test]
fn internal_error_has_fixed_message_and_internal_code() {
    let value = serde_json::to_value(AppError::internal()).unwrap();
    assert_eq!(value["code"], "internal");
    assert_eq!(value["message"], "No se pudo completar la operación");
}

#[test]
fn validation_code_and_details_serialize_camel_case() {
    let error = AppError {
        code: AppErrorCode::Validation,
        message: "x".to_string(),
        field: Some("username".to_string()),
        entity_ids: Some(vec![1, 2]),
    };
    let value = serde_json::to_value(error).unwrap();
    assert_eq!(value["code"], "validation");
    assert_eq!(value["field"], "username");
    assert_eq!(value["entityIds"], json!([1, 2]));
}

#[test]
fn session_errors_serialize_with_their_own_codes() {
    let unauthenticated = serde_json::to_value(AppError::unauthenticated()).unwrap();
    let forbidden = serde_json::to_value(AppError::forbidden()).unwrap();
    assert_eq!(unauthenticated["code"], "unauthenticated");
    assert_eq!(forbidden["code"], "forbidden");
    assert_ne!(unauthenticated["message"], forbidden["message"]);
}

#[test]
fn session_locked_serializes_with_its_own_code_and_message() {
    let value = serde_json::to_value(AppError::session_locked()).unwrap();
    assert_eq!(value["code"], "sessionLocked");
    assert_eq!(
        value["message"],
        "Sesión bloqueada. Ingresa tu contraseña para continuar"
    );
    assert_eq!(value["field"], json!(null));
}

#[test]
fn validation_constructor_carries_the_field() {
    let error = AppError::validation("password");
    assert_eq!(error.code, AppErrorCode::Validation);
    assert_eq!(error.field.as_deref(), Some("password"));
    assert_eq!(error.entity_ids, None);
}

#[test]
fn not_found_serializes_with_its_own_code_and_no_details() {
    let value = serde_json::to_value(AppError::not_found()).unwrap();
    assert_eq!(value["code"], "notFound");
    assert_eq!(value["message"], "Cliente no encontrado");
    assert_eq!(value["field"], json!(null));
    assert_eq!(value["entityIds"], json!(null));
}

#[test]
fn national_id_taken_points_at_the_national_id_field() {
    let value = serde_json::to_value(AppError::national_id_taken()).unwrap();
    assert_eq!(value["code"], "nationalIdTaken");
    assert_eq!(value["message"], "Ya existe un cliente con esa cédula");
    assert_eq!(value["field"], "nationalId");
    assert_eq!(value["entityIds"], json!(null));
}

#[test]
fn client_deleted_reactivate_carries_the_entity_ids() {
    let value = serde_json::to_value(AppError::client_deleted_reactivate(7)).unwrap();
    assert_eq!(value["code"], "clientDeletedReactivate");
    assert_eq!(
        value["message"],
        "Ya existió un cliente eliminado con esa cédula. ¿Reactivarlo?"
    );
    assert_eq!(value["field"], "nationalId");
    assert_eq!(value["entityIds"], json!([7]));
}

fn serialized(error: AppError) -> serde_json::Value {
    serde_json::to_value(error).unwrap()
}

#[test]
fn overlap_lists_the_conflicting_appointments_on_the_start_field() {
    let value = serialized(AppError::overlap(vec![4, 9]));
    assert_eq!(value["code"], "overlap");
    assert_eq!(
        value["message"],
        "El recurso ya tiene una cita en ese horario"
    );
    assert_eq!(value["field"], "startsAt");
    assert_eq!(value["entityIds"], json!([4, 9]));
}

#[test]
fn crosses_midnight_points_at_the_start_field() {
    let value = serialized(AppError::crosses_midnight());
    assert_eq!(value["code"], "crossesMidnight");
    assert_eq!(
        value["message"],
        "La cita no puede terminar después de la medianoche"
    );
    assert_eq!(value["field"], "startsAt");
    assert_eq!(value["entityIds"], json!(null));
}

#[test]
fn invalid_transition_has_no_field() {
    let value = serialized(AppError::invalid_transition());
    assert_eq!(value["code"], "invalidTransition");
    assert_eq!(
        value["message"],
        "La cita no admite esa operación en su estado actual"
    );
    assert_eq!(value["field"], json!(null));
}

#[test]
fn resource_inactive_points_at_the_resource_field() {
    let value = serialized(AppError::resource_inactive());
    assert_eq!(value["code"], "resourceInactive");
    assert_eq!(value["message"], "El recurso está inactivo");
    assert_eq!(value["field"], "resourceId");
}

#[test]
fn resource_has_future_appointments_carries_the_blocking_ids() {
    let value = serialized(AppError::resource_has_future_appointments(vec![5, 12]));
    assert_eq!(value["code"], "resourceHasFutureAppointments");
    assert_eq!(
        value["message"],
        "El recurso tiene citas futuras que deben reubicarse antes de desactivarlo"
    );
    assert_eq!(value["field"], json!(null));
    assert_eq!(value["entityIds"], json!([5, 12]));
}

#[test]
fn missing_references_name_the_field_with_their_own_message() {
    let client = serialized(AppError::missing_reference("clientId"));
    let service = serialized(AppError::missing_reference("serviceId"));
    let resource = serialized(AppError::missing_reference("resourceId"));
    assert_eq!(client["code"], "notFound");
    assert_eq!(client["field"], "clientId");
    assert_eq!(client["message"], "El cliente no existe");
    assert_eq!(service["message"], "El servicio no existe");
    assert_eq!(resource["message"], "El recurso no existe");
}

#[test]
fn a_missing_appointment_is_not_found_without_a_field() {
    let value = serialized(AppError::appointment_not_found());
    assert_eq!(value["code"], "notFound");
    assert_eq!(value["message"], "La cita no existe");
    assert_eq!(value["field"], json!(null));
}

#[test]
fn rate_missing_points_at_the_rate_field() {
    let value = serialized(AppError::rate_missing());
    assert_eq!(value["code"], "rateMissing");
    assert_eq!(
        value["message"],
        "Falta la tasa de hoy; registra la tasa o indícala manualmente"
    );
    assert_eq!(value["field"], "rateBsPerUsdE4");
    assert_eq!(value["entityIds"], json!(null));
}

#[test]
fn already_voided_carries_the_payment_id() {
    let value = serialized(AppError::already_voided(9));
    assert_eq!(value["code"], "alreadyVoided");
    assert_eq!(value["message"], "El pago ya fue anulado");
    assert_eq!(value["field"], json!(null));
    assert_eq!(value["entityIds"], json!([9]));
}

#[test]
fn a_missing_payment_is_not_found_without_a_field() {
    let value = serialized(AppError::payment_not_found());
    assert_eq!(value["code"], "notFound");
    assert_eq!(value["message"], "El pago no existe");
    assert_eq!(value["field"], json!(null));
}

#[test]
fn missing_appointment_and_method_references_have_their_own_messages() {
    let appointment = serialized(AppError::missing_reference("appointmentId"));
    let method = serialized(AppError::missing_reference("methodId"));
    assert_eq!(appointment["field"], "appointmentId");
    assert_eq!(appointment["message"], "La cita no existe");
    assert_eq!(method["field"], "methodId");
    assert_eq!(method["message"], "El método de pago no existe");
}

#[test]
fn unreadable_backup_does_not_distinguish_a_wrong_passphrase_from_a_damaged_file() {
    let value = serialized(AppError::backup_unreadable());
    assert_eq!(value["code"], "backupUnreadable");
    assert_eq!(
        value["message"],
        "La frase no coincide o el archivo está dañado"
    );
    assert_eq!(value["field"], json!(null));
    assert_eq!(value["entityIds"], json!(null));
}

#[test]
fn unrecognized_backup_has_its_own_code_and_message() {
    let value = serialized(AppError::backup_not_recognized());
    assert_eq!(value["code"], "backupNotRecognized");
    assert_eq!(value["message"], "El archivo no es un respaldo reconocido");
    assert_eq!(value["field"], json!(null));
}

#[test]
fn backup_from_a_newer_app_has_its_own_code_and_message() {
    let value = serialized(AppError::backup_from_newer_app());
    assert_eq!(value["code"], "backupFromNewerApp");
    assert_eq!(
        value["message"],
        "El respaldo fue creado con una versión más nueva de la aplicación"
    );
    assert_eq!(value["field"], json!(null));
}

#[test]
fn backup_error_codes_are_distinct() {
    let codes = [
        AppError::backup_unreadable().code,
        AppError::backup_not_recognized().code,
        AppError::backup_from_newer_app().code,
    ];
    assert_ne!(codes[0], codes[1]);
    assert_ne!(codes[1], codes[2]);
    assert_ne!(codes[0], codes[2]);
}
