use super::*;
use crate::features::appointments::fixture_test::{
    execute, Fixture, ACTIVE_CLIENT, ACTIVE_SERVICE, DELETED_CLIENT,
};
use crate::features::appointments::model::AppointmentStatus::{
    self, Cancelled, Completed, InProgress, NoShow, Scheduled,
};
use crate::features::metrics::rules::month_bounds;
use crate::features::payments::fixture_test::{
    add_other_client, fixture, pay, try_pay_at, try_void_at, usd, ves, DAY_RATE, OTHER_CLIENT,
};

fn november() -> MonthBounds {
    month_bounds("2026-11").unwrap()
}

fn insert_short(
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

fn counts(fixture: &Fixture) -> AppointmentCounts {
    fixture
        .database
        .with_conn_mapped(|conn| status_counts(conn, &november()))
        .unwrap()
}

fn turnover(fixture: &Fixture) -> ClientTurnover {
    fixture
        .database
        .with_conn_mapped(|conn| client_turnover(conn, &november()))
        .unwrap()
}

fn amounts(fixture: &Fixture) -> MonthAmounts {
    fixture
        .database
        .with_conn_mapped(|conn| month_amounts(conn, &november()))
        .unwrap()
}

fn of(usd: i64, ves: i64) -> AmountsByCurrency {
    AmountsByCurrency { usd, ves }
}

#[test]
fn an_empty_month_is_all_zeros() {
    let fixture = fixture();

    assert_eq!(counts(&fixture), AppointmentCounts::default());
    assert_eq!(turnover(&fixture), ClientTurnover::default());
    assert_eq!(amounts(&fixture), MonthAmounts::default());
}

#[test]
fn counts_group_every_status_of_the_month() {
    let fixture = fixture();
    for (day, status) in [
        (1, Scheduled),
        (2, Scheduled),
        (3, InProgress),
        (4, Completed),
        (5, Completed),
        (6, Completed),
        (7, Cancelled),
        (8, NoShow),
        (9, NoShow),
    ] {
        let starts_at = format!("2026-11-{day:02}T10:00");
        insert_short(&fixture, ACTIVE_CLIENT, &starts_at, status);
    }

    assert_eq!(
        counts(&fixture),
        AppointmentCounts {
            scheduled: 2,
            in_progress: 1,
            completed: 3,
            cancelled: 1,
            no_show: 2,
        }
    );
}

#[test]
fn the_month_boundary_is_inclusive_at_the_start_and_exclusive_at_the_next_start() {
    let fixture = fixture();
    insert_short(&fixture, ACTIVE_CLIENT, "2026-10-31T23:59", Completed);
    insert_short(&fixture, ACTIVE_CLIENT, "2026-11-01T00:00", Completed);
    insert_short(&fixture, ACTIVE_CLIENT, "2026-11-30T23:59", Completed);
    insert_short(&fixture, ACTIVE_CLIENT, "2026-12-01T00:00", Completed);

    assert_eq!(counts(&fixture).completed, 2);
}

#[test]
fn payments_are_attributed_to_the_month_of_the_appointment_not_of_the_payment() {
    let fixture = fixture();
    let october = insert_short(&fixture, ACTIVE_CLIENT, "2026-10-20T10:00", Completed);
    let november_visit = insert_short(&fixture, ACTIVE_CLIENT, "2026-11-20T10:00", Completed);
    pay(&fixture, &usd(october, 1000));
    try_pay_at(&fixture, &usd(november_visit, 2000), "2026-12-05T09:00").unwrap();

    assert_eq!(amounts(&fixture).revenue, of(2000, 0));
}

#[test]
fn usd_and_ves_are_summed_separately_without_conversion() {
    let fixture = fixture();
    let first = insert_short(&fixture, ACTIVE_CLIENT, "2026-11-10T10:00", Completed);
    let second = insert_short(&fixture, ACTIVE_CLIENT, "2026-11-11T10:00", Completed);
    pay(&fixture, &usd(first, 2000));
    pay(&fixture, &usd(second, 500));
    pay(&fixture, &ves(first, 54_750, Some(DAY_RATE)));

    assert_eq!(amounts(&fixture).revenue, of(2500, 54_750));
}

#[test]
fn a_voided_payment_adds_to_no_bucket() {
    let fixture = fixture();
    let completed = insert_short(&fixture, ACTIVE_CLIENT, "2026-11-10T10:00", Completed);
    let cancelled = insert_short(&fixture, ACTIVE_CLIENT, "2026-11-11T10:00", Cancelled);
    let scheduled = insert_short(&fixture, ACTIVE_CLIENT, "2026-11-12T10:00", Scheduled);
    pay(&fixture, &usd(completed, 1000));
    for appointment in [completed, cancelled, scheduled] {
        let voided = pay(&fixture, &usd(appointment, 700));
        try_void_at(&fixture, voided.id, "error", "2026-11-12T12:00").unwrap();
    }

    let found = amounts(&fixture);

    assert_eq!(found.revenue, of(1000, 0));
    assert_eq!(found.collected_on_non_completed, of(0, 0));
    assert_eq!(found.pending, of(0, 0));
}

#[test]
fn each_status_feeds_exactly_its_own_bucket() {
    let fixture = fixture();
    for (day, status, cents) in [
        (1, Completed, 1),
        (2, Cancelled, 10),
        (3, NoShow, 100),
        (4, Scheduled, 1000),
        (5, InProgress, 10_000),
    ] {
        let starts_at = format!("2026-11-{day:02}T10:00");
        let appointment = insert_short(&fixture, ACTIVE_CLIENT, &starts_at, status);
        pay(&fixture, &usd(appointment, cents));
    }

    let found = amounts(&fixture);

    assert_eq!(found.revenue, of(1, 0));
    assert_eq!(found.collected_on_non_completed, of(110, 0));
    assert_eq!(found.pending, of(11_000, 0));
}

#[test]
fn a_deposit_on_a_scheduled_appointment_is_pending_in_its_currency() {
    let fixture = fixture();
    let scheduled = insert_short(&fixture, ACTIVE_CLIENT, "2026-11-12T10:00", Scheduled);
    pay(&fixture, &ves(scheduled, 73_000, Some(DAY_RATE)));

    assert_eq!(amounts(&fixture).pending, of(0, 73_000));
}

#[test]
fn deleted_clients_still_count_in_every_aggregate() {
    let fixture = fixture();
    let visit = insert_short(&fixture, DELETED_CLIENT, "2026-11-10T10:00", Completed);
    pay(&fixture, &usd(visit, 1500));

    assert_eq!(counts(&fixture).completed, 1);
    assert_eq!(turnover(&fixture).new_clients, 1);
    assert_eq!(amounts(&fixture).revenue, of(1500, 0));
}

#[test]
fn a_client_with_an_earlier_completed_visit_is_recurring_and_the_rest_are_new() {
    let fixture = fixture();
    add_other_client(&fixture);
    insert_short(&fixture, ACTIVE_CLIENT, "2026-10-31T23:59", Completed);
    insert_short(&fixture, ACTIVE_CLIENT, "2026-11-10T10:00", Completed);
    insert_short(&fixture, OTHER_CLIENT, "2026-11-11T10:00", Completed);

    assert_eq!(
        turnover(&fixture),
        ClientTurnover {
            new_clients: 1,
            recurring_clients: 1,
        }
    );
}

#[test]
fn a_client_with_two_completed_visits_in_the_month_counts_once() {
    let fixture = fixture();
    insert_short(&fixture, ACTIVE_CLIENT, "2026-11-10T10:00", Completed);
    insert_short(&fixture, ACTIVE_CLIENT, "2026-11-20T10:00", Completed);

    assert_eq!(
        turnover(&fixture),
        ClientTurnover {
            new_clients: 1,
            recurring_clients: 0,
        }
    );
}

#[test]
fn only_completed_earlier_visits_make_a_client_recurring() {
    let fixture = fixture();
    insert_short(&fixture, ACTIVE_CLIENT, "2026-10-10T10:00", Cancelled);
    insert_short(&fixture, ACTIVE_CLIENT, "2026-10-11T10:00", NoShow);
    insert_short(&fixture, ACTIVE_CLIENT, "2026-11-10T10:00", Completed);
    insert_short(&fixture, ACTIVE_CLIENT, "2026-12-10T10:00", Completed);

    assert_eq!(
        turnover(&fixture),
        ClientTurnover {
            new_clients: 1,
            recurring_clients: 0,
        }
    );
}

#[test]
fn a_client_without_a_completed_visit_in_the_month_is_in_neither_group() {
    let fixture = fixture();
    insert_short(&fixture, ACTIVE_CLIENT, "2026-10-10T10:00", Completed);
    insert_short(&fixture, ACTIVE_CLIENT, "2026-11-10T10:00", Cancelled);

    assert_eq!(turnover(&fixture), ClientTurnover::default());
}

#[test]
fn the_month_filters_are_served_by_the_starts_at_indexes() {
    let fixture = fixture();
    for sql in [COUNTS_SQL, TURNOVER_SQL, AMOUNTS_SQL] {
        let plan = fixture
            .database
            .with_conn(|conn| {
                let mut statement = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))?;
                let rows = statement
                    .query_map(["2026-11-01T00:00", "2026-12-01T00:00"], |row| {
                        row.get::<_, String>(3)
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows.join("\n"))
            })
            .unwrap();

        assert!(plan.contains("starts_at"), "{sql}\n{plan}");
        assert!(!plan.contains("SCAN a"), "{sql}\n{plan}");
    }
}

