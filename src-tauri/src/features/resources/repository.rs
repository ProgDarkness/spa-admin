use rusqlite::types::Type;
use rusqlite::{params, Connection, OptionalExtension, Row};

use super::model::{ResourceFilter, ResourceInput, ResourceKind, ResourceSummary};
use crate::db::DbError;
use crate::features::named_records::{name_key, name_taken, NamedTable};

const RESOURCE_SUMMARY_SQL: &str =
    "SELECT id, name, kind, active, created_at, updated_at FROM resources";

const LOCAL_MINUTE: &str = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";

fn stored_kind(row: &Row<'_>, index: usize) -> rusqlite::Result<ResourceKind> {
    let raw: String = row.get(index)?;
    ResourceKind::parse(&raw)
        .ok_or_else(|| rusqlite::Error::InvalidColumnType(index, "kind".to_string(), Type::Text))
}

fn resource_summary(row: &Row<'_>) -> rusqlite::Result<ResourceSummary> {
    Ok(ResourceSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: stored_kind(row, 2)?,
        active: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

pub fn list_resources(
    conn: &Connection,
    filter: ResourceFilter,
) -> Result<Vec<ResourceSummary>, DbError> {
    let mut statement = conn.prepare(&format!(
        "{RESOURCE_SUMMARY_SQL} WHERE (?1 OR active = 1) ORDER BY name COLLATE NOCASE, id"
    ))?;
    let resources = statement
        .query_map([filter.include_inactive], resource_summary)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(resources)
}

pub fn find_resource(
    conn: &Connection,
    resource_id: i64,
) -> Result<Option<ResourceSummary>, DbError> {
    let resource = conn
        .query_row(
            &format!("{RESOURCE_SUMMARY_SQL} WHERE id = ?1"),
            [resource_id],
            resource_summary,
        )
        .optional()?;
    Ok(resource)
}

pub fn resource_name_taken(
    conn: &Connection,
    name: &str,
    except_resource_id: Option<i64>,
) -> Result<bool, DbError> {
    name_taken(conn, NamedTable::Resources, name, except_resource_id)
}

pub fn insert_resource(
    conn: &Connection,
    resource: &ResourceInput,
    actor_id: i64,
) -> Result<i64, DbError> {
    conn.execute(
        "INSERT INTO resources (name, name_key, kind, created_by, updated_by) \
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![
            resource.name,
            name_key(&resource.name),
            resource.kind.as_str(),
            actor_id
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn apply_resource_update(
    conn: &Connection,
    resource_id: i64,
    resource: &ResourceInput,
    actor_id: i64,
) -> Result<(), DbError> {
    conn.execute(
        &format!(
            "UPDATE resources SET name = ?2, name_key = ?3, kind = ?4, \
             updated_at = {LOCAL_MINUTE}, updated_by = ?5 WHERE id = ?1"
        ),
        params![
            resource_id,
            resource.name,
            name_key(&resource.name),
            resource.kind.as_str(),
            actor_id
        ],
    )?;
    Ok(())
}

pub fn set_resource_active(
    conn: &Connection,
    resource_id: i64,
    active: bool,
    actor_id: i64,
) -> Result<(), DbError> {
    conn.execute(
        &format!(
            "UPDATE resources SET active = ?2, updated_at = {LOCAL_MINUTE}, updated_by = ?3 \
             WHERE id = ?1"
        ),
        params![resource_id, active, actor_id],
    )?;
    Ok(())
}

#[cfg(test)]
#[path = "repository_test.rs"]
mod tests;
