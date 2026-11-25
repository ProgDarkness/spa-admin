use super::*;
use crate::errors::AppError;
use crate::features::appointments::fixture_test::{
    create, execute, facial, ACTIVE_CLIENT, ACTIVE_SERVICE, CABIN_ONE,
};
use crate::features::appointments::model::AppointmentStatus::{
    Cancelled, Completed, InProgress, NoShow, Scheduled,
};
use crate::features::client_history::model::AmountsByCurrency;
use crate::features::payments::fixture_test::{
    add_other_client, appointment_on, fixture, pay, try_pay_at, try_void_at, usd, ves, DAY_RATE,
    OTHER_CLIENT,
};

const CORPORAL: i64 = 3;

#[test]
fn a_deposit_on_a_scheduled_or_in_progress_appointment_is_pending_and_nowhere_else() {
    let fixture = fixture();
    let scheduled = appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T08:00",
        Scheduled,
    );
    let running = appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T10:00",
        InProgress,
    );
    pay(&fixture, &usd(scheduled, 1500));
    pay(&fixture, &ves(running, 73_000, Some(DAY_RATE)));
    pay(&fixture, &usd(running, 500));

    let history = history_of(&fixture, ACTIVE_CLIENT);

    assert_eq!(history.pending_by_currency, amounts(2000, 73_000));
    assert_eq!(history.paid_by_currency, amounts(0, 0));
    assert_eq!(
        history.collected_on_non_completed_by_currency,
        amounts(0, 0)
    );
    assert_eq!(history.ves_usd_equivalent_of_completed, 0);
}

#[test]
fn a_voided_deposit_is_not_pending() {
    let fixture = fixture();
    let scheduled = appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T08:00",
        Scheduled,
    );
    let kept = pay(&fixture, &usd(scheduled, 1500));
    let voided = pay(&fixture, &usd(scheduled, 700));
    try_void_at(&fixture, voided.id, "error", "2026-11-12T12:00").unwrap();

    let history = history_of(&fixture, ACTIVE_CLIENT);

    assert_eq!(history.pending_by_currency, amounts(1500, 0));
    assert_eq!(history.entries[0].payments.len(), 2);
    assert_eq!(kept.amount_cents, 1500);
}

#[test]
fn completed_cancelled_and_no_show_payments_are_never_pending() {
    let fixture = fixture();
    for (hour, status) in [(8, Completed), (10, Cancelled), (12, NoShow)] {
        let appointment = appointment_on(
            &fixture,
            ACTIVE_CLIENT,
            ACTIVE_SERVICE,
            &format!("2026-11-10T{hour:02}:00"),
            status,
        );
        pay(&fixture, &usd(appointment, 1000));
    }

    assert_eq!(
        history_of(&fixture, ACTIVE_CLIENT).pending_by_currency,
        amounts(0, 0)
    );
}

#[test]
fn five_thousand_payments_at_the_cap_are_summed_without_overflow() {
    let fixture = fixture();
    let done = appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T08:00",
        Completed,
    );
    execute(
        &fixture,
        &format!(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000) \
             INSERT INTO appointment_payments (appointment_id, method_id, currency, \
             amount_cents, usd_equivalent_cents, paid_at) \
             SELECT {done}, 1, 'USD', 100000000000, 100000000000, '2026-11-10T09:00' FROM n"
        ),
    );

    let history = history_of(&fixture, ACTIVE_CLIENT);

    assert_eq!(history.paid_by_currency.usd, 500_000_000_000_000);
    assert_eq!(history.entries[0].payments.len(), 5000);
}

fn insert_cap_payments(
    fixture: &crate::features::appointments::fixture_test::Fixture,
    appointment: i64,
    rows: i64,
) {
    execute(
        fixture,
        &format!(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < {rows}) \
             INSERT INTO appointment_payments (appointment_id, method_id, currency, \
             amount_cents, usd_equivalent_cents, paid_at) \
             SELECT {appointment}, 1, 'USD', 100000000000, 100000000000, '2026-11-10T09:00' FROM n"
        ),
    );
}

fn completed_appointment(fixture: &crate::features::appointments::fixture_test::Fixture) -> i64 {
    appointment_on(
        fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T08:00",
        Completed,
    )
}

