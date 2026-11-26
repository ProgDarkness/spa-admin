use super::*;
use crate::features::appointments::fixture_test::{
    execute, Fixture, ACTIVE_CLIENT, ACTIVE_SERVICE,
};
use crate::features::appointments::model::AppointmentStatus::{
    self, Cancelled, Completed, Scheduled,
};
use crate::features::payments::fixture_test::{add_other_client, fixture, pay, usd, OTHER_CLIENT};

const SAFE_LIMIT: i64 = 9_007_199_254_740_991;
const MAX_PAYMENT: i64 = 100_000_000_000;

fn insert_appointment(
    fixture: &Fixture,
    client_id: i64,
    starts_at: &str,
    status: AppointmentStatus,
) -> i64 {
    execute(
        fixture,
        &format!(
            "INSERT INTO appointments (client_id, service_id, resource_id, starts_at, ends_at, \
             status, price_cents_snapshot, duration_min_snapshot) \
             VALUES ({client_id}, {ACTIVE_SERVICE}, 1, '{starts_at}', \
             strftime('%Y-%m-%dT%H:%M', '{starts_at}', '+1 minutes'), '{}', 3500, 1)",
            status.as_str()
        ),
    );
    fixture
        .database
        .with_conn(|conn| Ok(conn.last_insert_rowid()))
        .unwrap()
}

#[derive(Clone, Copy, Debug)]
enum Bucket {
    Revenue,
    CollectedOnNonCompleted,
    Pending,
}

const BUCKETS: [(Bucket, AppointmentStatus); 3] = [
    (Bucket::Revenue, Completed),
    (Bucket::CollectedOnNonCompleted, Cancelled),
    (Bucket::Pending, Scheduled),
];
const CURRENCIES: [&str; 2] = ["USD", "VES"];
const HIGHEST_RATE: i64 = 100_000_000_000;

fn payment_columns(currency: &str, amount: i64) -> String {
    match currency {
        "VES" => format!(
            "'VES', {amount}, {HIGHEST_RATE}, ({amount} * 20000 + {HIGHEST_RATE}) / (2 * {HIGHEST_RATE})"
        ),
        _ => format!("'USD', {amount}, NULL, {amount}"),
    }
}

fn bulk_payments(fixture: &Fixture, appointment_id: i64, currency: &str, total_cents: i64) {
    let full_payments = total_cents / MAX_PAYMENT;
    let remainder = total_cents % MAX_PAYMENT;
    let full_columns = payment_columns(currency, MAX_PAYMENT);
    execute(
        fixture,
        &format!(
            "WITH RECURSIVE counter(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM counter \
             WHERE n < {full_payments}) \
             INSERT INTO appointment_payments (appointment_id, method_id, currency, \
             amount_cents, rate_bs_per_usd_e4, usd_equivalent_cents, paid_at) \
             SELECT {appointment_id}, 1, {full_columns}, '2026-11-12T11:00' FROM counter"
        ),
    );
    let remainder_columns = payment_columns(currency, remainder);
    execute(
        fixture,
        &format!(
            "INSERT INTO appointment_payments (appointment_id, method_id, currency, \
             amount_cents, rate_bs_per_usd_e4, usd_equivalent_cents, paid_at) \
             VALUES ({appointment_id}, 1, {remainder_columns}, '2026-11-12T11:00')"
        ),
    );
}

fn amount_in(metrics: &MonthlyMetrics, bucket: Bucket, currency: &str) -> i64 {
    let amounts = match bucket {
        Bucket::Revenue => metrics.revenue_by_currency,
        Bucket::CollectedOnNonCompleted => metrics.collected_on_non_completed_by_currency,
        Bucket::Pending => metrics.pending_by_currency,
    };
    if currency == "VES" {
        amounts.ves
    } else {
        amounts.usd
    }
}

fn fixture_with_one_total(status: AppointmentStatus, currency: &str, total_cents: i64) -> Fixture {
    let fixture = fixture();
    let appointment = insert_appointment(&fixture, ACTIVE_CLIENT, "2026-11-10T10:00", status);
    bulk_payments(&fixture, appointment, currency, total_cents);
    fixture
}

fn metrics_of(fixture: &Fixture, month: &str) -> Result<MonthlyMetrics, MetricsError> {
    fixture
        .database
        .with_conn_mapped(|conn| monthly_metrics(conn, month))
}

#[test]
fn the_metrics_assemble_month_counts_clients_and_buckets() {
    let fixture = fixture();
    add_other_client(&fixture);
    insert_appointment(&fixture, ACTIVE_CLIENT, "2026-10-10T10:00", Completed);
    let first = insert_appointment(&fixture, ACTIVE_CLIENT, "2026-11-10T10:00", Completed);
    let second = insert_appointment(&fixture, OTHER_CLIENT, "2026-11-11T10:00", Completed);
    let cancelled = insert_appointment(&fixture, OTHER_CLIENT, "2026-11-12T10:00", Cancelled);
    let scheduled = insert_appointment(&fixture, OTHER_CLIENT, "2026-11-13T10:00", Scheduled);
    pay(&fixture, &usd(first, 2000));
    pay(&fixture, &usd(second, 500));
    pay(&fixture, &usd(cancelled, 300));
    pay(&fixture, &usd(scheduled, 100));

    let metrics = metrics_of(&fixture, "2026-11").unwrap();

    assert_eq!(metrics.month, "2026-11");
    assert_eq!((metrics.new_clients, metrics.recurring_clients), (1, 1));
    assert_eq!(metrics.appointments.completed, 2);
    assert_eq!(metrics.appointments.cancelled, 1);
    assert_eq!(metrics.appointments.scheduled, 1);
    assert_eq!(metrics.revenue_by_currency.usd, 2500);
    assert_eq!(metrics.collected_on_non_completed_by_currency.usd, 300);
    assert_eq!(metrics.pending_by_currency.usd, 100);
}

#[test]
fn an_invalid_month_is_rejected_before_touching_the_database() {
    let fixture = fixture();

    let error = metrics_of(&fixture, "2026-13").unwrap_err();

    assert!(matches!(error, MetricsError::Validation { field: "month" }));
}

#[test]
fn a_month_with_no_activity_returns_zeros() {
    let fixture = fixture();

    let metrics = metrics_of(&fixture, "2030-01").unwrap();

    assert_eq!(metrics.new_clients + metrics.recurring_clients, 0);
    assert_eq!(metrics.revenue_by_currency.usd, 0);
}

#[test]
fn every_bucket_and_currency_accepts_a_total_exactly_at_the_safe_integer_limit() {
    for (bucket, status) in BUCKETS {
        for currency in CURRENCIES {
            let fixture = fixture_with_one_total(status, currency, SAFE_LIMIT);

            let metrics = metrics_of(&fixture, "2026-11").unwrap();

            assert_eq!(
                amount_in(&metrics, bucket, currency),
                SAFE_LIMIT,
                "{bucket:?} {currency}"
            );
        }
    }
}

#[test]
fn every_bucket_and_currency_rejects_a_total_one_cent_above_the_limit() {
    for (bucket, status) in BUCKETS {
        for currency in CURRENCIES {
            let fixture = fixture_with_one_total(status, currency, SAFE_LIMIT + 1);

            let error = metrics_of(&fixture, "2026-11").unwrap_err();

            assert!(
                matches!(error, MetricsError::TotalExceedsSafeRange),
                "{bucket:?} {currency}"
            );
        }
    }
}
