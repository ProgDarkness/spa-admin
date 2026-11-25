use rusqlite::Connection;

use super::*;
use crate::db::migrate;
use crate::dev_seed::{seed_if_empty, SEED_PASSWORD_VAR};
use crate::dev_seed_catalog::seed_catalog_dated;
use crate::dev_seed_clients::seed_clients_if_empty;
use crate::features::auth::password::PasswordPolicy;

const REFERENCE_DAY: &str = "2026-11-12";

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
    conn
}

fn appointment_rows(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM appointments", [], |row| row.get(0))
        .unwrap()
}

fn rejection_of(result: Result<(), SetupError>) -> AppointmentError {
    match result.unwrap_err() {
        SetupError::SeedAppointmentRejected(cause) => cause,
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn a_catalog_that_makes_an_appointment_cross_midnight_reports_that_cause() {
    let conn = base_data();
    conn.execute("UPDATE services SET duration_min = 120 WHERE id = 1", [])
        .unwrap();

    let cause = rejection_of(seed_appointments_dated(&conn, REFERENCE_DAY));

    assert!(matches!(cause, AppointmentError::CrossesMidnight));
    assert_eq!(appointment_rows(&conn), 0);
}

#[test]
fn a_missing_seeded_service_reports_the_missing_reference() {
    let conn = base_data();
    conn.execute_batch(
        "DELETE FROM services WHERE id = 8; \
         INSERT INTO services (id, name, name_key, price_cents, duration_min) \
         VALUES (99, 'Otro', 'otro', 1000, 30);",
    )
    .unwrap();

    let cause = rejection_of(seed_appointments_dated(&conn, REFERENCE_DAY));

    assert!(matches!(
        cause,
        AppointmentError::ReferenceMissing { field: "serviceId" }
    ));
}

#[test]
fn an_unusable_reference_day_reports_a_database_error_not_a_generic_rejection() {
    let conn = base_data();

    let result = seed_appointments_dated(&conn, "no-es-fecha");

    assert!(matches!(result, Err(SetupError::Db(_))));
}
