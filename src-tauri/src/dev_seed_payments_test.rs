use rusqlite::Connection;

use super::*;
use crate::db::migrate;
use crate::dev_seed::{seed_if_empty, SEED_PASSWORD_VAR};
use crate::dev_seed_appointments::seed_appointments_dated;
use crate::dev_seed_catalog::seed_catalog_dated;
use crate::dev_seed_clients::seed_clients_if_empty;
use crate::features::auth::password::PasswordPolicy;

const REFERENCE_DAY: &str = "2026-11-12";
const VOID_REASON: &str = "Monto digitado por error";

type StoredPayment = (i64, i64, i64, String, i64, Option<i64>, i64, Option<String>);

type ExpectedRow = (
    i64,
    i64,
    i64,
    &'static str,
    i64,
    Option<i64>,
    i64,
    Option<&'static str>,
);

const EXPECTED: [ExpectedRow; 11] = [
    (1, 1, 1, "USD", 3_500, None, 3_500, None),
    (2, 2, 2, "VES", 182_500, Some(365_000), 5_000, None),
    (3, 4, 3, "USD", 2_000, None, 2_000, None),
    (4, 4, 2, "VES", 73_000, Some(365_000), 2_000, None),
    (5, 8, 4, "USD", 12_000, None, 12_000, None),
    (6, 9, 3, "USD", 6_000, None, 6_000, None),
    (7, 9, 1, "USD", 1_000, None, 1_000, Some(VOID_REASON)),
    (8, 10, 1, "USD", 1_500, None, 1_500, None),
    (9, 13, 1, "USD", 3_500, None, 3_500, None),
    (10, 14, 1, "USD", 1_500, None, 1_500, None),
    (11, 15, 5, "VES", 73_000, Some(365_000), 2_000, None),
];

fn env_with_password(name: &str) -> Option<String> {
    (name == SEED_PASSWORD_VAR).then(|| "clave-de-desarrollo-1".to_string())
}

fn base_data() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    let policy = PasswordPolicy::new().unwrap();
    seed_if_empty(&conn, &policy, &env_with_password).unwrap();
    seed_catalog_dated(&conn, REFERENCE_DAY).unwrap();
    seed_clients_if_empty(&conn, &env_with_password).unwrap();
    seed_appointments_dated(&conn, REFERENCE_DAY).unwrap();
    conn
}

fn payment_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM appointment_payments", [], |row| {
        row.get(0)
    })
    .unwrap()
}

fn owner_id(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT id FROM users WHERE username = 'propietaria'",
        [],
        |row| row.get(0),
    )
    .unwrap()
}

fn stored(conn: &Connection) -> Vec<StoredPayment> {
    let mut statement = conn
        .prepare(
            "SELECT id, appointment_id, method_id, currency, amount_cents, rate_bs_per_usd_e4, \
             usd_equivalent_cents, void_reason FROM appointment_payments ORDER BY id",
        )
        .unwrap();
    statement
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
            ))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn seeds_the_eleven_mock_payments_with_the_same_amounts_rates_and_equivalents() {
    let conn = base_data();

    seed_payments(&conn).unwrap();

    let expected: Vec<StoredPayment> = EXPECTED
        .iter()
        .map(
            |(id, appointment, method, currency, amount, rate, equivalent, reason)| {
                (
                    *id,
                    *appointment,
                    *method,
                    currency.to_string(),
                    *amount,
                    *rate,
                    *equivalent,
                    reason.map(str::to_string),
                )
            },
        )
        .collect();
    assert_eq!(stored(&conn), expected);
}

#[test]
fn every_payment_is_stamped_at_the_start_of_its_appointment() {
    let conn = base_data();

    seed_payments(&conn).unwrap();

    let mismatches: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM appointment_payments p JOIN appointments a \
             ON a.id = p.appointment_id WHERE p.paid_at <> a.starts_at",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(mismatches, 0);
    let first_paid_at: String = conn
        .query_row(
            "SELECT paid_at FROM appointment_payments WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(first_paid_at, "2026-10-05T08:00");
}

#[test]
fn the_voided_payment_is_voided_thirty_minutes_later_by_the_owner() {
    let conn = base_data();

    seed_payments(&conn).unwrap();

    let (voided_at, voided_by, starts_at): (String, i64, String) = conn
        .query_row(
            "SELECT p.voided_at, p.voided_by, a.starts_at FROM appointment_payments p \
             JOIN appointments a ON a.id = p.appointment_id WHERE p.id = 7",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    let expected_voided_at: String = conn
        .query_row(
            "SELECT strftime('%Y-%m-%dT%H:%M', ?1, '+30 minutes')",
            [&starts_at],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(voided_at, expected_voided_at);
    assert_eq!(voided_by, owner_id(&conn));
    let voided_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM appointment_payments WHERE voided_at IS NOT NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(voided_count, 1);
}

#[test]
fn goes_through_the_service_so_creates_and_the_void_are_audited_for_the_owner() {
    let conn = base_data();

    seed_payments(&conn).unwrap();

    let (creates, voids, other_actors): (i64, i64, i64) = conn
        .query_row(
            "SELECT \
             COALESCE(SUM(action = 'create' AND entity = 'payment'), 0), \
             COALESCE(SUM(action = 'void' AND entity = 'payment' AND entity_id = 7), 0), \
             COALESCE(SUM(entity = 'payment' AND actor_user_id <> ?1), 0) \
             FROM audit_log",
            [owner_id(&conn)],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!((creates, voids, other_actors), (11, 1, 0));
}

#[test]
fn a_second_run_changes_nothing() {
    let conn = base_data();
    seed_payments(&conn).unwrap();
    let before = stored(&conn);
    let audit_rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM audit_log", [], |row| row.get(0))
        .unwrap();

    seed_payments(&conn).unwrap();

    assert_eq!(stored(&conn), before);
    let after: i64 = conn
        .query_row("SELECT COUNT(*) FROM audit_log", [], |row| row.get(0))
        .unwrap();
    assert_eq!(after, audit_rows);
}

#[test]
fn does_nothing_when_the_appointments_were_not_seeded() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    let policy = PasswordPolicy::new().unwrap();
    seed_if_empty(&conn, &policy, &env_with_password).unwrap();

    seed_payments(&conn).unwrap();

    assert_eq!(payment_count(&conn), 0);
}

#[test]
fn does_nothing_without_the_seeded_owner() {
    let conn = base_data();
    conn.execute(
        "UPDATE users SET active = 0 WHERE username = 'propietaria'",
        [],
    )
    .unwrap();

    seed_payments(&conn).unwrap();

    assert_eq!(payment_count(&conn), 0);
}

#[test]
fn the_env_entry_point_requires_the_seed_password() {
    let conn = base_data();

    seed_payments_if_empty(&conn, &|_| None).unwrap();
    assert_eq!(payment_count(&conn), 0);

    seed_payments_if_empty(&conn, &env_with_password).unwrap();
    assert_eq!(payment_count(&conn), 11);
}

#[test]
fn an_inactive_seeded_method_reports_the_rejection_and_rolls_everything_back() {
    let conn = base_data();
    conn.execute("UPDATE payment_methods SET active = 0 WHERE id = 3", [])
        .unwrap();

    let result = seed_payments(&conn);

    assert!(matches!(
        result,
        Err(SetupError::SeedPaymentRejected(PaymentError::Validation {
            field: "methodId"
        }))
    ));
    assert_eq!(payment_count(&conn), 0);
    let payment_audits: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM audit_log WHERE entity = 'payment'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(payment_audits, 0);
}
