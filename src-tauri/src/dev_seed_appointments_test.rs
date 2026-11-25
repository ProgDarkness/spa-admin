use rusqlite::Connection;

use super::*;
use crate::db::migrate;
use crate::dev_seed::{seed_if_empty, SEED_PASSWORD_VAR};
use crate::dev_seed_catalog::seed_catalog_dated;
use crate::dev_seed_clients::seed_clients_if_empty;
use crate::features::audit::{AuditAction, AuditEntity};
use crate::features::auth::password::PasswordPolicy;

const REFERENCE_DAY: &str = "2026-11-12";

type StoredAppointment = (
    i64,
    i64,
    i64,
    i64,
    String,
    String,
    String,
    i64,
    i64,
    Option<String>,
);

type ExpectedRow = (
    i64,
    i64,
    i64,
    i64,
    &'static str,
    &'static str,
    &'static str,
    i64,
    i64,
);

const EXPECTED_AT_REFERENCE_DAY: [ExpectedRow; 16] = [
    (
        1,
        1,
        1,
        1,
        "2026-10-05T08:00",
        "2026-10-05T09:00",
        "completed",
        3_500,
        60,
    ),
    (
        2,
        2,
        8,
        1,
        "2026-10-15T10:00",
        "2026-10-15T10:45",
        "completed",
        5_000,
        45,
    ),
    (
        3,
        3,
        1,
        1,
        "2026-10-20T12:00",
        "2026-10-20T13:00",
        "cancelled",
        3_500,
        60,
    ),
    (
        4,
        1,
        2,
        1,
        "2026-11-01T14:00",
        "2026-11-01T15:00",
        "completed",
        4_000,
        60,
    ),
    (
        5,
        4,
        1,
        1,
        "2026-11-13T16:00",
        "2026-11-13T17:00",
        "scheduled",
        3_500,
        60,
    ),
    (
        6,
        5,
        2,
        1,
        "2026-11-10T18:00",
        "2026-11-10T19:00",
        "no_show",
        4_000,
        60,
    ),
    (
        7,
        6,
        6,
        2,
        "2026-10-10T08:00",
        "2026-10-10T09:30",
        "no_show",
        6_000,
        90,
    ),
    (
        8,
        7,
        7,
        2,
        "2026-10-25T10:00",
        "2026-10-25T11:00",
        "completed",
        12_000,
        60,
    ),
    (
        9,
        2,
        6,
        2,
        "2026-11-09T12:00",
        "2026-11-09T13:30",
        "completed",
        6_000,
        90,
    ),
    (
        10,
        3,
        1,
        2,
        "2026-11-11T14:00",
        "2026-11-11T15:00",
        "cancelled",
        3_500,
        60,
    ),
    (
        11,
        8,
        2,
        2,
        "2026-11-12T16:00",
        "2026-11-12T17:00",
        "in_progress",
        4_000,
        60,
    ),
    (
        12,
        1,
        3,
        2,
        "2026-11-14T18:00",
        "2026-11-14T18:30",
        "scheduled",
        1_000,
        30,
    ),
    (
        13,
        9,
        1,
        2,
        "2026-10-31T23:00",
        "2026-11-01T00:00",
        "completed",
        3_500,
        60,
    ),
    (
        14,
        2,
        4,
        3,
        "2026-10-07T08:00",
        "2026-10-07T08:45",
        "completed",
        1_500,
        45,
    ),
    (
        15,
        7,
        5,
        3,
        "2026-10-17T10:00",
        "2026-10-17T11:00",
        "completed",
        2_000,
        60,
    ),
    (
        16,
        5,
        4,
        3,
        "2026-11-10T12:00",
        "2026-11-10T12:45",
        "completed",
        1_500,
        45,
    ),
];

fn env_with_password(name: &str) -> Option<String> {
    (name == SEED_PASSWORD_VAR).then(|| "clave-de-desarrollo-1".to_string())
}

fn env_without_variables(_: &str) -> Option<String> {
    None
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

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap()
}

fn stored(conn: &Connection) -> Vec<StoredAppointment> {
    let mut statement = conn
        .prepare(
            "SELECT id, client_id, service_id, resource_id, starts_at, ends_at, status, \
             price_cents_snapshot, duration_min_snapshot, notes FROM appointments ORDER BY id",
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
                row.get(8)?,
                row.get(9)?,
            ))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn starts_of(conn: &Connection) -> Vec<String> {
    stored(conn).into_iter().map(|row| row.4).collect()
}

