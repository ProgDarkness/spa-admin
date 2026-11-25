use super::*;
use crate::db::DbError;
use crate::features::appointments::fixture_test::{
    audit_rows, create, execute, facial, fixture, Fixture, CABIN_ONE, CABIN_TWO,
};
use crate::features::audit::AuditAction;

const SLOT: &str = "2026-11-12T10:00";
const DURING: &str = "2026-11-12T10:30";
const AT_END: &str = "2026-11-12T11:00";
const JUST_BEFORE_END: &str = "2026-11-12T10:59";
const AFTER: &str = "2026-11-12T12:00";

fn deactivation(id: i64) -> ResourceActivation {
    ResourceActivation { id, active: false }
}

fn reactivation(id: i64) -> ResourceActivation {
    ResourceActivation { id, active: true }
}

fn try_set_active_at(
    fixture: &Fixture,
    activation: &ResourceActivation,
    now: &str,
) -> Result<ResourceSummary, ResourcesError> {
    fixture
        .database
        .with_tx(|tx| set_resource_active_at(tx, fixture.actor, activation, now))
}

fn blocking_ids(result: Result<ResourceSummary, ResourcesError>) -> Vec<i64> {
    match result.unwrap_err() {
        ResourcesError::HasFutureAppointments { appointment_ids } => appointment_ids,
        other => panic!("unexpected {other:?}"),
    }
}

fn is_active(fixture: &Fixture, id: i64) -> bool {
    fixture
        .database
        .with_conn(|conn| repository::find_resource(conn, id))
        .unwrap()
        .unwrap()
        .active
}

fn set_status(fixture: &Fixture, id: i64, status: &str) {
    execute(
        fixture,
        &format!("UPDATE appointments SET status = '{status}' WHERE id = {id}"),
    );
}

#[test]
fn a_future_scheduled_appointment_blocks_the_deactivation_and_lists_its_id() {
    let fixture = fixture();
    let blocker = create(&fixture, &facial(CABIN_ONE, "2026-11-14T10:00"));

    let result = try_set_active_at(&fixture, &deactivation(CABIN_ONE), AFTER);

    assert_eq!(blocking_ids(result), vec![blocker.id]);
    assert!(is_active(&fixture, CABIN_ONE));
    assert!(audit_rows(&fixture)
        .iter()
        .all(|row| row.action == AuditAction::Create));
}

#[test]
fn every_blocking_id_is_listed_ordered_by_start() {
    let fixture = fixture();
    let later = create(&fixture, &facial(CABIN_ONE, "2026-11-15T10:00"));
    let sooner = create(&fixture, &facial(CABIN_ONE, "2026-11-14T10:00"));

    let result = try_set_active_at(&fixture, &deactivation(CABIN_ONE), AFTER);

    assert_eq!(blocking_ids(result), vec![sooner.id, later.id]);
}

#[test]
fn a_scheduled_appointment_already_underway_but_unclosed_still_blocks() {
    let fixture = fixture();
    let underway = create(&fixture, &facial(CABIN_ONE, SLOT));

    let result = try_set_active_at(&fixture, &deactivation(CABIN_ONE), DURING);

    assert_eq!(blocking_ids(result), vec![underway.id]);
}

#[test]
fn the_guard_releases_exactly_when_the_appointment_ends() {
    let fixture = fixture();
    create(&fixture, &facial(CABIN_ONE, SLOT));

    let one_minute_before = try_set_active_at(&fixture, &deactivation(CABIN_ONE), JUST_BEFORE_END);
    let at_the_end = try_set_active_at(&fixture, &deactivation(CABIN_ONE), AT_END);

    assert_eq!(blocking_ids(one_minute_before).len(), 1);
    assert!(!at_the_end.unwrap().active);
}

#[test]
fn past_appointments_do_not_block() {
    let fixture = fixture();
    create(&fixture, &facial(CABIN_ONE, "2026-11-01T10:00"));

    let result = try_set_active_at(&fixture, &deactivation(CABIN_ONE), AFTER);

    assert!(!result.unwrap().active);
}

#[test]
fn appointments_in_any_other_status_do_not_block() {
    for status in ["in_progress", "completed", "cancelled", "no_show"] {
        let fixture = fixture();
        let future = create(&fixture, &facial(CABIN_ONE, "2026-11-14T10:00"));
        set_status(&fixture, future.id, status);

        let result = try_set_active_at(&fixture, &deactivation(CABIN_ONE), AFTER);

        assert!(!result.unwrap().active, "{status}");
    }
}

#[test]
fn appointments_of_another_resource_do_not_block() {
    let fixture = fixture();
    create(&fixture, &facial(CABIN_TWO, "2026-11-14T10:00"));

    let result = try_set_active_at(&fixture, &deactivation(CABIN_ONE), AFTER);

    assert!(!result.unwrap().active);
}

