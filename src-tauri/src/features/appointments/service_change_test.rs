use serde_json::json;

use super::*;
use crate::db::DbError;
use crate::features::appointments::fixture_test::{
    audit_rows, create, diff_of, execute, facial, fixture, input, stored, Fixture, ACTIVE_CLIENT,
    CABIN_ONE, CABIN_TWO, FAIL_AUDIT_INSERTS, INACTIVE_RESOURCE,
};
use crate::features::appointments::model::{
    AppointmentMove, AppointmentStatus, AppointmentTransition, AppointmentTransitionRequest,
};
use crate::features::audit::{AuditAction, AuditEntity};

const SLOT: &str = "2026-11-12T10:00";
const AFTER_START: &str = "2026-11-12T10:30";
const BEFORE_START: &str = "2026-11-12T09:00";

fn movement(id: i64, starts_at: &str, resource_id: i64) -> AppointmentMove {
    AppointmentMove {
        id,
        starts_at: starts_at.to_string(),
        resource_id,
    }
}

fn try_move(
    fixture: &Fixture,
    request: &AppointmentMove,
) -> Result<AppointmentSummary, AppointmentError> {
    fixture
        .database
        .with_tx(|tx| move_appointment(tx, fixture.actor, request))
}

fn try_transition(
    fixture: &Fixture,
    id: i64,
    transition: AppointmentTransition,
    now: &str,
) -> Result<AppointmentSummary, AppointmentError> {
    let request = AppointmentTransitionRequest { id, transition };
    fixture
        .database
        .with_tx(|tx| transition_appointment_at(tx, fixture.actor, &request, now))
}

fn force_status(fixture: &Fixture, id: i64, status: AppointmentStatus) {
    execute(
        fixture,
        &format!(
            "UPDATE appointments SET status = '{}' WHERE id = {id}",
            status.as_str()
        ),
    );
}

fn failure_of(result: Result<AppointmentSummary, AppointmentError>) -> String {
    match result.unwrap_err() {
        AppointmentError::Validation { field } => format!("validation:{field}"),
        AppointmentError::ReferenceMissing { field } => format!("missing:{field}"),
        AppointmentError::Overlap { conflicting_ids } => format!("overlap:{conflicting_ids:?}"),
        AppointmentError::NotFound => "notFound".to_string(),
        AppointmentError::ResourceInactive => "resourceInactive".to_string(),
        AppointmentError::CrossesMidnight => "crossesMidnight".to_string(),
        AppointmentError::InvalidTransition => "invalidTransition".to_string(),
        other => format!("{other:?}"),
    }
}

#[test]
fn moving_changes_resource_and_time_keeping_the_frozen_duration_and_snapshots() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));
    execute(
        &fixture,
        "UPDATE services SET price_cents = 9900, duration_min = 120 WHERE id = 1",
    );

    let moved = try_move(
        &fixture,
        &movement(created.id, "2026-11-13T15:00", CABIN_TWO),
    )
    .unwrap();

    assert_eq!(moved.resource_id, CABIN_TWO);
    assert_eq!(moved.starts_at, "2026-11-13T15:00");
    assert_eq!(moved.ends_at, "2026-11-13T16:00");
    assert_eq!(moved.price_cents_snapshot, 3500);
    assert_eq!(moved.status, AppointmentStatus::Scheduled);
    assert_eq!(stored(&fixture, created.id), moved);
}

#[test]
fn moving_audits_an_update_with_only_the_changed_fields() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));

    try_move(
        &fixture,
        &movement(created.id, "2026-11-12T14:00", CABIN_TWO),
    )
    .unwrap();

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1].action, AuditAction::Update);
    assert_eq!(rows[1].entity, AuditEntity::Appointment);
    assert_eq!(rows[1].entity_id, Some(created.id));
    assert_eq!(rows[1].actor_user_id, Some(fixture.actor));
    assert_eq!(
        diff_of(&rows[1]),
        json!({
            "resourceId": { "before": 1, "after": 2 },
            "startsAt": { "before": SLOT, "after": "2026-11-12T14:00" },
            "endsAt": { "before": "2026-11-12T11:00", "after": "2026-11-12T15:00" }
        })
    );
}

