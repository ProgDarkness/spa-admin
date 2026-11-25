use serde_json::json;

use super::*;
use crate::features::appointments::model::AppointmentStatus;
use crate::features::audit::{AuditAction, AuditEntity};
use crate::features::payments::fixture_test::{
    appointment_with_status, audit_rows, diff_of, execute, fixture, pay, stored, try_void_at, usd,
    FAIL_AUDIT_INSERTS, NOW,
};

const VOID_NOW: &str = "2026-11-12T12:15";

fn paid_fixture() -> (crate::features::appointments::fixture_test::Fixture, i64) {
    let fixture = fixture();
    let appointment = appointment_with_status(&fixture, AppointmentStatus::Completed);
    let payment = pay(&fixture, &usd(appointment, 3500));
    (fixture, payment.id)
}

#[test]
fn voiding_stores_when_who_and_the_trimmed_reason() {
    let (fixture, payment) = paid_fixture();

    let voided = try_void_at(&fixture, payment, "  Monto digitado por error \n", VOID_NOW).unwrap();

    assert_eq!(voided.voided_at.as_deref(), Some(VOID_NOW));
    assert_eq!(voided.voided_by, Some(fixture.actor));
    assert_eq!(
        voided.void_reason.as_deref(),
        Some("Monto digitado por error")
    );
    assert_eq!(voided.amount_cents, 3500);
    assert_eq!(voided.paid_at, NOW);
    assert_eq!(stored(&fixture, payment), voided);
}

#[test]
fn an_invalid_reason_is_rejected_on_the_reason_field_and_the_payment_stays_active() {
    for reason in [
        "",
        "   ",
        "\t\n",
        &"a".repeat(201),
        "con\u{0000}nulo",
        "dos\nlineas",
    ] {
        let (fixture, payment) = paid_fixture();

        let outcome = try_void_at(&fixture, payment, reason, VOID_NOW);

        assert!(
            matches!(outcome, Err(PaymentError::Validation { field: "reason" })),
            "{reason:?}"
        );
        assert_eq!(stored(&fixture, payment).voided_at, None);
    }
}

#[test]
fn a_reason_of_exactly_two_hundred_characters_is_accepted() {
    let (fixture, payment) = paid_fixture();

    let voided = try_void_at(&fixture, payment, &"🙂".repeat(200), VOID_NOW).unwrap();

    assert_eq!(voided.void_reason.unwrap().chars().count(), 200);
}

#[test]
fn an_unknown_payment_is_not_found() {
    let (fixture, _) = paid_fixture();

    let outcome = try_void_at(&fixture, 404, "error", VOID_NOW);

    assert!(matches!(outcome, Err(PaymentError::NotFound)));
}

#[test]
fn the_reason_is_validated_before_looking_the_payment_up() {
    let (fixture, _) = paid_fixture();

    let outcome = try_void_at(&fixture, 404, "", VOID_NOW);

    assert!(matches!(
        outcome,
        Err(PaymentError::Validation { field: "reason" })
    ));
}

#[test]
fn voiding_twice_reports_already_voided_and_keeps_the_first_void() {
    let (fixture, payment) = paid_fixture();
    let first = try_void_at(&fixture, payment, "primera", VOID_NOW).unwrap();

    let second = try_void_at(&fixture, payment, "segunda", "2026-11-12T13:00");

    assert!(matches!(
        second,
        Err(PaymentError::AlreadyVoided { payment_id }) if payment_id == payment
    ));
    assert_eq!(stored(&fixture, payment), first);
    let voids = audit_rows(&fixture)
        .iter()
        .filter(|entry| entry.action == AuditAction::Void)
        .count();
    assert_eq!(voids, 1);
}

#[test]
fn voiding_audits_a_void_with_the_reason_and_no_amounts() {
    let (fixture, payment) = paid_fixture();

    try_void_at(&fixture, payment, "Monto digitado por error", VOID_NOW).unwrap();

    let entry = audit_rows(&fixture)
        .into_iter()
        .find(|entry| entry.action == AuditAction::Void)
        .unwrap();
    assert_eq!(entry.entity, AuditEntity::Payment);
    assert_eq!(entry.entity_id, Some(payment));
    assert_eq!(entry.actor_user_id, Some(fixture.actor));
    assert_eq!(
        diff_of(&entry),
        json!({
            "voidedAt": { "before": null, "after": VOID_NOW },
            "voidedBy": { "before": null, "after": fixture.actor },
            "voidReason": { "before": null, "after": "Monto digitado por error" }
        })
    );
}

#[test]
fn a_failing_audit_rolls_the_void_back() {
    let (fixture, payment) = paid_fixture();
    execute(&fixture, FAIL_AUDIT_INSERTS);

    let outcome = try_void_at(&fixture, payment, "error", VOID_NOW);

    assert!(matches!(outcome, Err(PaymentError::Db(_))));
    assert_eq!(stored(&fixture, payment).voided_at, None);
}

#[test]
fn an_invalid_clock_value_is_rejected_without_voiding() {
    let (fixture, payment) = paid_fixture();

    let outcome = try_void_at(&fixture, payment, "error", "2026-11-12 12:15");

    assert!(matches!(outcome, Err(PaymentError::Db(_))));
    assert_eq!(stored(&fixture, payment).voided_at, None);
}
