use rusqlite::Connection;
use serde_json::Value;

use super::model::{AppointmentError, AppointmentInput, AppointmentSummary};
use super::service;
use crate::db::{migrate, Database};
use crate::features::audit::repository::list_all;
use crate::features::audit::AuditEntry;
use crate::features::users::repository::{insert_user, NewUserRow};

pub(crate) const OWNER_ROLE: i64 = 1;
pub(crate) const ACTIVE_CLIENT: i64 = 1;
pub(crate) const DELETED_CLIENT: i64 = 2;
pub(crate) const ACTIVE_SERVICE: i64 = 1;
pub(crate) const INACTIVE_SERVICE: i64 = 2;
pub(crate) const CABIN_ONE: i64 = 1;
pub(crate) const CABIN_TWO: i64 = 2;
pub(crate) const INACTIVE_RESOURCE: i64 = 3;
pub(crate) const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";

pub(crate) struct Fixture {
    pub database: Database,
    pub actor: i64,
}

pub(crate) fn fixture() -> Fixture {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    let row = NewUserRow {
        username: "duena".to_string(),
        password_hash: "hash-opaco".to_string(),
        role_id: OWNER_ROLE,
    };
    let actor = insert_user(&conn, &row, None).unwrap();
    conn.execute_batch(
        "INSERT INTO clients (id, first_name, last_name, national_id, phone, search_key) VALUES
            (1, 'Ana', 'Perez', 'V-12345678', '0414', 'k'),
            (2, 'Luis', 'Gil', 'V-87654321', '0414', 'k');
         UPDATE clients SET deleted_at = '2026-11-01T10:00' WHERE id = 2;
         INSERT INTO services (id, name, name_key, price_cents, duration_min, active) VALUES
            (1, 'Facial', 'facial', 3500, 60, 1),
            (2, 'Peeling', 'peeling', 5000, 45, 0),
            (3, 'Corporal', 'corporal', 6000, 90, 1);",
    )
    .unwrap();
    Fixture {
        database: Database::new(conn),
        actor,
    }
}

pub(crate) fn input(
    client_id: i64,
    service_id: i64,
    resource_id: i64,
    starts_at: &str,
) -> AppointmentInput {
    AppointmentInput {
        client_id,
        service_id,
        resource_id,
        starts_at: starts_at.to_string(),
        notes: None,
    }
}

pub(crate) fn facial(resource_id: i64, starts_at: &str) -> AppointmentInput {
    input(ACTIVE_CLIENT, ACTIVE_SERVICE, resource_id, starts_at)
}

pub(crate) fn try_create(
    fixture: &Fixture,
    request: &AppointmentInput,
) -> Result<AppointmentSummary, AppointmentError> {
    fixture
        .database
        .with_tx(|tx| service::create_appointment(tx, fixture.actor, request))
}

pub(crate) fn create(fixture: &Fixture, request: &AppointmentInput) -> AppointmentSummary {
    try_create(fixture, request).unwrap()
}

pub(crate) fn audit_rows(fixture: &Fixture) -> Vec<AuditEntry> {
    fixture.database.with_conn(list_all).unwrap()
}

pub(crate) fn diff_of(entry: &AuditEntry) -> Value {
    serde_json::from_str(entry.diff.as_ref().unwrap()).unwrap()
}

pub(crate) fn execute(fixture: &Fixture, sql: &str) {
    fixture
        .database
        .with_conn(|conn| Ok(conn.execute_batch(sql)?))
        .unwrap();
}

pub(crate) fn appointment_count(fixture: &Fixture) -> i64 {
    fixture
        .database
        .with_conn(|conn| {
            Ok(conn.query_row("SELECT COUNT(*) FROM appointments", [], |row| row.get(0))?)
        })
        .unwrap()
}

pub(crate) fn stored(fixture: &Fixture, id: i64) -> AppointmentSummary {
    fixture
        .database
        .with_conn(|conn| super::repository::find_appointment(conn, id))
        .unwrap()
        .unwrap()
}