#[test]
fn moving_onto_the_same_slot_changes_and_audits_nothing() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));

    let unchanged = try_move(&fixture, &movement(created.id, SLOT, CABIN_ONE)).unwrap();

    assert_eq!(unchanged, created);
    assert_eq!(audit_rows(&fixture).len(), 1);
}

#[test]
fn an_appointment_can_shift_over_part_of_its_own_slot() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));

    let moved = try_move(&fixture, &movement(created.id, AFTER_START, CABIN_ONE)).unwrap();

    assert_eq!(moved.starts_at, AFTER_START);
    assert_eq!(moved.ends_at, "2026-11-12T11:30");
}

#[test]
fn only_scheduled_appointments_can_move() {
    for status in [
        AppointmentStatus::InProgress,
        AppointmentStatus::Completed,
        AppointmentStatus::Cancelled,
        AppointmentStatus::NoShow,
    ] {
        let fixture = fixture();
        let created = create(&fixture, &facial(CABIN_ONE, SLOT));
        force_status(&fixture, created.id, status);

        let result = try_move(
            &fixture,
            &movement(created.id, "2026-11-13T10:00", CABIN_ONE),
        );

        assert_eq!(failure_of(result), "invalidTransition", "{status:?}");
        assert_eq!(stored(&fixture, created.id).starts_at, SLOT);
    }
}

#[test]
fn a_missing_appointment_is_not_found() {
    let fixture = fixture();

    let result = try_move(&fixture, &movement(99, SLOT, CABIN_ONE));

    assert_eq!(failure_of(result), "notFound");
}

#[test]
fn input_validation_runs_before_the_lookup() {
    let fixture = fixture();

    assert_eq!(
        failure_of(try_move(&fixture, &movement(99, "bad", CABIN_ONE))),
        "validation:startsAt"
    );
    assert_eq!(
        failure_of(try_move(&fixture, &movement(99, SLOT, 0))),
        "validation:resourceId"
    );
    assert_eq!(
        failure_of(try_move(&fixture, &movement(99, "2026-11-12T10:03", 1))),
        "validation:startsAt"
    );
}

#[test]
fn the_state_check_comes_before_the_resource_checks() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));
    force_status(&fixture, created.id, AppointmentStatus::Completed);

    let result = try_move(&fixture, &movement(created.id, SLOT, INACTIVE_RESOURCE));

    assert_eq!(failure_of(result), "invalidTransition");
}

#[test]
fn moving_to_an_inactive_or_missing_resource_is_rejected() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));

    let inactive = try_move(&fixture, &movement(created.id, SLOT, INACTIVE_RESOURCE));
    let missing = try_move(&fixture, &movement(created.id, SLOT, 99));

    assert_eq!(failure_of(inactive), "resourceInactive");
    assert_eq!(failure_of(missing), "missing:resourceId");
}

#[test]
fn moving_across_midnight_is_rejected_before_any_overlap() {
    let fixture = fixture();
    create(&fixture, &facial(CABIN_TWO, "2026-11-12T23:00"));
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));

    let result = try_move(
        &fixture,
        &movement(created.id, "2026-11-12T23:30", CABIN_TWO),
    );

    assert_eq!(failure_of(result), "crossesMidnight");
}

#[test]
fn moving_into_an_ending_exactly_at_midnight_is_accepted() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));

    let moved = try_move(
        &fixture,
        &movement(created.id, "2026-11-12T23:00", CABIN_ONE),
    )
    .unwrap();

    assert_eq!(moved.ends_at, "2026-11-13T00:00");
}

