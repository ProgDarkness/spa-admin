use rusqlite::Connection;

use crate::db::DbError;
use crate::dev_seed::configured_password;
use crate::dev_seed_catalog::{local_today, seeded_owner_id};
use crate::features::appointments::model::{AppointmentError, AppointmentStatus};
use crate::features::appointments::repository::{self, NewAppointment};
use crate::features::appointments::service::{
    appointment_snapshot, record, require_appointment, slot_end,
};
use crate::features::audit::{AuditAction, Diff};
use crate::features::catalog::repository::find_service;
use crate::setup::SetupError;

impl From<AppointmentError> for SetupError {
    fn from(error: AppointmentError) -> Self {
        match error {
            AppointmentError::Auth(inner) => SetupError::Auth(inner),
            AppointmentError::Db(inner) => SetupError::Db(inner),
            other => SetupError::SeedAppointmentRejected(other),
        }
    }
}

const SEEDED_CLIENTS: i64 = 9;
const SEEDED_SERVICES: i64 = 8;
const MIDNIGHT_LIMIT_HOUR: u32 = 23;

#[derive(Clone, Copy)]
enum SeedDay {
    PreviousMonth(i64),
    PreviousMonthLastDay,
    MonthStart,
    Today(i64),
}

struct SeedAppointment {
    resource_id: i64,
    hour: u32,
    day: SeedDay,
    client_id: i64,
    service_id: i64,
    status: AppointmentStatus,
}

const fn seed(
    resource_id: i64,
    hour: u32,
    day: SeedDay,
    client_id: i64,
    service_id: i64,
    status: AppointmentStatus,
) -> SeedAppointment {
    SeedAppointment {
        resource_id,
        hour,
        day,
        client_id,
        service_id,
        status,
    }
}

const SEED_APPOINTMENTS: [SeedAppointment; 16] = [
    seed(
        1,
        8,
        SeedDay::PreviousMonth(4),
        1,
        1,
        AppointmentStatus::Completed,
    ),
    seed(
        1,
        10,
        SeedDay::PreviousMonth(14),
        2,
        8,
        AppointmentStatus::Completed,
    ),
    seed(
        1,
        12,
        SeedDay::PreviousMonth(19),
        3,
        1,
        AppointmentStatus::Cancelled,
    ),
    seed(
        1,
        14,
        SeedDay::MonthStart,
        1,
        2,
        AppointmentStatus::Completed,
    ),
    seed(1, 16, SeedDay::Today(1), 4, 1, AppointmentStatus::Scheduled),
    seed(1, 18, SeedDay::Today(-2), 5, 2, AppointmentStatus::NoShow),
    seed(
        2,
        8,
        SeedDay::PreviousMonth(9),
        6,
        6,
        AppointmentStatus::NoShow,
    ),
    seed(
        2,
        10,
        SeedDay::PreviousMonth(24),
        7,
        7,
        AppointmentStatus::Completed,
    ),
    seed(
        2,
        12,
        SeedDay::Today(-3),
        2,
        6,
        AppointmentStatus::Completed,
    ),
    seed(
        2,
        14,
        SeedDay::Today(-1),
        3,
        1,
        AppointmentStatus::Cancelled,
    ),
    seed(
        2,
        16,
        SeedDay::Today(0),
        8,
        2,
        AppointmentStatus::InProgress,
    ),
    seed(2, 18, SeedDay::Today(2), 1, 3, AppointmentStatus::Scheduled),
    seed(
        2,
        MIDNIGHT_LIMIT_HOUR,
        SeedDay::PreviousMonthLastDay,
        9,
        1,
        AppointmentStatus::Completed,
    ),
    seed(
        3,
        8,
        SeedDay::PreviousMonth(6),
        2,
        4,
        AppointmentStatus::Completed,
    ),
    seed(
        3,
        10,
        SeedDay::PreviousMonth(16),
        7,
        5,
        AppointmentStatus::Completed,
    ),
    seed(
        3,
        12,
        SeedDay::Today(-2),
        5,
        4,
        AppointmentStatus::Completed,
    ),
];

struct Calendar {
    today: String,
    previous_month_start: String,
    previous_month_last_day: String,
    month_start: String,
}

