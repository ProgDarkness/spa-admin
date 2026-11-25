use serde_json::json;

use super::*;
use crate::features::appointments::model::AppointmentStatus;
use crate::features::audit::{AuditAction, AuditEntity};
use crate::features::payments::fixture_test::{
    add_rate, appointment_with_status, audit_rows, diff_of, execute, fixture, pay, payment_count,
    stored, try_pay_at, usd, ves, DAY_RATE, FAIL_AUDIT_INSERTS, NOW,
};
use crate::features::payments::model::{PaymentCurrency, PaymentInput};

fn completed(fixture: &crate::features::appointments::fixture_test::Fixture) -> i64 {
    appointment_with_status(fixture, AppointmentStatus::Completed)
}

fn failure_of(result: Result<PaymentSummary, PaymentError>) -> String {
    match result.unwrap_err() {
        PaymentError::Validation { field } => format!("validation:{field}"),
        PaymentError::ReferenceMissing { field } => format!("missing:{field}"),
        PaymentError::RateMissing => "rateMissing".to_string(),
        other => format!("{other:?}"),
    }
}

#[test]
fn a_usd_payment_is_stored_now_without_rate_and_equal_to_its_amount() {
    let fixture = fixture();
    let appointment = completed(&fixture);

    let created = pay(&fixture, &usd(appointment, 3500));

    assert_eq!(created.currency, PaymentCurrency::Usd);
    assert_eq!(created.amount_cents, 3500);
    assert_eq!(created.rate_bs_per_usd_e4, None);
    assert_eq!(created.usd_equivalent_cents, 3500);
    assert_eq!(created.paid_at, NOW);
    assert_eq!(created.voided_at, None);
    assert_eq!(stored(&fixture, created.id), created);
}

#[test]
fn a_usd_payment_ignores_a_rate_sent_by_the_caller() {
    let fixture = fixture();
    let appointment = completed(&fixture);
    let mut input = usd(appointment, 3500);
    input.rate_bs_per_usd_e4 = Some(DAY_RATE);

    let created = pay(&fixture, &input);

    assert_eq!(created.rate_bs_per_usd_e4, None);
}

#[test]
fn a_ves_payment_with_an_explicit_rate_overrides_the_rate_of_the_day() {
    let fixture = fixture();
    let appointment = completed(&fixture);
    add_rate(&fixture, "2026-11-12", 400_000);

    let created = pay(&fixture, &ves(appointment, 182_500, Some(DAY_RATE)));

    assert_eq!(created.rate_bs_per_usd_e4, Some(DAY_RATE));
    assert_eq!(created.usd_equivalent_cents, 5000);
}

#[test]
fn a_ves_payment_without_rate_uses_the_rate_of_today() {
    let fixture = fixture();
    let appointment = completed(&fixture);
    add_rate(&fixture, "2026-11-12", DAY_RATE);

    let created = pay(&fixture, &ves(appointment, 182_500, None));

    assert_eq!(created.rate_bs_per_usd_e4, Some(DAY_RATE));
    assert_eq!(created.usd_equivalent_cents, 5000);
}

#[test]
fn the_ves_equivalent_rounds_half_up() {
    let fixture = fixture();
    let appointment = completed(&fixture);

    let up = pay(&fixture, &ves(appointment, 1, Some(20_000)));
    let rejected = try_pay_at(&fixture, &ves(appointment, 1, Some(20_001)), NOW);

    assert_eq!(up.usd_equivalent_cents, 1);
    assert_eq!(failure_of(rejected), "validation:amountCents");
}

#[test]
fn a_ves_amount_too_small_to_reach_one_usd_cent_is_rejected_and_the_minimum_is_accepted() {
    let fixture = fixture();
    let appointment = completed(&fixture);

    for too_small in [1, 18] {
        let outcome = try_pay_at(&fixture, &ves(appointment, too_small, Some(DAY_RATE)), NOW);
        assert_eq!(failure_of(outcome), "validation:amountCents", "{too_small}");
    }
    let minimum = pay(&fixture, &ves(appointment, 19, Some(DAY_RATE)));

    assert_eq!(minimum.usd_equivalent_cents, 1);
    assert_eq!(payment_count(&fixture), 1);
}