#[test]
fn moving_onto_another_appointment_reports_its_id() {
    let fixture = fixture();
    let other = create(&fixture, &facial(CABIN_TWO, "2026-11-12T14:00"));
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));

    let result = try_move(
        &fixture,
        &movement(created.id, "2026-11-12T14:30", CABIN_TWO),
    );

    assert_eq!(failure_of(result), format!("overlap:{:?}", vec![other.id]));
    assert_eq!(stored(&fixture, created.id).resource_id, CABIN_ONE);
}

#[test]
fn a_failing_audit_rolls_the_move_back() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));
    execute(&fixture, FAIL_AUDIT_INSERTS);

    let result = try_move(
        &fixture,
        &movement(created.id, "2026-11-13T10:00", CABIN_ONE),
    );

    assert!(matches!(result, Err(AppointmentError::Db(_))));
    assert_eq!(stored(&fixture, created.id), created);
}

#[test]
fn each_transition_leads_to_its_target_status_and_audits_the_status_change() {
    let cases = [
        (
            AppointmentTransition::Start,
            AppointmentStatus::InProgress,
            "in_progress",
        ),
        (
            AppointmentTransition::Cancel,
            AppointmentStatus::Cancelled,
            "cancelled",
        ),
        (
            AppointmentTransition::MarkNoShow,
            AppointmentStatus::NoShow,
            "no_show",
        ),
        (
            AppointmentTransition::Complete,
            AppointmentStatus::Completed,
            "completed",
        ),
    ];
    for (transition, expected, stored_text) in cases {
        let fixture = fixture();
        let created = create(&fixture, &facial(CABIN_ONE, SLOT));

        let after = try_transition(&fixture, created.id, transition, AFTER_START).unwrap();

        assert_eq!(after.status, expected);
        let rows = audit_rows(&fixture);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].action, AuditAction::Update);
        assert_eq!(rows[1].entity_id, Some(created.id));
        assert_eq!(
            diff_of(&rows[1]),
            json!({ "status": { "before": "scheduled", "after": stored_text } })
        );
    }
}

#[test]
fn invalid_transitions_are_rejected_without_changes_or_audit() {
    let cases = [
        (AppointmentStatus::Completed, AppointmentTransition::Start),
        (AppointmentStatus::Completed, AppointmentTransition::Cancel),
        (
            AppointmentStatus::Cancelled,
            AppointmentTransition::Complete,
        ),
        (AppointmentStatus::NoShow, AppointmentTransition::MarkNoShow),
        (
            AppointmentStatus::InProgress,
            AppointmentTransition::MarkNoShow,
        ),
        (AppointmentStatus::InProgress, AppointmentTransition::Start),
        (AppointmentStatus::InProgress, AppointmentTransition::Reopen),
        (AppointmentStatus::Scheduled, AppointmentTransition::Reopen),
    ];
    for (status, transition) in cases {
        let fixture = fixture();
        let created = create(&fixture, &facial(CABIN_ONE, SLOT));
        force_status(&fixture, created.id, status);

        let result = try_transition(&fixture, created.id, transition, AFTER_START);

        assert_eq!(
            failure_of(result),
            "invalidTransition",
            "{status:?} {transition:?}"
        );
        assert_eq!(stored(&fixture, created.id).status, status);
        assert_eq!(audit_rows(&fixture).len(), 1);
    }
}

#[test]
fn completing_a_scheduled_appointment_needs_its_start_to_have_arrived() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));

    let early = try_transition(
        &fixture,
        created.id,
        AppointmentTransition::Complete,
        BEFORE_START,
    );
    let on_time = try_transition(&fixture, created.id, AppointmentTransition::Complete, SLOT);

    assert_eq!(failure_of(early), "invalidTransition");
    assert_eq!(on_time.unwrap().status, AppointmentStatus::Completed);
}

