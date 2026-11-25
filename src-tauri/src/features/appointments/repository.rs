use rusqlite::types::Type;
use rusqlite::{params, Connection, OptionalExtension, Row};

use super::model::{AppointmentRange, AppointmentStatus, AppointmentSummary};
use crate::db::DbError;

const APPOINTMENT_SUMMARY_SQL: &str = "SELECT id, client_id, service_id, resource_id, starts_at, \
     ends_at, status, price_cents_snapshot, duration_min_snapshot, notes FROM appointments";

const LOCAL_MINUTE: &str = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";

const CHRONOLOGICAL: &str = "ORDER BY starts_at, id";

const SLOT_BLOCKING_STATUSES_SQL: &str = "status IN ('scheduled', 'in_progress', 'completed')";

pub struct NewAppointment {
    pub client_id: i64,
    pub service_id: i64,
    pub resource_id: i64,
    pub starts_at: String,
    pub ends_at: String,
    pub price_cents_snapshot: i64,
    pub duration_min_snapshot: i64,
    pub notes: Option<String>,
}

fn stored_status(row: &Row<'_>, index: usize) -> rusqlite::Result<AppointmentStatus> {
    let raw: String = row.get(index)?;
    AppointmentStatus::parse(&raw)
        .ok_or_else(|| rusqlite::Error::InvalidColumnType(index, "status".to_string(), Type::Text))
}

pub(crate) fn appointment_summary(row: &Row<'_>) -> rusqlite::Result<AppointmentSummary> {
    Ok(AppointmentSummary {
        id: row.get(0)?,
        client_id: row.get(1)?,
        service_id: row.get(2)?,
        resource_id: row.get(3)?,
        starts_at: row.get(4)?,
        ends_at: row.get(5)?,
        status: stored_status(row, 6)?,
        price_cents_snapshot: row.get(7)?,
        duration_min_snapshot: row.get(8)?,
        notes: row.get(9)?,
    })
}

pub fn local_minute_now(conn: &Connection) -> Result<String, DbError> {
    let now = conn.query_row(&format!("SELECT {LOCAL_MINUTE}"), [], |row| row.get(0))?;
    Ok(now)
}

pub fn insert_appointment(
    conn: &Connection,
    appointment: &NewAppointment,
    actor_id: i64,
) -> Result<i64, DbError> {
    conn.execute(
        "INSERT INTO appointments (client_id, service_id, resource_id, starts_at, ends_at, \
         price_cents_snapshot, duration_min_snapshot, notes, status, created_by, updated_by) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'scheduled', ?9, ?9)",
        params![
            appointment.client_id,
            appointment.service_id,
            appointment.resource_id,
            appointment.starts_at,
            appointment.ends_at,
            appointment.price_cents_snapshot,
            appointment.duration_min_snapshot,
            appointment.notes,
            actor_id
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn find_appointment(
    conn: &Connection,
    appointment_id: i64,
) -> Result<Option<AppointmentSummary>, DbError> {
    let appointment = conn
        .query_row(
            &format!("{APPOINTMENT_SUMMARY_SQL} WHERE id = ?1"),
            [appointment_id],
            appointment_summary,
        )
        .optional()?;
    Ok(appointment)
}

fn list_in_range_sql() -> String {
    format!(
        "{APPOINTMENT_SUMMARY_SQL} WHERE starts_at >= ?1 || 'T00:00' \
         AND starts_at < date(?2, '+1 day') || 'T00:00' \
         AND (?3 IS NULL OR resource_id = ?3) {CHRONOLOGICAL}"
    )
}

pub fn list_appointments(
    conn: &Connection,
    range: &AppointmentRange,
) -> Result<Vec<AppointmentSummary>, DbError> {
    let mut statement = conn.prepare(&list_in_range_sql())?;
    let rows = statement
        .query_map(
            params![range.from, range.to, range.resource_id],
            appointment_summary,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn list_all_appointments(conn: &Connection) -> Result<Vec<AppointmentSummary>, DbError> {
    let mut statement = conn.prepare(&format!("{APPOINTMENT_SUMMARY_SQL} {CHRONOLOGICAL}"))?;
    let rows = statement
        .query_map([], appointment_summary)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn find_overlaps(
    conn: &Connection,
    resource_id: i64,
    starts_at: &str,
    ends_at: &str,
    except_id: Option<i64>,
) -> Result<Vec<i64>, DbError> {
    let mut statement = conn.prepare(&format!(
        "SELECT id FROM appointments WHERE resource_id = ?1 AND starts_at < ?3 AND ends_at > ?2 \
         AND {SLOT_BLOCKING_STATUSES_SQL} AND id IS NOT ?4 {CHRONOLOGICAL}"
    ))?;
    let ids = statement
        .query_map(params![resource_id, starts_at, ends_at, except_id], |row| {
            row.get(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ids)
}

pub fn update_slot(
    conn: &Connection,
    appointment_id: i64,
    resource_id: i64,
    starts_at: &str,
    ends_at: &str,
    actor_id: i64,
) -> Result<(), DbError> {
    conn.execute(
        &format!(
            "UPDATE appointments SET resource_id = ?2, starts_at = ?3, ends_at = ?4, \
             updated_at = {LOCAL_MINUTE}, updated_by = ?5 WHERE id = ?1"
        ),
        params![appointment_id, resource_id, starts_at, ends_at, actor_id],
    )?;
    Ok(())
}

pub fn set_status(
    conn: &Connection,
    appointment_id: i64,
    status: AppointmentStatus,
    actor_id: i64,
) -> Result<(), DbError> {
    conn.execute(
        &format!(
            "UPDATE appointments SET status = ?2, updated_at = {LOCAL_MINUTE}, updated_by = ?3 \
             WHERE id = ?1"
        ),
        params![appointment_id, status.as_str(), actor_id],
    )?;
    Ok(())
}

pub fn future_scheduled_of_resource(
    conn: &Connection,
    resource_id: i64,
    now: &str,
) -> Result<Vec<AppointmentSummary>, DbError> {
    let mut statement = conn.prepare(&format!(
        "{APPOINTMENT_SUMMARY_SQL} WHERE resource_id = ?1 AND status = 'scheduled' \
         AND ends_at > ?2 {CHRONOLOGICAL}"
    ))?;
    let rows = statement
        .query_map(params![resource_id, now], appointment_summary)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[cfg(test)]
#[path = "repository_test.rs"]
mod tests;