fn owner_id(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT id FROM users WHERE username = 'propietaria'",
        [],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn seeds_the_sixteen_mock_appointments_with_ids_one_to_sixteen() {
    let conn = base_data();

    seed_appointments_dated(&conn, REFERENCE_DAY).unwrap();

    let expected: Vec<StoredAppointment> = EXPECTED_AT_REFERENCE_DAY
        .iter()
        .map(
            |(id, client, service, resource, start, end, status, price, minutes)| {
                (
                    *id,
                    *client,
                    *service,
                    *resource,
                    start.to_string(),
                    end.to_string(),
                    status.to_string(),
                    *price,
                    *minutes,
                    None,
                )
            },
        )
        .collect();
    assert_eq!(stored(&conn), expected);
}

#[test]
fn dates_across_a_month_boundary_follow_the_mock_rules() {
    let conn = base_data();

    seed_appointments_dated(&conn, "2026-03-01").unwrap();

    let starts = starts_of(&conn);
    assert_eq!(starts[0], "2026-02-05T08:00");
    assert_eq!(starts[7], "2026-02-25T10:00");
    assert_eq!(starts[3], "2026-03-01T14:00");
    assert_eq!(starts[12], "2026-02-28T23:00");
    assert_eq!(starts[4], "2026-03-02T16:00");
    assert_eq!(starts[8], "2026-02-26T12:00");
}

#[test]
fn dates_across_a_year_boundary_use_the_previous_december() {
    let conn = base_data();

    seed_appointments_dated(&conn, "2026-01-05").unwrap();

    let starts = starts_of(&conn);
    assert_eq!(starts[0], "2025-12-05T08:00");
    assert_eq!(starts[12], "2025-12-31T23:00");
    assert_eq!(stored(&conn)[12].5, "2026-01-01T00:00");
    assert_eq!(starts[10], "2026-01-05T16:00");
}

#[test]
fn the_midnight_limit_appointment_ends_exactly_at_midnight_on_a_leap_february() {
    let conn = base_data();

    seed_appointments_dated(&conn, "2028-03-10").unwrap();

    let thirteenth = &stored(&conn)[12];
    assert_eq!(thirteenth.4, "2028-02-29T23:00");
    assert_eq!(thirteenth.5, "2028-03-01T00:00");
}

#[test]
fn snapshots_come_from_the_seeded_catalog_not_from_literals() {
    let conn = base_data();
    conn.execute(
        "UPDATE services SET price_cents = 9_900, duration_min = 120 WHERE id = 8",
        [],
    )
    .unwrap();

    seed_appointments_dated(&conn, REFERENCE_DAY).unwrap();

    let first = &stored(&conn)[1];
    assert_eq!((first.7, first.8), (9_900, 120));
    assert_eq!(first.5, "2026-10-15T12:00");
}

#[test]
fn inactive_service_resource_and_deleted_client_are_referenced_as_in_the_mock() {
    let conn = base_data();

    seed_appointments_dated(&conn, REFERENCE_DAY).unwrap();

    let referenced: (i64, i64, i64) = conn
        .query_row(
            "SELECT \
             (SELECT COUNT(*) FROM appointments a JOIN services s ON s.id = a.service_id WHERE s.active = 0), \
             (SELECT COUNT(*) FROM appointments a JOIN resources r ON r.id = a.resource_id WHERE r.active = 0), \
             (SELECT COUNT(*) FROM appointments a JOIN clients c ON c.id = a.client_id WHERE c.deleted_at IS NOT NULL)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(referenced, (1, 3, 1));
}

#[test]
fn audits_one_create_per_appointment_attributed_to_the_owner() {
    let conn = base_data();
    let before: i64 = count(&conn, "audit_log");

    seed_appointments_dated(&conn, REFERENCE_DAY).unwrap();

    let audited: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM audit_log WHERE action = ?1 AND entity = ?2 AND actor_user_id = ?3",
            rusqlite::params![
                AuditAction::Create.as_str(),
                AuditEntity::Appointment.as_str(),
                owner_id(&conn)
            ],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(audited, 16);
    assert_eq!(count(&conn, "audit_log"), before + 16);
    let stamped: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM appointments WHERE created_by = ?1 AND updated_by = ?1",
            [owner_id(&conn)],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stamped, 16);
}

#[test]
fn seeding_twice_changes_nothing() {
    let conn = base_data();
    seed_appointments_dated(&conn, REFERENCE_DAY).unwrap();
    let rows = stored(&conn);
    let audits = count(&conn, "audit_log");

    seed_appointments_dated(&conn, "2030-01-01").unwrap();

    assert_eq!(stored(&conn), rows);
    assert_eq!(count(&conn, "audit_log"), audits);
}

#[test]
fn an_existing_appointment_keeps_the_seed_from_running() {
    let conn = base_data();
    conn.execute(
        "INSERT INTO appointments (client_id, service_id, resource_id, starts_at, ends_at, \
         status, price_cents_snapshot, duration_min_snapshot) \
         VALUES (1, 1, 1, '2026-11-12T10:00', '2026-11-12T11:00', 'scheduled', 3500, 60)",
        [],
    )
    .unwrap();

    seed_appointments_dated(&conn, REFERENCE_DAY).unwrap();

    assert_eq!(count(&conn, "appointments"), 1);
}

#[test]
fn nothing_is_seeded_without_the_clients_and_the_catalog() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    let policy = PasswordPolicy::new().unwrap();
    seed_if_empty(&conn, &policy, &env_with_password).unwrap();

    seed_appointments_dated(&conn, REFERENCE_DAY).unwrap();

    assert_eq!(count(&conn, "appointments"), 0);
}

#[test]
fn nothing_is_seeded_without_the_development_password() {
    let conn = base_data();

    seed_appointments_if_empty(&conn, &env_without_variables).unwrap();

    assert_eq!(count(&conn, "appointments"), 0);
}

#[test]
fn nothing_is_seeded_with_an_empty_password_variable() {
    let conn = base_data();

    seed_appointments_if_empty(&conn, &|name| (name == SEED_PASSWORD_VAR).then(String::new))
        .unwrap();

    assert_eq!(count(&conn, "appointments"), 0);
}

#[test]
fn the_environment_driven_entry_point_seeds_relative_to_today() {
    let conn = base_data();

    seed_appointments_if_empty(&conn, &env_with_password).unwrap();

    assert_eq!(count(&conn, "appointments"), 16);
    let today: String = conn
        .query_row("SELECT date('now', 'localtime')", [], |row| row.get(0))
        .unwrap();
    assert_eq!(&stored(&conn)[10].4[..10], today);
}

#[test]
fn a_failing_audit_rolls_the_whole_seed_back() {
    let conn = base_data();
    conn.execute_batch(
        "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
         WHEN NEW.entity = 'appointment' AND NEW.entity_id = 9 \
         BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END",
    )
    .unwrap();

    let result = seed_appointments_dated(&conn, REFERENCE_DAY);

    assert!(result.is_err());
    assert_eq!(count(&conn, "appointments"), 0);
}