#[test]
fn a_total_above_the_safe_integer_range_is_a_controlled_internal_error() {
    let fixture = fixture();
    let done = completed_appointment(&fixture);
    insert_cap_payments(&fixture, done, 90_073);

    let outcome = fixture
        .database
        .with_conn_mapped(|conn| client_history(conn, ACTIVE_CLIENT));

    assert!(matches!(
        outcome,
        Err(ClientHistoryError::TotalExceedsSafeRange)
    ));
    assert_eq!(
        AppError::from(ClientHistoryError::TotalExceedsSafeRange),
        AppError::internal()
    );
}

#[test]
fn a_total_just_below_the_safe_integer_range_is_still_returned() {
    let fixture = fixture();
    let done = completed_appointment(&fixture);
    insert_cap_payments(&fixture, done, 90_071);

    let history = history_of(&fixture, ACTIVE_CLIENT);

    assert_eq!(history.paid_by_currency.usd, 9_007_100_000_000_000);
}

fn history_of(
    fixture: &crate::features::appointments::fixture_test::Fixture,
    id: i64,
) -> ClientHistory {
    fixture
        .database
        .with_conn_mapped(|conn| client_history(conn, id))
        .unwrap()
}

fn amounts(usd: i64, ves: i64) -> AmountsByCurrency {
    AmountsByCurrency { usd, ves }
}

#[test]
fn a_client_without_appointments_has_empty_history_and_zero_totals() {
    let fixture = fixture();

    let history = history_of(&fixture, ACTIVE_CLIENT);

    assert_eq!(history.client.id, ACTIVE_CLIENT);
    assert!(history.entries.is_empty());
    assert_eq!(history.total_minutes, 0);
    assert_eq!(history.paid_by_currency, amounts(0, 0));
    assert_eq!(
        history.collected_on_non_completed_by_currency,
        amounts(0, 0)
    );
    assert_eq!(history.ves_usd_equivalent_of_completed, 0);
}

#[test]
fn an_unknown_client_is_not_found() {
    let fixture = fixture();

    let outcome = fixture
        .database
        .with_conn_mapped(|conn| client_history(conn, 999));

    assert!(matches!(outcome, Err(ClientHistoryError::NotFound)));
}

#[test]
fn a_soft_deleted_client_still_has_its_history() {
    let fixture = fixture();
    add_other_client(&fixture);
    appointment_on(
        &fixture,
        OTHER_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T10:00",
        Completed,
    );
    execute(
        &fixture,
        "UPDATE clients SET deleted_at = '2026-11-11T10:00' WHERE id = 3",
    );

    let history = history_of(&fixture, OTHER_CLIENT);

    assert!(history.client.deleted_at.is_some());
    assert_eq!(history.entries.len(), 1);
}

#[test]
fn only_completed_appointments_add_their_frozen_minutes() {
    let fixture = fixture();
    appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T08:00",
        Completed,
    );
    appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        CORPORAL,
        "2026-11-10T10:00",
        Completed,
    );
    appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T13:00",
        Scheduled,
    );
    appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T15:00",
        InProgress,
    );
    appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T17:00",
        Cancelled,
    );
    appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T19:00",
        NoShow,
    );

    let history = history_of(&fixture, ACTIVE_CLIENT);

    assert_eq!(history.total_minutes, 150);
    assert_eq!(history.entries.len(), 6);
}

#[test]
fn minutes_come_from_the_snapshot_not_from_the_current_service() {
    let fixture = fixture();
    appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T08:00",
        Completed,
    );

    execute(
        &fixture,
        "UPDATE services SET duration_min = 200 WHERE id = 1",
    );

    assert_eq!(history_of(&fixture, ACTIVE_CLIENT).total_minutes, 60);
}

#[test]
fn completed_payments_are_summed_per_currency_with_the_ves_equivalent() {
    let fixture = fixture();
    let done = appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T08:00",
        Completed,
    );
    let also_done = appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        CORPORAL,
        "2026-11-10T10:00",
        Completed,
    );
    pay(&fixture, &usd(done, 2000));
    pay(&fixture, &ves(done, 73_000, Some(DAY_RATE)));
    pay(&fixture, &usd(also_done, 1500));
    pay(&fixture, &ves(also_done, 182_500, Some(DAY_RATE)));

    let history = history_of(&fixture, ACTIVE_CLIENT);

    assert_eq!(history.paid_by_currency, amounts(3500, 255_500));
    assert_eq!(history.ves_usd_equivalent_of_completed, 7000);
    assert_eq!(
        history.collected_on_non_completed_by_currency,
        amounts(0, 0)
    );
}

