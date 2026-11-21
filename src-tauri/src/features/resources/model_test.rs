use super::*;
use crate::db::DbError;
use crate::errors::AppErrorCode;
use crate::features::auth::service::AuthError;

#[test]
fn kind_serializes_as_cabin_and_manicure() {
    assert_eq!(serde_json::to_value(ResourceKind::Cabin).unwrap(), "cabin");
    assert_eq!(
        serde_json::to_value(ResourceKind::Manicure).unwrap(),
        "manicure"
    );
}

#[test]
fn kind_deserializes_only_the_two_known_values() {
    let cabin: ResourceKind = serde_json::from_str(r#""cabin""#).unwrap();
    let manicure: ResourceKind = serde_json::from_str(r#""manicure""#).unwrap();

    assert_eq!(cabin, ResourceKind::Cabin);
    assert_eq!(manicure, ResourceKind::Manicure);
    for rejected in [r#""Cabin""#, r#""sauna""#, r#""""#, "1", "null"] {
        assert!(
            serde_json::from_str::<ResourceKind>(rejected).is_err(),
            "{rejected}"
        );
    }
}

#[test]
fn kind_round_trips_through_its_database_text() {
    for kind in [ResourceKind::Cabin, ResourceKind::Manicure] {
        assert_eq!(ResourceKind::parse(kind.as_str()), Some(kind));
    }
    assert_eq!(ResourceKind::Cabin.as_str(), "cabin");
    assert_eq!(ResourceKind::Manicure.as_str(), "manicure");
    assert_eq!(ResourceKind::parse("sauna"), None);
    assert_eq!(ResourceKind::parse("Cabin"), None);
}

#[test]
fn inputs_deserialize_from_camel_case() {
    let input: ResourceInput = serde_json::from_str(r#"{"name":"Sala","kind":"cabin"}"#).unwrap();
    let update: ResourceUpdate =
        serde_json::from_str(r#"{"id":4,"name":"Puesto","kind":"manicure"}"#).unwrap();
    let filter: ResourceFilter = serde_json::from_str(r#"{"includeInactive":true}"#).unwrap();
    let activation: ResourceActivation =
        serde_json::from_str(r#"{"id":4,"active":false}"#).unwrap();

    assert_eq!(
        input,
        ResourceInput {
            name: "Sala".into(),
            kind: ResourceKind::Cabin
        }
    );
    assert_eq!(
        update,
        ResourceUpdate {
            id: 4,
            name: "Puesto".into(),
            kind: ResourceKind::Manicure
        }
    );
    assert!(filter.include_inactive);
    assert_eq!(
        activation,
        ResourceActivation {
            id: 4,
            active: false
        }
    );
}

#[test]
fn input_without_required_fields_or_with_an_unknown_kind_is_rejected() {
    assert!(serde_json::from_str::<ResourceInput>(r#"{"name":"Sala"}"#).is_err());
    assert!(serde_json::from_str::<ResourceInput>(r#"{"name":"Sala","kind":"sauna"}"#).is_err());
    assert!(serde_json::from_str::<ResourceFilter>(r#"{}"#).is_err());
}

#[test]
fn summary_serializes_in_camel_case() {
    let summary = ResourceSummary {
        id: 1,
        name: "Cabina 1".into(),
        kind: ResourceKind::Cabin,
        active: true,
        created_at: "2026-01-01T10:00".into(),
        updated_at: "2026-01-01T10:05".into(),
    };

    let json = serde_json::to_value(&summary).unwrap();

    assert_eq!(json["kind"], "cabin");
    assert_eq!(json["active"], true);
    assert_eq!(json["createdAt"], "2026-01-01T10:00");
    assert_eq!(json["updatedAt"], "2026-01-01T10:05");
}

#[test]
fn validation_maps_to_validation_with_field() {
    let mapped = AppError::from(ResourcesError::Validation { field: "name" });

    assert_eq!(mapped.code, AppErrorCode::Validation);
    assert_eq!(mapped.field.as_deref(), Some("name"));
}

#[test]
fn auth_errors_delegate_to_the_auth_mapping() {
    assert_eq!(
        AppError::from(ResourcesError::Auth(AuthError::Forbidden)),
        AppError::forbidden()
    );
    assert_eq!(
        AppError::from(ResourcesError::Auth(AuthError::Locked)),
        AppError::session_locked()
    );
    assert_eq!(
        AppError::from(ResourcesError::Auth(AuthError::Unauthenticated)),
        AppError::unauthenticated()
    );
}

#[test]
fn database_errors_map_to_internal_without_the_cause() {
    let error = ResourcesError::Db(DbError::Sqlite(rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
        Some("UNIQUE constraint failed: resources.name_key".into()),
    )));

    let mapped = AppError::from(error);

    assert_eq!(mapped, AppError::internal());
    assert!(!format!("{mapped:?}").contains("resources"));
}

#[test]
fn log_scope_names_the_slice() {
    assert_eq!(LOG_SCOPE, "resources");
}