#[test]
fn completing_an_appointment_in_progress_ignores_the_clock() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));
    try_transition(
        &fixture,
        created.id,
        AppointmentTransition::Start,
        AFTER_START,
    )
    .unwrap();

    let done = try_transition(
        &fixture,
        created.id,
        AppointmentTransition::Complete,
        BEFORE_START,
    );

    assert_eq!(done.unwrap().status, AppointmentStatus::Completed);
}

#[test]
fn transitioning_a_missing_appointment_is_not_found() {
    let fixture = fixture();

    let result = try_transition(&fixture, 99, AppointmentTransition::Start, SLOT);

    assert_eq!(failure_of(result), "notFound");
}

#[test]
fn an_invalid_clock_value_fails_closed_without_touching_the_appointment() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));

    for bad_now in ["", "now", "2026-11-12 10:30", "2026-11-12T10:30:00"] {
        let result = try_transition(&fixture, created.id, AppointmentTransition::Cancel, bad_now);

        assert!(
            matches!(
                result,
                Err(AppointmentError::Db(DbError::InvalidLocalMinute))
            ),
            "{bad_now:?}"
        );
    }
    assert_eq!(stored(&fixture, created.id), created);
}

#[test]
fn the_clock_reading_wrapper_runs_a_transition() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, "2020-01-02T08:00"));
    let request = AppointmentTransitionRequest {
        id: created.id,
        transition: AppointmentTransition::Complete,
    };

    let done = fixture
        .database
        .with_tx(|tx| transition_appointment(tx, fixture.actor, &request))
        .unwrap();

    assert_eq!(done.status, AppointmentStatus::Completed);
}

#[test]
fn reopening_a_final_appointment_returns_it_to_scheduled_and_audits_the_update() {
    for status in [
        AppointmentStatus::Completed,
        AppointmentStatus::Cancelled,
        AppointmentStatus::NoShow,
    ] {
        let fixture = fixture();
        let created = create(&fixture, &facial(CABIN_ONE, SLOT));
        force_status(&fixture, created.id, status);

        let reopened = try_transition(
            &fixture,
            created.id,
            AppointmentTransition::Reopen,
            AFTER_START,
        )
        .unwrap();

        assert_eq!(reopened.status, AppointmentStatus::Scheduled);
        let rows = audit_rows(&fixture);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].action, AuditAction::Update);
        assert_eq!(
            diff_of(&rows[1]),
            json!({ "status": { "before": status.as_str(), "after": "scheduled" } })
        );
    }
}

#[test]
fn reopening_into_a_taken_slot_is_an_overlap_with_the_blocking_ids() {
    let fixture = fixture();
    let cancelled = create(&fixture, &facial(CABIN_ONE, SLOT));
    force_status(&fixture, cancelled.id, AppointmentStatus::Cancelled);
    let replacement = create(
        &fixture,
        &input(ACTIVE_CLIENT, 3, CABIN_ONE, "2026-11-12T10:30"),
    );

    let result = try_transition(
        &fixture,
        cancelled.id,
        AppointmentTransition::Reopen,
        AFTER_START,
    );

    assert_eq!(
        failure_of(result),
        format!("overlap:{:?}", vec![replacement.id])
    );
    assert_eq!(
        stored(&fixture, cancelled.id).status,
        AppointmentStatus::Cancelled
    );
}

#[test]
fn reopening_ignores_other_cancelled_appointments_on_the_same_slot() {
    let fixture = fixture();
    let first = create(&fixture, &facial(CABIN_ONE, SLOT));
    force_status(&fixture, first.id, AppointmentStatus::Cancelled);
    let second = create(&fixture, &facial(CABIN_ONE, SLOT));
    force_status(&fixture, second.id, AppointmentStatus::NoShow);

    let reopened = try_transition(
        &fixture,
        first.id,
        AppointmentTransition::Reopen,
        AFTER_START,
    );

    assert_eq!(reopened.unwrap().status, AppointmentStatus::Scheduled);
}