#[test]
fn cancelling_the_blocker_unblocks_and_the_deactivation_is_audited() {
    let fixture = fixture();
    let blocker = create(&fixture, &facial(CABIN_ONE, "2026-11-14T10:00"));
    assert!(try_set_active_at(&fixture, &deactivation(CABIN_ONE), AFTER).is_err());
    set_status(&fixture, blocker.id, "cancelled");

    let result = try_set_active_at(&fixture, &deactivation(CABIN_ONE), AFTER);

    assert!(!result.unwrap().active);
    let last = audit_rows(&fixture).pop().unwrap();
    assert_eq!(last.action, AuditAction::Deactivate);
    assert_eq!(last.entity_id, Some(CABIN_ONE));
}

#[test]
fn reactivating_is_never_blocked_by_appointments() {
    let fixture = fixture();
    create(&fixture, &facial(CABIN_ONE, "2026-11-14T10:00"));
    execute(&fixture, "UPDATE resources SET active = 0 WHERE id = 1");

    let result = try_set_active_at(&fixture, &reactivation(CABIN_ONE), AFTER);

    assert!(result.unwrap().active);
}

#[test]
fn deactivating_an_already_inactive_resource_changes_and_audits_nothing() {
    let fixture = fixture();
    create(&fixture, &facial(CABIN_ONE, "2026-11-14T10:00"));
    execute(&fixture, "UPDATE resources SET active = 0 WHERE id = 1");
    let audits = audit_rows(&fixture).len();

    let result = try_set_active_at(&fixture, &deactivation(CABIN_ONE), AFTER);

    assert!(!result.unwrap().active);
    assert_eq!(audit_rows(&fixture).len(), audits);
}

#[test]
fn an_invalid_clock_value_fails_closed_without_deactivating() {
    let fixture = fixture();

    for bad_now in ["", "now", "2026-11-12 12:00", "2026-11-12T12:00:00"] {
        let result = try_set_active_at(&fixture, &deactivation(CABIN_ONE), bad_now);

        assert!(
            matches!(result, Err(ResourcesError::Db(DbError::InvalidLocalMinute))),
            "{bad_now:?}"
        );
    }
    assert!(is_active(&fixture, CABIN_ONE));
}

#[test]
fn an_unknown_resource_is_still_a_validation_error_on_the_id() {
    let fixture = fixture();

    let result = try_set_active_at(&fixture, &deactivation(99), AFTER);

    assert!(matches!(
        result,
        Err(ResourcesError::Validation { field: "id" })
    ));
}

#[test]
fn the_clock_reading_wrapper_blocks_on_appointments_far_in_the_future() {
    let fixture = fixture();
    let blocker = create(&fixture, &facial(CABIN_ONE, "2099-01-02T10:00"));

    let blocked = fixture
        .database
        .with_tx(|tx| set_resource_active(tx, fixture.actor, &deactivation(CABIN_ONE)));
    let free = fixture
        .database
        .with_tx(|tx| set_resource_active(tx, fixture.actor, &deactivation(CABIN_TWO)));

    assert_eq!(blocking_ids(blocked), vec![blocker.id]);
    assert!(!free.unwrap().active);
}

#[test]
fn listing_the_future_appointments_returns_the_same_set_that_blocks() {
    let fixture = fixture();
    let later = create(&fixture, &facial(CABIN_ONE, "2026-11-15T10:00"));
    let sooner = create(&fixture, &facial(CABIN_ONE, "2026-11-14T10:00"));
    create(&fixture, &facial(CABIN_ONE, "2026-11-01T10:00"));
    create(&fixture, &facial(CABIN_TWO, "2026-11-14T10:00"));

    let listed = fixture
        .database
        .with_conn_mapped(|conn| list_future_appointments_at(conn, CABIN_ONE, AFTER))
        .unwrap();

    let ids: Vec<i64> = listed.iter().map(|appointment| appointment.id).collect();
    assert_eq!(ids, vec![sooner.id, later.id]);
    assert_eq!(listed[0].starts_at, "2026-11-14T10:00");
}

#[test]
fn listing_the_future_appointments_of_an_unknown_resource_is_a_validation_error() {
    let fixture = fixture();

    let result = fixture
        .database
        .with_conn_mapped(|conn| list_future_appointments_at(conn, 99, AFTER));

    assert!(matches!(
        result,
        Err(ResourcesError::Validation { field: "id" })
    ));
}

#[test]
fn listing_the_future_appointments_fails_closed_on_an_invalid_clock_value() {
    let fixture = fixture();

    let result = fixture
        .database
        .with_conn_mapped(|conn| list_future_appointments_at(conn, CABIN_ONE, "later"));

    assert!(matches!(
        result,
        Err(ResourcesError::Db(DbError::InvalidLocalMinute))
    ));
}

#[test]
fn the_clock_reading_list_wrapper_returns_far_future_appointments() {
    let fixture = fixture();
    let far = create(&fixture, &facial(CABIN_ONE, "2099-01-02T10:00"));

    let listed = fixture
        .database
        .with_conn_mapped(|conn| list_future_appointments(conn, CABIN_ONE))
        .unwrap();

    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, far.id);
}