#[test]
fn a_ves_payment_without_any_rate_is_rejected_and_nothing_is_stored() {
    let fixture = fixture();
    let appointment = completed(&fixture);

    let outcome = try_pay_at(&fixture, &ves(appointment, 182_500, None), NOW);

    assert_eq!(failure_of(outcome), "rateMissing");
    assert_eq!(payment_count(&fixture), 0);
    assert!(audit_rows(&fixture)
        .iter()
        .all(|entry| entry.entity != AuditEntity::Payment));
}

#[test]
fn only_the_rate_of_the_payment_day_counts_as_the_default() {
    let fixture = fixture();
    let appointment = completed(&fixture);
    add_rate(&fixture, "2026-11-11", DAY_RATE);
    add_rate(&fixture, "2026-11-13", DAY_RATE);

    let outcome = try_pay_at(&fixture, &ves(appointment, 182_500, None), NOW);

    assert_eq!(failure_of(outcome), "rateMissing");
}

#[test]
fn correcting_the_rate_afterwards_never_alters_a_stored_payment() {
    let fixture = fixture();
    let appointment = completed(&fixture);
    add_rate(&fixture, "2026-11-12", DAY_RATE);
    let created = pay(&fixture, &ves(appointment, 182_500, None));

    execute(
        &fixture,
        "UPDATE exchange_rates SET rate_bs_per_usd_e4 = 500000 WHERE date = '2026-11-12'",
    );

    assert_eq!(stored(&fixture, created.id), created);
    assert_eq!(created.rate_bs_per_usd_e4, Some(DAY_RATE));
}

#[test]
fn a_payment_is_accepted_whatever_the_appointment_status() {
    for status in [
        AppointmentStatus::Scheduled,
        AppointmentStatus::InProgress,
        AppointmentStatus::Completed,
        AppointmentStatus::Cancelled,
        AppointmentStatus::NoShow,
    ] {
        let fixture = fixture();
        let appointment = appointment_with_status(&fixture, status);

        let created = try_pay_at(&fixture, &usd(appointment, 1000), NOW);

        assert!(created.is_ok(), "{status:?}");
    }
}

#[test]
fn several_partial_payments_can_share_an_appointment() {
    let fixture = fixture();
    let appointment = completed(&fixture);

    pay(&fixture, &usd(appointment, 2000));
    pay(&fixture, &ves(appointment, 73_000, Some(DAY_RATE)));

    assert_eq!(payment_count(&fixture), 2);
}

#[test]
fn an_unknown_appointment_or_method_is_reported_on_its_own_field() {
    let fixture = fixture();
    let appointment = completed(&fixture);
    let mut unknown_method = usd(appointment, 1000);
    unknown_method.method_id = 999;

    assert_eq!(
        failure_of(try_pay_at(&fixture, &usd(999, 1000), NOW)),
        "missing:appointmentId"
    );
    assert_eq!(
        failure_of(try_pay_at(&fixture, &unknown_method, NOW)),
        "missing:methodId"
    );
}

#[test]
fn the_appointment_is_checked_before_the_method() {
    let fixture = fixture();
    let mut input = usd(999, 1000);
    input.method_id = 999;

    assert_eq!(
        failure_of(try_pay_at(&fixture, &input, NOW)),
        "missing:appointmentId"
    );
}

#[test]
fn an_inactive_payment_method_is_a_validation_failure_on_the_method() {
    let fixture = fixture();
    let appointment = completed(&fixture);
    execute(
        &fixture,
        "UPDATE payment_methods SET active = 0 WHERE id = 1",
    );

    let outcome = try_pay_at(&fixture, &usd(appointment, 1000), NOW);

    assert_eq!(failure_of(outcome), "validation:methodId");
    assert_eq!(payment_count(&fixture), 0);
}