#[test]
fn reopening_a_future_appointment_on_an_inactive_resource_is_rejected() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, "2026-11-20T10:00"));
    force_status(&fixture, created.id, AppointmentStatus::Cancelled);
    execute(&fixture, "UPDATE resources SET active = 0 WHERE id = 1");

    let result = try_transition(
        &fixture,
        created.id,
        AppointmentTransition::Reopen,
        AFTER_START,
    );

    assert_eq!(failure_of(result), "resourceInactive");
}

#[test]
fn reopening_a_past_appointment_on_an_inactive_resource_is_allowed() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));
    force_status(&fixture, created.id, AppointmentStatus::Completed);
    execute(&fixture, "UPDATE resources SET active = 0 WHERE id = 1");

    let result = try_transition(
        &fixture,
        created.id,
        AppointmentTransition::Reopen,
        "2026-11-12T11:00",
    );

    assert_eq!(result.unwrap().status, AppointmentStatus::Scheduled);
}

#[test]
fn a_failing_audit_rolls_the_transition_back() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));
    execute(&fixture, FAIL_AUDIT_INSERTS);

    let result = try_transition(
        &fixture,
        created.id,
        AppointmentTransition::Cancel,
        AFTER_START,
    );

    assert!(matches!(result, Err(AppointmentError::Db(_))));
    assert_eq!(stored(&fixture, created.id), created);
}

#[test]
fn moving_onto_its_own_slot_is_a_no_op_even_if_the_resource_became_inactive() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));
    execute(&fixture, "UPDATE resources SET active = 0 WHERE id = 1");

    let same = try_move(&fixture, &movement(created.id, SLOT, CABIN_ONE));
    let different_time = try_move(&fixture, &movement(created.id, AFTER_START, CABIN_ONE));

    assert_eq!(same.unwrap(), created);
    assert_eq!(failure_of(different_time), "resourceInactive");
    assert_eq!(audit_rows(&fixture).len(), 1);
}

#[test]
fn a_shifted_slot_ignores_the_appointment_itself_but_not_its_neighbours() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));
    let neighbour = create(&fixture, &facial(CABIN_ONE, "2026-11-12T11:00"));

    let overlapping_itself = try_move(
        &fixture,
        &movement(created.id, "2026-11-12T09:30", CABIN_ONE),
    );
    let onto_neighbour = try_move(
        &fixture,
        &movement(created.id, "2026-11-12T10:30", CABIN_ONE),
    );

    assert!(overlapping_itself.is_ok());
    assert_eq!(
        failure_of(onto_neighbour),
        format!("overlap:{:?}", vec![neighbour.id])
    );
}

#[test]
fn reopening_on_an_inactive_resource_is_allowed_exactly_at_the_end_minute_and_not_one_before() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));
    force_status(&fixture, created.id, AppointmentStatus::Cancelled);
    execute(&fixture, "UPDATE resources SET active = 0 WHERE id = 1");

    let one_before = try_transition(
        &fixture,
        created.id,
        AppointmentTransition::Reopen,
        "2026-11-12T10:59",
    );
    let at_the_end = try_transition(
        &fixture,
        created.id,
        AppointmentTransition::Reopen,
        "2026-11-12T11:00",
    );

    assert_eq!(failure_of(one_before), "resourceInactive");
    assert_eq!(at_the_end.unwrap().status, AppointmentStatus::Scheduled);
}

#[test]
fn reopening_with_an_exact_start_equal_clock_checks_the_slot_on_an_active_resource() {
    let fixture = fixture();
    let created = create(&fixture, &facial(CABIN_ONE, SLOT));
    force_status(&fixture, created.id, AppointmentStatus::NoShow);

    let reopened = try_transition(&fixture, created.id, AppointmentTransition::Reopen, SLOT);

    assert_eq!(reopened.unwrap().status, AppointmentStatus::Scheduled);
}
