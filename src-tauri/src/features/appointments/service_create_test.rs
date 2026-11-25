use serde_json::json;

use super::*;
use crate::features::appointments::fixture_test::{
    appointment_count, audit_rows, create, diff_of, execute, facial, fixture, input, stored,
    try_create, ACTIVE_CLIENT, ACTIVE_SERVICE, CABIN_ONE, CABIN_TWO, DELETED_CLIENT,
    FAIL_AUDIT_INSERTS, INACTIVE_RESOURCE, INACTIVE_SERVICE,
};
use crate::features::appointments::model::AppointmentStatus;
use crate::features::audit::{AuditAction, AuditEntity};

const SLOT: &str = "2026-11-12T10:00";

fn code_of(result: Result<AppointmentSummary, AppointmentError>) -> String {
    match result.unwrap_err() {
        AppointmentError::Validation { field } => format!("validation:{field}"),
        AppointmentError::ReferenceMissing { field } => format!("missing:{field}"),
        AppointmentError::ResourceInactive => "resourceInactive".to_string(),
        AppointmentError::CrossesMidnight => "crossesMidnight".to_string(),
        AppointmentError::Overlap { conflicting_ids } => format!("overlap:{conflicting_ids:?}"),
        other => format!("{other:?}"),
    }
}

#[test]
fn creates_a_scheduled_appointment_with_snapshots_and_a_computed_end() {
    let fixture = fixture();

    let created = create(&fixture, &facial(CABIN_ONE, SLOT));

    assert_eq!(created.status, AppointmentStatus::Scheduled);
    assert_eq!(created.starts_at, SLOT);
    assert_eq!(created.ends_at, "2026-11-12T11:00");
    assert_eq!(created.price_cents_snapshot, 3500);
    assert_eq!(created.duration_min_snapshot, 60);
    assert_eq!(created.notes, None);
    assert_eq!(stored(&fixture, created.id), created);
}

#[test]
fn an_appointment_in_the_past_is_accepted() {
    let fixture = fixture();

    let created = create(&fixture, &facial(CABIN_ONE, "2020-01-02T08:00"));

    assert_eq!(created.starts_at, "2020-01-02T08:00");
}

#[test]
fn later_service_changes_never_touch_existing_appointments() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));

    execute(
        &fixture,
        "UPDATE services SET price_cents = 9900, duration_min = 120 WHERE id = 1",
    );

    let after = stored(&fixture, created.id);
    assert_eq!(after.price_cents_snapshot, 3500);
    assert_eq!(after.duration_min_snapshot, 60);
    assert_eq!(after.ends_at, "2026-11-12T11:00");
    let next = create(&fixture, &facial(CABIN_ONE, "2026-11-12T14:00"));
    assert_eq!(next.price_cents_snapshot, 9900);
    assert_eq!(next.ends_at, "2026-11-12T16:00");
}

#[test]
fn notes_are_trimmed_and_blank_notes_become_none() {
    let fixture = fixture();
    let mut request = facial(CABIN_ONE, SLOT);
    request.notes = Some("  traer bata \n".to_string());
    let trimmed = try_create(&fixture, &request);
    request.notes = Some("   ".to_string());
    request.starts_at = "2026-11-12T12:00".to_string();
    let blank = try_create(&fixture, &request);

    assert_eq!(trimmed.unwrap().notes.as_deref(), Some("traer bata"));
    assert_eq!(blank.unwrap().notes, None);
}

#[test]
fn notes_accept_exactly_five_hundred_characters_counting_emoji_once() {
    let fixture = fixture();
    let mut request = facial(CABIN_ONE, SLOT);
    request.notes = Some("🙂".repeat(500));

    assert!(try_create(&fixture, &request).is_ok());

    request.starts_at = "2026-11-12T12:00".to_string();
    request.notes = Some("🙂".repeat(501));
    assert_eq!(code_of(try_create(&fixture, &request)), "validation:notes");
}

