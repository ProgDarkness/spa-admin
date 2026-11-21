use rusqlite::{params, Connection, OptionalExtension, Row};

use super::model::{ServiceFilter, ServiceInput, ServiceSummary};
use crate::db::DbError;
use crate::features::named_records::{name_key, name_taken, NamedTable};

const SERVICE_SUMMARY_SQL: &str = "SELECT id, name, price_cents, currency, duration_min, \
     active, created_at, updated_at FROM services";

const LOCAL_MINUTE: &str = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";

fn service_summary(row: &Row<'_>) -> rusqlite::Result<ServiceSummary> {
    Ok(ServiceSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        price_cents: row.get(2)?,
        currency: row.get(3)?,
        duration_min: row.get(4)?,
        active: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub fn list_services(
    conn: &Connection,
    filter: ServiceFilter,
) -> Result<Vec<ServiceSummary>, DbError> {
    let mut statement = conn.prepare(&format!(
        "{SERVICE_SUMMARY_SQL} WHERE (?1 OR active = 1) ORDER BY name COLLATE NOCASE"
    ))?;
    let services = statement
        .query_map([filter.include_inactive], service_summary)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(services)
}

pub fn find_service(conn: &Connection, service_id: i64) -> Result<Option<ServiceSummary>, DbError> {
    let service = conn
        .query_row(
            &format!("{SERVICE_SUMMARY_SQL} WHERE id = ?1"),
            [service_id],
            service_summary,
        )
        .optional()?;
    Ok(service)
}

pub fn service_name_taken(
    conn: &Connection,
    name: &str,
    except_service_id: Option<i64>,
) -> Result<bool, DbError> {
    name_taken(conn, NamedTable::Services, name, except_service_id)
}

pub fn insert_service(
    conn: &Connection,
    service: &ServiceInput,
    actor_id: i64,
) -> Result<i64, DbError> {
    conn.execute(
        "INSERT INTO services (name, name_key, price_cents, duration_min, created_by, updated_by) \
         VALUES (?1, ?5, ?2, ?3, ?4, ?4)",
        params![
            service.name,
            service.price_cents,
            service.duration_min,
            actor_id,
            name_key(&service.name)
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn apply_service_update(
    conn: &Connection,
    service_id: i64,
    service: &ServiceInput,
    actor_id: i64,
) -> Result<(), DbError> {
    conn.execute(
        &format!(
            "UPDATE services SET name = ?2, name_key = ?6, price_cents = ?3, duration_min = ?4, \
             updated_at = {LOCAL_MINUTE}, updated_by = ?5 WHERE id = ?1"
        ),
        params![
            service_id,
            service.name,
            service.price_cents,
            service.duration_min,
            actor_id,
            name_key(&service.name)
        ],
    )?;
    Ok(())
}

pub fn set_service_active(
    conn: &Connection,
    service_id: i64,
    active: bool,
    actor_id: i64,
) -> Result<(), DbError> {
    conn.execute(
        &format!(
            "UPDATE services SET active = ?2, updated_at = {LOCAL_MINUTE}, updated_by = ?3 \
             WHERE id = ?1"
        ),
        params![service_id, active, actor_id],
    )?;
    Ok(())
}

#[cfg(test)]
#[path = "repository_test.rs"]
mod tests;
