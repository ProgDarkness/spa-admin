use super::*;
use crate::db::DbError;
use crate::errors::AppErrorCode;
use crate::features::auth::service::AuthError;

#[test]
fn inputs_deserialize_from_camel_case() {
    let input: PaymentMethodInput = serde_json::from_str(r#"{"name":"Cheque"}"#).unwrap();
    let update: PaymentMethodUpdate = serde_json::from_str(r#"{"id":4,"name":"Cheque"}"#).unwrap();
    let filter: PaymentMethodFilter = serde_json::from_str(r#"{"includeInactive":true}"#).unwrap();
    let activation: PaymentMethodActivation =
        serde_json::from_str(r#"{"id":4,"active":false}"#).unwrap();

    assert_eq!(
        input,
        PaymentMethodInput {
            name: "Cheque".into()
        }
    );
    assert_eq!(
        update,
        PaymentMethodUpdate {
            id: 4,
            name: "Cheque".into()
        }
    );
    assert!(filter.include_inactive);
    assert_eq!(
        activation,
        PaymentMethodActivation {
            id: 4,
            active: false
        }
    );
}

#[test]
fn input_without_required_fields_is_rejected() {
    assert!(serde_json::from_str::<PaymentMethodInput>(r#"{}"#).is_err());
    assert!(serde_json::from_str::<PaymentMethodUpdate>(r#"{"name":"Cheque"}"#).is_err());
    assert!(serde_json::from_str::<PaymentMethodFilter>(r#"{}"#).is_err());
    assert!(serde_json::from_str::<PaymentMethodActivation>(r#"{"id":1}"#).is_err());
}

#[test]
fn summary_serializes_in_camel_case() {
    let summary = PaymentMethodSummary {
        id: 1,
        name: "Efectivo".into(),
        active: true,
        created_at: "2026-01-01T10:00".into(),
        updated_at: "2026-01-01T10:05".into(),
    };

    let json = serde_json::to_value(&summary).unwrap();

    assert_eq!(json["id"], 1);
    assert_eq!(json["name"], "Efectivo");
    assert_eq!(json["active"], true);
    assert_eq!(json["createdAt"], "2026-01-01T10:00");
    assert_eq!(json["updatedAt"], "2026-01-01T10:05");
}

#[test]
fn validation_maps_to_validation_with_field() {
    let mapped = AppError::from(PaymentMethodsError::Validation { field: "name" });

    assert_eq!(mapped.code, AppErrorCode::Validation);
    assert_eq!(mapped.field.as_deref(), Some("name"));
}

#[test]
fn auth_errors_delegate_to_the_auth_mapping() {
    assert_eq!(
        AppError::from(PaymentMethodsError::Auth(AuthError::Forbidden)),
        AppError::forbidden()
    );
    assert_eq!(
        AppError::from(PaymentMethodsError::Auth(AuthError::Locked)),
        AppError::session_locked()
    );
    assert_eq!(
        AppError::from(PaymentMethodsError::Auth(AuthError::Unauthenticated)),
        AppError::unauthenticated()
    );
}

#[test]
fn database_errors_map_to_internal_without_the_cause() {
    let error = PaymentMethodsError::Db(DbError::Sqlite(rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
        Some("UNIQUE constraint failed: payment_methods.name_key".into()),
    )));

    let mapped = AppError::from(error);

    assert_eq!(mapped, AppError::internal());
    assert!(!format!("{mapped:?}").contains("payment_methods"));
}