#[test]
fn notes_with_control_characters_are_rejected() {
    let fixture = fixture();
    for notes in ["a\u{0}b", "a\nb", "a\tb", "a\u{7f}b"] {
        let mut request = facial(CABIN_ONE, SLOT);
        request.notes = Some(notes.to_string());
        assert_eq!(
            code_of(try_create(&fixture, &request)),
            "validation:notes",
            "{notes:?}"
        );
    }
}

#[test]
fn malformed_or_misaligned_starts_are_validation_errors() {
    let fixture = fixture();
    for bad in [
        "",
        "mañana",
        "2026-11-12",
        "2026-11-12 10:00",
        "2026-02-30T10:00",
        "2026-11-12T25:00",
        "2026-11-12T10:03",
        "2026-11-12T10:00:00",
    ] {
        assert_eq!(
            code_of(try_create(&fixture, &facial(CABIN_ONE, bad))),
            "validation:startsAt",
            "{bad:?}"
        );
    }
    assert_eq!(appointment_count(&fixture), 0);
}

#[test]
fn non_positive_ids_are_validation_errors_on_their_own_field() {
    let fixture = fixture();
    let cases = [
        (input(0, ACTIVE_SERVICE, CABIN_ONE, SLOT), "clientId"),
        (input(ACTIVE_CLIENT, -1, CABIN_ONE, SLOT), "serviceId"),
        (input(ACTIVE_CLIENT, ACTIVE_SERVICE, 0, SLOT), "resourceId"),
    ];
    for (request, field) in cases {
        assert_eq!(
            code_of(try_create(&fixture, &request)),
            format!("validation:{field}")
        );
    }
}

#[test]
fn input_validation_runs_before_any_lookup() {
    let fixture = fixture();

    let result = try_create(&fixture, &input(999, 999, 999, "garbage"));

    assert_eq!(code_of(result), "validation:startsAt");
}

#[test]
fn a_missing_or_deleted_client_is_reported_on_the_client_field() {
    let fixture = fixture();

    let missing = try_create(&fixture, &input(999, ACTIVE_SERVICE, CABIN_ONE, SLOT));
    let deleted = try_create(
        &fixture,
        &input(DELETED_CLIENT, ACTIVE_SERVICE, CABIN_ONE, SLOT),
    );

    assert_eq!(code_of(missing), "missing:clientId");
    assert_eq!(code_of(deleted), "missing:clientId");
}

#[test]
fn lookup_errors_follow_the_mock_order() {
    let fixture = fixture();
    let order = [
        (input(999, 999, 999, SLOT), "missing:clientId"),
        (input(ACTIVE_CLIENT, 999, 999, SLOT), "missing:serviceId"),
        (
            input(ACTIVE_CLIENT, INACTIVE_SERVICE, 999, SLOT),
            "missing:resourceId",
        ),
        (
            input(ACTIVE_CLIENT, INACTIVE_SERVICE, INACTIVE_RESOURCE, SLOT),
            "validation:serviceId",
        ),
        (
            input(ACTIVE_CLIENT, ACTIVE_SERVICE, INACTIVE_RESOURCE, SLOT),
            "resourceInactive",
        ),
    ];
    for (request, expected) in order {
        assert_eq!(code_of(try_create(&fixture, &request)), expected);
    }
}

#[test]
fn an_inactive_resource_is_reported_before_the_midnight_and_overlap_checks() {
    let fixture = fixture();

    let result = try_create(&fixture, &facial(INACTIVE_RESOURCE, "2026-11-12T23:30"));

    assert_eq!(code_of(result), "resourceInactive");
}

#[test]
fn an_hour_ending_exactly_at_midnight_is_accepted_but_one_past_is_rejected() {
    let fixture = fixture();

    let allowed = try_create(&fixture, &facial(CABIN_ONE, "2026-11-12T23:00"));
    let rejected = try_create(&fixture, &facial(CABIN_ONE, "2026-11-12T23:30"));

    assert_eq!(allowed.unwrap().ends_at, "2026-11-13T00:00");
    assert_eq!(code_of(rejected), "crossesMidnight");
    assert_eq!(appointment_count(&fixture), 1);
}

