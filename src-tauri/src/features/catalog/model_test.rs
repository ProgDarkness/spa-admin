use super::*;
use crate::db::DbError;
use crate::errors::AppErrorCode;
use crate::features::auth::service::AuthError;

#[test]
fn max_amount_matches_the_frontend_limit() {
    assert_eq!(MAX_AMOUNT_CENTS, 100_000_000_000);
}

#[test]
fn inputs_deserialize_from_camel_case() {
    let input: ServiceInput =
        serde_json::from_str(r#"{"name":"Masaje","priceCents":3500,"durationMin":60}"#).unwrap();
    let update: ServiceUpdate =
        serde_json::from_str(r#"{"id":4,"name":"Facial","priceCents":900,"durationMin":45}"#)
            .unwrap();
    let filter: ServiceFilter = serde_json::from_str(r#"{"includeInactive":true}"#).unwrap();
    let activation: ServiceActivation = serde_json::from_str(r#"{"id":4,"active":false}"#).unwrap();

    assert_eq!(
        input,
        ServiceInput {
            name: "Masaje".into(),
            price_cents: 3500,
            duration_min: 60
        }
    );
    assert_eq!(
        update,
        ServiceUpdate {
            id: 4,
            name: "Facial".into(),
            price_cents: 900,
            duration_min: 45
        }
    );
    assert!(filter.include_inactive);
    assert_eq!(
        activation,
        ServiceActivation {
            id: 4,
            active: false
        }
    );
}

#[test]
fn input_without_required_fields_is_rejected() {
    assert!(serde_json::from_str::<ServiceInput>(r#"{"name":"Masaje"}"#).is_err());
    assert!(serde_json::from_str::<ServiceFilter>(r#"{}"#).is_err());
}

#[test]
fn summary_serializes_in_camel_case() {
    let summary = ServiceSummary {
        id: 1,
        name: "Masaje".into(),
        price_cents: 3500,
        currency: "USD".into(),
        duration_min: 60,
        active: true,
        created_at: "2026-01-01T10:00".into(),
        updated_at: "2026-01-01T10:05".into(),
    };

    let json = serde_json::to_value(&summary).unwrap();

    assert_eq!(json["priceCents"], 3500);
    assert_eq!(json["durationMin"], 60);
    assert_eq!(json["currency"], "USD");
    assert_eq!(json["createdAt"], "2026-01-01T10:00");
    assert_eq!(json["updatedAt"], "2026-01-01T10:05");
}

#[test]
fn validation_maps_to_validation_with_field() {
    let mapped = AppError::from(CatalogError::Validation { field: "name" });

    assert_eq!(mapped.code, AppErrorCode::Validation);
    assert_eq!(mapped.field.as_deref(), Some("name"));
}

#[test]
fn auth_errors_delegate_to_the_auth_mapping() {
    assert_eq!(
        AppError::from(CatalogError::Auth(AuthError::Forbidden)),
        AppError::forbidden()
    );
    assert_eq!(
        AppError::from(CatalogError::Auth(AuthError::Locked)),
        AppError::session_locked()
    );
    assert_eq!(
        AppError::from(CatalogError::Auth(AuthError::Unauthenticated)),
        AppError::unauthenticated()
    );
}

#[test]
fn database_errors_map_to_internal_without_the_cause() {
    let error = CatalogError::Db(DbError::Sqlite(rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
        Some("UNIQUE constraint failed: services.name".into()),
    )));

    let mapped = AppError::from(error);

    assert_eq!(mapped, AppError::internal());
    assert!(!format!("{mapped:?}").contains("services"));
}
