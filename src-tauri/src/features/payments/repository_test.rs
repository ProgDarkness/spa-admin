use super::*;
use crate::features::appointments::model::AppointmentStatus;
use crate::features::payments::fixture_test::{
    appointment_with_status, fixture, second_appointment, CASH, MOBILE,
};

fn new_payment(appointment_id: i64, paid_at: &str) -> NewPayment {
    NewPayment {
        appointment_id,
        method_id: CASH,
        currency: PaymentCurrency::Usd,
        amount_cents: 3500,
        rate_bs_per_usd_e4: None,
        usd_equivalent_cents: 3500,
        paid_at: paid_at.to_string(),
    }
}

fn new_ves_payment(appointment_id: i64, paid_at: &str) -> NewPayment {
    NewPayment {
        method_id: MOBILE,
        currency: PaymentCurrency::Ves,
        amount_cents: 182_500,
        rate_bs_per_usd_e4: Some(365_000),
        usd_equivalent_cents: 5000,
        ..new_payment(appointment_id, paid_at)
    }
}

#[test]
fn a_usd_payment_round_trips_with_actor_and_no_void() {
    let fixture = fixture();
    let appointment = appointment_with_status(&fixture, AppointmentStatus::Completed);
    let actor = fixture.actor;

    let found = fixture
        .database
        .with_conn(|conn| {
            let id = insert_payment(conn, &new_payment(appointment, "2026-11-12T11:00"), actor)?;
            find_payment(conn, id)
        })
        .unwrap()
        .unwrap();

    assert_eq!(found.appointment_id, appointment);
    assert_eq!(found.method_id, CASH);
    assert_eq!(found.currency, PaymentCurrency::Usd);
    assert_eq!(found.amount_cents, 3500);
    assert_eq!(found.rate_bs_per_usd_e4, None);
    assert_eq!(found.usd_equivalent_cents, 3500);
    assert_eq!(found.paid_at, "2026-11-12T11:00");
    assert_eq!(
        (found.voided_at, found.voided_by, found.void_reason),
        (None, None, None)
    );
}

#[test]
fn a_ves_payment_round_trips_with_its_copied_rate() {
    let fixture = fixture();
    let appointment = appointment_with_status(&fixture, AppointmentStatus::Completed);
    let actor = fixture.actor;

    let found = fixture
        .database
        .with_conn(|conn| {
            let id = insert_payment(
                conn,
                &new_ves_payment(appointment, "2026-11-12T11:00"),
                actor,
            )?;
            find_payment(conn, id)
        })
        .unwrap()
        .unwrap();

    assert_eq!(found.currency, PaymentCurrency::Ves);
    assert_eq!(found.rate_bs_per_usd_e4, Some(365_000));
    assert_eq!(found.usd_equivalent_cents, 5000);
}

#[test]
fn finding_an_unknown_payment_returns_none() {
    let fixture = fixture();

    let found = fixture
        .database
        .with_conn(|conn| find_payment(conn, 404))
        .unwrap();

    assert_eq!(found, None);
}

#[test]
fn payments_of_an_appointment_are_ordered_by_paid_at_then_id_and_isolated() {
    let fixture = fixture();
    let first = appointment_with_status(&fixture, AppointmentStatus::Completed);
    let other = second_appointment(&fixture);
    let actor = fixture.actor;

    let listed = fixture
        .database
        .with_conn(|conn| {
            insert_payment(conn, &new_payment(first, "2026-11-12T12:00"), actor)?;
            insert_payment(conn, &new_payment(other, "2026-11-12T09:00"), actor)?;
            insert_payment(conn, &new_payment(first, "2026-11-12T11:00"), actor)?;
            insert_payment(conn, &new_payment(first, "2026-11-12T11:00"), actor)?;
            list_payments_of_appointment(conn, first)
        })
        .unwrap();

    let order: Vec<(i64, &str)> = listed
        .iter()
        .map(|payment| (payment.id, payment.paid_at.as_str()))
        .collect();
    assert_eq!(
        order,
        [
            (3, "2026-11-12T11:00"),
            (4, "2026-11-12T11:00"),
            (1, "2026-11-12T12:00")
        ]
    );
}

#[test]
fn listing_an_appointment_without_payments_is_empty() {
    let fixture = fixture();
    let appointment = appointment_with_status(&fixture, AppointmentStatus::Completed);

    let listed = fixture
        .database
        .with_conn(|conn| list_payments_of_appointment(conn, appointment))
        .unwrap();

    assert!(listed.is_empty());
}

#[test]
fn mark_voided_stores_the_three_void_fields() {
    let fixture = fixture();
    let appointment = appointment_with_status(&fixture, AppointmentStatus::Completed);
    let actor = fixture.actor;

    let voided = fixture
        .database
        .with_conn(|conn| {
            let id = insert_payment(conn, &new_payment(appointment, "2026-11-12T11:00"), actor)?;
            mark_voided(
                conn,
                id,
                "2026-11-12T12:15",
                actor,
                "Monto digitado por error",
            )?;
            find_payment(conn, id)
        })
        .unwrap()
        .unwrap();

    assert_eq!(voided.voided_at.as_deref(), Some("2026-11-12T12:15"));
    assert_eq!(voided.voided_by, Some(actor));
    assert_eq!(
        voided.void_reason.as_deref(),
        Some("Monto digitado por error")
    );
}

#[test]
fn voiding_twice_reports_that_the_second_call_voided_nothing_and_keeps_the_first() {
    let fixture = fixture();
    let appointment = appointment_with_status(&fixture, AppointmentStatus::Completed);
    let actor = fixture.actor;

    let (first, second, stored) = fixture
        .database
        .with_conn(|conn| {
            let id = insert_payment(conn, &new_payment(appointment, "2026-11-12T11:00"), actor)?;
            let first = mark_voided(conn, id, "2026-11-12T12:00", actor, "primera")?;
            let second = mark_voided(conn, id, "2026-11-12T13:00", actor, "segunda")?;
            Ok((first, second, find_payment(conn, id)?.unwrap()))
        })
        .unwrap();

    assert!(first);
    assert!(!second);
    assert_eq!(stored.void_reason.as_deref(), Some("primera"));
    assert_eq!(stored.voided_at.as_deref(), Some("2026-11-12T12:00"));
}

#[test]
fn the_database_rejects_an_incoherent_equivalent_through_the_repository() {
    let fixture = fixture();
    let appointment = appointment_with_status(&fixture, AppointmentStatus::Completed);
    let actor = fixture.actor;
    let incoherent = NewPayment {
        usd_equivalent_cents: 1,
        ..new_payment(appointment, "2026-11-12T11:00")
    };

    let outcome = fixture
        .database
        .with_conn(|conn| insert_payment(conn, &incoherent, actor));

    assert!(outcome.is_err());
}

#[test]
fn the_trigger_rejects_a_direct_delete() {
    let fixture = fixture();
    let appointment = appointment_with_status(&fixture, AppointmentStatus::Completed);
    let actor = fixture.actor;
    fixture
        .database
        .with_conn(|conn| {
            insert_payment(conn, &new_payment(appointment, "2026-11-12T11:00"), actor)
        })
        .unwrap();

    let outcome = fixture
        .database
        .with_conn(|conn| Ok(conn.execute_batch("DELETE FROM appointment_payments")?));

    assert!(outcome.is_err());
}