#[test]
fn malformed_input_is_rejected_on_the_offending_field() {
    let fixture = fixture();
    let appointment = completed(&fixture);
    let cases = [
        (usd(0, 1000), "validation:appointmentId"),
        (usd(-1, 1000), "validation:appointmentId"),
        (
            crate::features::payments::model::PaymentInput {
                method_id: 0,
                ..usd(appointment, 1000)
            },
            "validation:methodId",
        ),
        (usd(appointment, 0), "validation:amountCents"),
        (usd(appointment, -5), "validation:amountCents"),
        (usd(appointment, 100_000_000_001), "validation:amountCents"),
        (ves(appointment, 1000, Some(0)), "validation:rateBsPerUsdE4"),
        (
            ves(appointment, 1000, Some(100_000_000_001)),
            "validation:rateBsPerUsdE4",
        ),
        (
            PaymentInput {
                rate_bs_per_usd_e4: Some(0),
                ..usd(appointment, 1000)
            },
            "validation:rateBsPerUsdE4",
        ),
        (
            PaymentInput {
                rate_bs_per_usd_e4: Some(100_000_000_001),
                ..usd(appointment, 1000)
            },
            "validation:rateBsPerUsdE4",
        ),
    ];

    for (input, expected) in cases {
        assert_eq!(failure_of(try_pay_at(&fixture, &input, NOW)), expected);
    }
    assert_eq!(payment_count(&fixture), 0);
}

#[test]
fn the_maximum_amount_with_the_maximum_rate_is_accepted() {
    let fixture = fixture();
    let appointment = completed(&fixture);

    let created = pay(
        &fixture,
        &ves(appointment, 100_000_000_000, Some(100_000_000_000)),
    );

    assert_eq!(created.usd_equivalent_cents, 10_000);
}

#[test]
fn an_invalid_clock_value_is_rejected_before_touching_anything() {
    let fixture = fixture();
    let appointment = completed(&fixture);

    for now in ["", "2026-11-12", "2026-11-12 11:30", "2026-02-30T10:00"] {
        let outcome = try_pay_at(&fixture, &usd(appointment, 1000), now);
        assert!(matches!(outcome, Err(PaymentError::Db(_))), "{now:?}");
    }
    assert_eq!(payment_count(&fixture), 0);
}

#[test]
fn creating_a_payment_audits_a_create_with_the_snapshot_and_no_free_text() {
    let fixture = fixture();
    let appointment = completed(&fixture);
    add_rate(&fixture, "2026-11-12", DAY_RATE);

    let created = pay(&fixture, &ves(appointment, 182_500, None));

    let entry = audit_rows(&fixture)
        .into_iter()
        .find(|entry| entry.entity == AuditEntity::Payment)
        .unwrap();
    assert_eq!(entry.action, AuditAction::Create);
    assert_eq!(entry.entity_id, Some(created.id));
    assert_eq!(entry.actor_user_id, Some(fixture.actor));
    assert_eq!(
        diff_of(&entry),
        json!({
            "appointmentId": appointment,
            "methodId": 2,
            "currency": "VES",
            "amountCents": 182_500,
            "rateBsPerUsdE4": DAY_RATE,
            "usdEquivalentCents": 5000,
            "paidAt": NOW
        })
    );
}

#[test]
fn a_failing_audit_rolls_the_payment_back() {
    let fixture = fixture();
    let appointment = completed(&fixture);
    execute(&fixture, FAIL_AUDIT_INSERTS);

    let outcome = try_pay_at(&fixture, &usd(appointment, 1000), NOW);

    assert!(matches!(outcome, Err(PaymentError::Db(_))));
    assert_eq!(payment_count(&fixture), 0);
}

#[test]
fn creation_records_who_created_the_payment() {
    let fixture = fixture();
    let appointment = completed(&fixture);

    let created = pay(&fixture, &usd(appointment, 1000));

    let (created_by, updated_by): (i64, i64) = fixture
        .database
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT created_by, updated_by FROM appointment_payments WHERE id = ?1",
                [created.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?)
        })
        .unwrap();
    assert_eq!((created_by, updated_by), (fixture.actor, fixture.actor));
}