#[test]
fn a_voided_payment_is_listed_but_never_added_to_any_total() {
    let fixture = fixture();
    let done = appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T08:00",
        Completed,
    );
    let cancelled = appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T10:00",
        Cancelled,
    );
    let kept = pay(&fixture, &usd(done, 2000));
    let voided_usd = pay(&fixture, &usd(done, 1000));
    let voided_ves = pay(&fixture, &ves(done, 73_000, Some(DAY_RATE)));
    let voided_elsewhere = pay(&fixture, &usd(cancelled, 500));
    for id in [voided_usd.id, voided_ves.id, voided_elsewhere.id] {
        try_void_at(&fixture, id, "error", "2026-11-12T12:00").unwrap();
    }

    let history = history_of(&fixture, ACTIVE_CLIENT);

    assert_eq!(history.paid_by_currency, amounts(2000, 0));
    assert_eq!(history.ves_usd_equivalent_of_completed, 0);
    assert_eq!(
        history.collected_on_non_completed_by_currency,
        amounts(0, 0)
    );
    let listed: Vec<i64> = history
        .entries
        .iter()
        .flat_map(|entry| entry.payments.iter().map(|payment| payment.id))
        .collect();
    assert!(listed.contains(&kept.id) && listed.contains(&voided_usd.id));
    assert_eq!(listed.len(), 4);
}

#[test]
fn a_payment_on_a_cancelled_or_no_show_appointment_counts_as_collected_on_non_completed() {
    let fixture = fixture();
    let cancelled = appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T08:00",
        Cancelled,
    );
    let missed = appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T10:00",
        NoShow,
    );
    pay(&fixture, &usd(cancelled, 1500));
    pay(&fixture, &ves(missed, 73_000, Some(DAY_RATE)));

    let history = history_of(&fixture, ACTIVE_CLIENT);

    assert_eq!(
        history.collected_on_non_completed_by_currency,
        amounts(1500, 73_000)
    );
    assert_eq!(history.paid_by_currency, amounts(0, 0));
}

#[test]
fn payments_of_other_clients_never_leak_into_the_history() {
    let fixture = fixture();
    add_other_client(&fixture);
    let mine = appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T08:00",
        Completed,
    );
    let theirs = appointment_on(
        &fixture,
        OTHER_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T10:00",
        Completed,
    );
    pay(&fixture, &usd(mine, 1000));
    pay(&fixture, &usd(theirs, 9000));

    let history = history_of(&fixture, ACTIVE_CLIENT);

    assert_eq!(history.paid_by_currency, amounts(1000, 0));
    assert_eq!(history.entries.len(), 1);
    assert_eq!(history.entries[0].payments.len(), 1);
}

#[test]
fn entries_are_newest_first_with_names_even_when_service_and_resource_are_inactive() {
    let fixture = fixture();
    let older = create(&fixture, &facial(CABIN_ONE, "2026-11-09T08:00"));
    let newer = appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        CORPORAL,
        "2026-11-10T08:00",
        Completed,
    );
    execute(
        &fixture,
        "UPDATE services SET active = 0 WHERE id = 1; UPDATE resources SET active = 0 WHERE id = 1",
    );

    let history = history_of(&fixture, ACTIVE_CLIENT);

    let ids: Vec<i64> = history
        .entries
        .iter()
        .map(|entry| entry.appointment.id)
        .collect();
    assert_eq!(ids, [newer, older.id]);
    assert_eq!(history.entries[1].service_name, "Facial");
    assert_eq!(history.entries[1].resource_name, "Cabina 1");
    assert_eq!(history.entries[0].service_name, "Corporal");
    assert_eq!(history.entries[0].resource_name, "Cabina 2");
}

#[test]
fn payments_inside_an_entry_are_ordered_by_paid_at_then_id() {
    let fixture = fixture();
    let done = appointment_on(
        &fixture,
        ACTIVE_CLIENT,
        ACTIVE_SERVICE,
        "2026-11-10T08:00",
        Completed,
    );
    let first = try_pay_at(&fixture, &usd(done, 1000), "2026-11-12T11:30").unwrap();
    let second = try_pay_at(&fixture, &usd(done, 2000), "2026-11-12T09:00").unwrap();

    let history = history_of(&fixture, ACTIVE_CLIENT);

    let ids: Vec<i64> = history.entries[0]
        .payments
        .iter()
        .map(|payment| payment.id)
        .collect();
    assert_eq!(ids, [second.id, first.id]);
}
