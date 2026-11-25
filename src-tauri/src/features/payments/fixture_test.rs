use super::model::{
    PaymentCurrency, PaymentError, PaymentInput, PaymentSummary, PaymentVoidRequest,
};
use super::service;
use crate::features::appointments::fixture_test::{
    create, facial, input, Fixture, CABIN_ONE, CABIN_TWO,
};
use crate::features::appointments::model::AppointmentStatus;
use crate::features::appointments::repository::set_status;

pub(crate) use crate::features::appointments::fixture_test::{
    audit_rows, diff_of, execute, fixture, FAIL_AUDIT_INSERTS,
};

pub(crate) const CASH: i64 = 1;
pub(crate) const MOBILE: i64 = 2;
pub(crate) const NOW: &str = "2026-11-12T11:30";
pub(crate) const DAY_RATE: i64 = 365_000;

pub(crate) fn appointment_with_status(fixture: &Fixture, status: AppointmentStatus) -> i64 {
    let created = create(fixture, &facial(CABIN_ONE, "2026-11-12T10:00"));
    let actor = fixture.actor;
    fixture
        .database
        .with_conn(|conn| set_status(conn, created.id, status, actor))
        .unwrap();
    created.id
}

pub(crate) const OTHER_CLIENT: i64 = 3;

pub(crate) fn add_other_client(fixture: &Fixture) {
    execute(
        fixture,
        "INSERT INTO clients (id, first_name, last_name, national_id, phone, search_key) \
         VALUES (3, 'Eva', 'Rojas', 'V-11111111', '0414', 'k')",
    );
}

pub(crate) fn appointment_on(
    fixture: &Fixture,
    client_id: i64,
    service_id: i64,
    starts_at: &str,
    status: AppointmentStatus,
) -> i64 {
    let request = input(client_id, service_id, CABIN_TWO, starts_at);
    let created = create(fixture, &request);
    let actor = fixture.actor;
    fixture
        .database
        .with_conn(|conn| set_status(conn, created.id, status, actor))
        .unwrap();
    created.id
}

pub(crate) fn second_appointment(fixture: &Fixture) -> i64 {
    create(fixture, &facial(CABIN_TWO, "2026-11-12T10:00")).id
}

pub(crate) fn usd(appointment_id: i64, amount_cents: i64) -> PaymentInput {
    PaymentInput {
        appointment_id,
        method_id: CASH,
        currency: PaymentCurrency::Usd,
        amount_cents,
        rate_bs_per_usd_e4: None,
    }
}

pub(crate) fn ves(appointment_id: i64, amount_cents: i64, rate: Option<i64>) -> PaymentInput {
    PaymentInput {
        appointment_id,
        method_id: MOBILE,
        currency: PaymentCurrency::Ves,
        amount_cents,
        rate_bs_per_usd_e4: rate,
    }
}

pub(crate) fn try_pay_at(
    fixture: &Fixture,
    input: &PaymentInput,
    now: &str,
) -> Result<PaymentSummary, PaymentError> {
    let actor = fixture.actor;
    fixture
        .database
        .with_tx(|tx| service::create_payment_at(tx, actor, input, now))
}

pub(crate) fn pay(fixture: &Fixture, input: &PaymentInput) -> PaymentSummary {
    try_pay_at(fixture, input, NOW).unwrap()
}

pub(crate) fn try_void_at(
    fixture: &Fixture,
    payment_id: i64,
    reason: &str,
    now: &str,
) -> Result<PaymentSummary, PaymentError> {
    let actor = fixture.actor;
    let request = PaymentVoidRequest {
        id: payment_id,
        reason: reason.to_string(),
    };
    fixture
        .database
        .with_tx(|tx| service::void_payment_at(tx, actor, &request, now))
}

pub(crate) fn stored(fixture: &Fixture, payment_id: i64) -> PaymentSummary {
    fixture
        .database
        .with_conn(|conn| super::repository::find_payment(conn, payment_id))
        .unwrap()
        .unwrap()
}

pub(crate) fn add_rate(fixture: &Fixture, date: &str, rate: i64) {
    execute(
        fixture,
        &format!("INSERT INTO exchange_rates (date, rate_bs_per_usd_e4) VALUES ('{date}', {rate})"),
    );
}

pub(crate) fn payment_count(fixture: &Fixture) -> i64 {
    fixture
        .database
        .with_conn(|conn| {
            Ok(
                conn.query_row("SELECT COUNT(*) FROM appointment_payments", [], |row| {
                    row.get(0)
                })?,
            )
        })
        .unwrap()
}