#[test]
fn the_recurring_lookup_uses_the_client_and_start_index() {
    let fixture = fixture();
    let plan = fixture
        .database
        .with_conn(|conn| {
            let mut statement = conn.prepare(&format!("EXPLAIN QUERY PLAN {TURNOVER_SQL}"))?;
            let rows = statement
                .query_map(["2026-11-01T00:00", "2026-12-01T00:00"], |row| {
                    row.get::<_, String>(3)
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows.join("\n"))
        })
        .unwrap();

    assert!(plan.contains("appointments_client_starts_at"), "{plan}");
}

#[test]
fn a_client_whose_only_completed_visit_starts_at_the_first_minute_of_the_month_is_new() {
    let fixture = fixture();
    insert_short(&fixture, ACTIVE_CLIENT, "2026-11-01T00:00", Completed);

    assert_eq!(
        turnover(&fixture),
        ClientTurnover {
            new_clients: 1,
            recurring_clients: 0,
        }
    );
}

#[test]
fn december_includes_its_last_minute_and_excludes_the_first_minute_of_january() {
    let fixture = fixture();
    insert_short(&fixture, ACTIVE_CLIENT, "2026-12-31T23:59", Completed);
    insert_short(&fixture, ACTIVE_CLIENT, "2027-01-01T00:00", Completed);
    insert_short(&fixture, ACTIVE_CLIENT, "2026-11-30T23:59", Completed);
    let december = month_bounds("2026-12").unwrap();

    let found = fixture
        .database
        .with_conn_mapped(|conn| status_counts(conn, &december))
        .unwrap();

    assert_eq!(found.completed, 1);
}

#[test]
fn every_known_status_row_fills_its_counter() {
    let rows = vec![
        ("scheduled".to_string(), 1),
        ("in_progress".to_string(), 2),
        ("completed".to_string(), 3),
        ("cancelled".to_string(), 4),
        ("no_show".to_string(), 5),
    ];

    assert_eq!(
        counts_from_rows(rows).unwrap(),
        AppointmentCounts {
            scheduled: 1,
            in_progress: 2,
            completed: 3,
            cancelled: 4,
            no_show: 5,
        }
    );
}

#[test]
fn an_unknown_status_row_is_an_error_instead_of_being_dropped() {
    let rows = vec![("completed".to_string(), 1), ("archived".to_string(), 7)];

    let error = counts_from_rows(rows).unwrap_err();

    assert!(matches!(error, MetricsError::UnknownStatus));
}

#[test]
fn a_sqlite_integer_overflow_while_summing_maps_to_total_exceeds_safe_range() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    let overflow = conn
        .query_row(
            "SELECT SUM(v) FROM (SELECT 9223372036854775807 AS v UNION ALL SELECT 1)",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_err();

    assert!(matches!(
        amounts_failure(overflow),
        MetricsError::TotalExceedsSafeRange
    ));
}

#[test]
fn any_other_sqlite_failure_stays_a_database_error() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    let failure = conn.prepare("SELECT * FROM missing").unwrap_err();

    assert!(matches!(amounts_failure(failure), MetricsError::Db(_)));
}