#[test]
fn midnight_is_reported_before_an_overlap() {
    let fixture = fixture();
    create(&fixture, &facial(CABIN_ONE, "2026-11-12T23:00"));

    let result = try_create(&fixture, &facial(CABIN_ONE, "2026-11-12T23:30"));

    assert_eq!(code_of(result), "crossesMidnight");
}

#[test]
fn an_overlapping_slot_is_rejected_listing_every_conflicting_appointment() {
    let fixture = fixture();
    let first = create(&fixture, &facial(CABIN_ONE, "2026-11-12T10:00"));
    let second = create(&fixture, &facial(CABIN_ONE, "2026-11-12T11:00"));

    let result = try_create(
        &fixture,
        &input(ACTIVE_CLIENT, 3, CABIN_ONE, "2026-11-12T10:30"),
    );

    assert_eq!(
        code_of(result),
        format!("overlap:{:?}", vec![first.id, second.id])
    );
    assert_eq!(appointment_count(&fixture), 2);
}

#[test]
fn back_to_back_slots_and_other_resources_do_not_conflict() {
    let fixture = fixture();
    create(&fixture, &facial(CABIN_ONE, "2026-11-12T10:00"));

    assert!(try_create(&fixture, &facial(CABIN_ONE, "2026-11-12T11:00")).is_ok());
    assert!(try_create(&fixture, &facial(CABIN_ONE, "2026-11-12T09:00")).is_ok());
    assert!(try_create(&fixture, &facial(CABIN_TWO, "2026-11-12T10:00")).is_ok());
}

#[test]
fn a_cancelled_appointment_frees_its_slot() {
    let fixture = fixture();
    let first = create(&fixture, &facial(CABIN_ONE, SLOT));
    execute(
        &fixture,
        &format!(
            "UPDATE appointments SET status = 'cancelled' WHERE id = {}",
            first.id
        ),
    );

    assert!(try_create(&fixture, &facial(CABIN_ONE, SLOT)).is_ok());
}

#[test]
fn create_audits_a_full_snapshot_attributed_to_the_actor() {
    let fixture = fixture();
    let mut request = facial(CABIN_ONE, SLOT);
    request.notes = Some("alergia".to_string());

    let created = create(&fixture, &request);

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action, AuditAction::Create);
    assert_eq!(rows[0].entity, AuditEntity::Appointment);
    assert_eq!(rows[0].entity_id, Some(created.id));
    assert_eq!(rows[0].actor_user_id, Some(fixture.actor));
    assert_eq!(
        diff_of(&rows[0]),
        json!({
            "clientId": 1, "serviceId": 1, "resourceId": 1,
            "startsAt": SLOT, "endsAt": "2026-11-12T11:00",
            "status": "scheduled", "priceCentsSnapshot": 3500,
            "durationMinSnapshot": 60, "hasNotes": true
        })
    );
}

#[test]
fn a_rejected_creation_audits_nothing() {
    let fixture = fixture();

    let _ = try_create(&fixture, &facial(INACTIVE_RESOURCE, SLOT));
    let _ = try_create(&fixture, &input(999, 1, 1, SLOT));

    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn a_failing_audit_rolls_the_appointment_back() {
    let fixture = fixture();
    execute(&fixture, FAIL_AUDIT_INSERTS);

    let result = try_create(&fixture, &facial(CABIN_ONE, SLOT));

    assert!(matches!(result, Err(AppointmentError::Db(_))));
    assert_eq!(appointment_count(&fixture), 0);
}

#[test]
fn a_duration_outside_one_minute_to_a_full_day_is_rejected_before_reaching_the_database() {
    for bad in [0, -5, 1441, i64::MAX] {
        assert!(
            matches!(
                slot_end(SLOT, bad),
                Err(AppointmentError::Validation {
                    field: "durationMin"
                })
            ),
            "{bad}"
        );
    }
    assert!(slot_end(SLOT, 1).is_ok());
    assert!(slot_end("2026-11-12T00:00", 1440).is_ok());
}