fn shifted_date(conn: &Connection, base: &str, modifier: &str) -> Result<String, DbError> {
    let shifted: Option<String> =
        conn.query_row("SELECT date(?1, ?2)", [base, modifier], |row| row.get(0))?;
    shifted.ok_or(DbError::InvalidInstant)
}

impl Calendar {
    fn of(conn: &Connection, today: &str) -> Result<Self, DbError> {
        let month_start = shifted_date(conn, today, "start of month")?;
        let previous_month_last_day = shifted_date(conn, &month_start, "-1 day")?;
        let previous_month_start = shifted_date(conn, &previous_month_last_day, "start of month")?;
        Ok(Self {
            today: today.to_string(),
            previous_month_start,
            previous_month_last_day,
            month_start,
        })
    }

    fn resolve(&self, conn: &Connection, day: SeedDay) -> Result<String, DbError> {
        match day {
            SeedDay::PreviousMonth(offset) => shifted_date(
                conn,
                &self.previous_month_start,
                &format!("{offset:+} days"),
            ),
            SeedDay::PreviousMonthLastDay => Ok(self.previous_month_last_day.clone()),
            SeedDay::MonthStart => Ok(self.month_start.clone()),
            SeedDay::Today(offset) => shifted_date(conn, &self.today, &format!("{offset:+} days")),
        }
    }
}

fn has_no_appointments(conn: &Connection) -> Result<bool, DbError> {
    let rows: i64 = conn.query_row("SELECT COUNT(*) FROM appointments", [], |row| row.get(0))?;
    Ok(rows == 0)
}

fn has_seeded_references(conn: &Connection) -> Result<bool, DbError> {
    let referenced: bool = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM clients) >= ?1 AND (SELECT COUNT(*) FROM services) >= ?2",
        [SEEDED_CLIENTS, SEEDED_SERVICES],
        |row| row.get(0),
    )?;
    Ok(referenced)
}

fn insert_seed_appointment(
    conn: &Connection,
    owner_id: i64,
    calendar: &Calendar,
    spec: &SeedAppointment,
) -> Result<(), SetupError> {
    let service =
        find_service(conn, spec.service_id)?.ok_or(SetupError::SeedAppointmentRejected(
            AppointmentError::ReferenceMissing { field: "serviceId" },
        ))?;
    let day = calendar.resolve(conn, spec.day)?;
    let starts_at = format!("{day}T{:02}:00", spec.hour);
    let ends_at = slot_end(&starts_at, service.duration_min)?;
    let draft = NewAppointment {
        client_id: spec.client_id,
        service_id: spec.service_id,
        resource_id: spec.resource_id,
        starts_at,
        ends_at,
        price_cents_snapshot: service.price_cents,
        duration_min_snapshot: service.duration_min,
        notes: None,
    };
    let id = repository::insert_appointment(conn, &draft, owner_id)?;
    repository::set_status(conn, id, spec.status, owner_id)?;
    let created = require_appointment(conn, id)?;
    let diff = Diff::created(&appointment_snapshot(&created));
    record(conn, owner_id, AuditAction::Create, id, diff)?;
    Ok(())
}

pub fn seed_appointments_dated(conn: &Connection, today: &str) -> Result<(), SetupError> {
    let Some(owner_id) = seeded_owner_id(conn)? else {
        return Ok(());
    };
    let transaction = conn.unchecked_transaction().map_err(DbError::from)?;
    if has_no_appointments(&transaction)? && has_seeded_references(&transaction)? {
        let calendar = Calendar::of(&transaction, today)?;
        for spec in &SEED_APPOINTMENTS {
            insert_seed_appointment(&transaction, owner_id, &calendar, spec)?;
        }
    }
    transaction.commit().map_err(DbError::from)?;
    Ok(())
}

pub fn seed_appointments_if_empty(
    conn: &Connection,
    read_env: &dyn Fn(&str) -> Option<String>,
) -> Result<(), SetupError> {
    if configured_password(read_env).is_none() {
        return Ok(());
    }
    let today = local_today(conn)?;
    seed_appointments_dated(conn, &today)
}

#[cfg(test)]
#[path = "dev_seed_appointments_test.rs"]
mod tests;

#[cfg(test)]
#[path = "dev_seed_appointments_errors_test.rs"]
mod error_tests;
