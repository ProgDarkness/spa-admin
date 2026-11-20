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
