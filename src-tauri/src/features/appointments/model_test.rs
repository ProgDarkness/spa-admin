use serde_json::json;

use super::*;
use crate::db::DbError;
use crate::errors::{AppError, AppErrorCode};
use crate::features::auth::service::AuthError;

#[test]
fn statuses_serialize_camel_case_and_persist_snake_case() {
    assert_eq!(
        serde_json::to_value(AppointmentStatus::InProgress).unwrap(),
        json!("inProgress")
    );
    assert_eq!(
        serde_json::to_value(AppointmentStatus::NoShow).unwrap(),
        json!("noShow")
    );
    assert_eq!(AppointmentStatus::InProgress.as_str(), "in_progress");
    assert_eq!(AppointmentStatus::NoShow.as_str(), "no_show");
}

#[test]
fn every_status_round_trips_through_its_stored_text() {
    for status in [
        AppointmentStatus::Scheduled,
        AppointmentStatus::InProgress,
        AppointmentStatus::Completed,
        AppointmentStatus::Cancelled,
        AppointmentStatus::NoShow,
    ] {
        assert_eq!(AppointmentStatus::parse(status.as_str()), Some(status));
    }
    assert_eq!(AppointmentStatus::parse("inProgress"), None);
    assert_eq!(AppointmentStatus::parse(""), None);
}

#[test]
fn transitions_deserialize_from_their_camel_case_names() {
    for (text, expected) in [
        ("start", AppointmentTransition::Start),
        ("complete", AppointmentTransition::Complete),
        ("markNoShow", AppointmentTransition::MarkNoShow),
        ("cancel", AppointmentTransition::Cancel),
        ("reopen", AppointmentTransition::Reopen),
    ] {
        let parsed: AppointmentTransition = serde_json::from_value(json!(text)).unwrap();
        assert_eq!(parsed, expected);
    }
    assert!(serde_json::from_value::<AppointmentTransition>(json!("mark_no_show")).is_err());
}

#[test]
fn inputs_deserialize_from_camel_case() {
    let input: AppointmentInput = serde_json::from_value(json!({
        "clientId": 1, "serviceId": 2, "resourceId": 3,
        "startsAt": "2026-11-12T10:00", "notes": null
    }))
    .unwrap();
    let movement: AppointmentMove = serde_json::from_value(json!({
        "id": 7, "startsAt": "2026-11-12T11:00", "resourceId": 2
    }))
    .unwrap();
    let request: AppointmentTransitionRequest =
        serde_json::from_value(json!({"id": 7, "transition": "markNoShow"})).unwrap();
    let range: AppointmentRange = serde_json::from_value(json!({
        "from": "2026-11-09", "to": "2026-11-15", "resourceId": null
    }))
    .unwrap();

    assert_eq!(input.client_id, 1);
    assert_eq!(input.notes, None);
    assert_eq!((movement.id, movement.resource_id), (7, 2));
    assert_eq!(request.transition, AppointmentTransition::MarkNoShow);
    assert_eq!(range.resource_id, None);
}

#[test]
fn inputs_reject_missing_fields_and_wrong_types() {
    assert!(serde_json::from_value::<AppointmentInput>(json!({"clientId": 1})).is_err());
    assert!(serde_json::from_value::<AppointmentRange>(
        json!({"from": "2026-11-09", "resourceId": null})
    )
    .is_err());
    assert!(serde_json::from_value::<AppointmentMove>(
        json!({"id": "7", "startsAt": "x", "resourceId": 1})
    )
    .is_err());
}

#[test]
fn summary_serializes_camel_case() {
    let summary = AppointmentSummary {
        id: 5,
        client_id: 4,
        service_id: 1,
        resource_id: 1,
        starts_at: "2026-11-13T16:00".into(),
        ends_at: "2026-11-13T17:00".into(),
        status: AppointmentStatus::Scheduled,
        price_cents_snapshot: 3500,
        duration_min_snapshot: 60,
        notes: None,
    };

    assert_eq!(
        serde_json::to_value(summary).unwrap(),
        json!({
            "id": 5, "clientId": 4, "serviceId": 1, "resourceId": 1,
            "startsAt": "2026-11-13T16:00", "endsAt": "2026-11-13T17:00",
            "status": "scheduled", "priceCentsSnapshot": 3500,
            "durationMinSnapshot": 60, "notes": null
        })
    );
}

#[test]
fn validation_keeps_the_field() {
    let error = AppError::from(AppointmentError::Validation { field: "startsAt" });

    assert_eq!(error.code, AppErrorCode::Validation);
    assert_eq!(error.field.as_deref(), Some("startsAt"));
}

#[test]
fn domain_failures_map_to_their_specific_errors() {
    assert_eq!(
        AppError::from(AppointmentError::NotFound),
        AppError::appointment_not_found()
    );
    assert_eq!(
        AppError::from(AppointmentError::ReferenceMissing { field: "clientId" }),
        AppError::missing_reference("clientId")
    );
    assert_eq!(
        AppError::from(AppointmentError::ResourceInactive),
        AppError::resource_inactive()
    );
    assert_eq!(
        AppError::from(AppointmentError::Overlap {
            conflicting_ids: vec![3, 8]
        }),
        AppError::overlap(vec![3, 8])
    );
    assert_eq!(
        AppError::from(AppointmentError::CrossesMidnight),
        AppError::crosses_midnight()
    );
    assert_eq!(
        AppError::from(AppointmentError::InvalidTransition),
        AppError::invalid_transition()
    );
}

#[test]
fn database_and_auth_failures_keep_their_generic_errors() {
    assert_eq!(
        AppError::from(AppointmentError::Db(DbError::OperationPanicked)),
        AppError::internal()
    );
    assert_eq!(
        AppError::from(AppointmentError::Auth(AuthError::Forbidden)),
        AppError::forbidden()
    );
}
