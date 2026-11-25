use super::*;
use crate::features::appointments::fixture_test::{ACTIVE_CLIENT, ACTIVE_SERVICE};
use crate::features::appointments::model::AppointmentStatus::Completed;
use crate::features::payments::fixture_test::{
    add_other_client, appointment_on, fixture, pay, usd, OTHER_CLIENT,
};

#[test]
fn totals_of_a_client_without_rows_are_zero_and_not_null() {
    let fixture = fixture();

    let totals = fixture
        .database
        .with_conn(|conn| client_totals(conn, ACTIVE_CLIENT))
        .unwrap();

    assert_eq!(totals, HistoryTotals::default());
}

#[test]
fn client_payments_only_include_the_payments_of_that_client() {
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
    let own_payment = pay(&fixture, &usd(mine, 1000));
    pay(&fixture, &usd(theirs, 2000));

    let listed = fixture
        .database
        .with_conn(|conn| client_payments(conn, ACTIVE_CLIENT))
        .unwrap();

    assert_eq!(listed, vec![own_payment]);
}

#[test]
fn the_client_lookup_uses_the_client_and_date_index() {
    let fixture = fixture();

    let plan = fixture
        .database
        .with_conn(|conn| {
            let mut statement = conn.prepare(&format!("EXPLAIN QUERY PLAN {ENTRIES_SQL}"))?;
            let details = statement
                .query_map([ACTIVE_CLIENT], |row| row.get::<_, String>(3))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(details.join(" | "))
        })
        .unwrap();

    assert!(plan.contains("appointments_client_starts_at"), "{plan}");
}
