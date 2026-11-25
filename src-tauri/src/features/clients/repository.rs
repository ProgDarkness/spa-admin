use rusqlite::{params, Connection, OptionalExtension, Row};

use super::model::{ClientFilter, ClientInput, ClientSummary};
use super::normalization::{like_pattern, search_key};
use crate::db::DbError;

const CLIENT_SUMMARY_SQL: &str =
    "SELECT id, first_name, last_name, national_id, phone, deleted_at FROM clients";

const LOCAL_MINUTE: &str = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";

fn client_summary(row: &Row<'_>) -> rusqlite::Result<ClientSummary> {
    Ok(ClientSummary {
        id: row.get(0)?,
        first_name: row.get(1)?,
        last_name: row.get(2)?,
        national_id: row.get(3)?,
        phone: row.get(4)?,
        deleted_at: row.get(5)?,
    })
}

fn key_of(client: &ClientInput) -> String {
    search_key(
        &client.first_name,
        &client.last_name,
        &client.national_id,
        &client.phone,
    )
}

pub fn list_clients(
    conn: &Connection,
    filter: &ClientFilter,
) -> Result<Vec<ClientSummary>, DbError> {
    let mut statement = conn.prepare(&format!(
        "{CLIENT_SUMMARY_SQL} WHERE (?1 OR deleted_at IS NULL) \
         AND search_key LIKE ?2 ESCAPE '\\' ORDER BY id"
    ))?;
    let clients = statement
        .query_map(
            params![filter.include_deleted, like_pattern(&filter.query)],
            client_summary,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(clients)
}

pub fn find_client(conn: &Connection, client_id: i64) -> Result<Option<ClientSummary>, DbError> {
    let client = conn
        .query_row(
            &format!("{CLIENT_SUMMARY_SQL} WHERE id = ?1"),
            [client_id],
            client_summary,
        )
        .optional()?;
    Ok(client)
}

pub fn find_client_by_national_id(
    conn: &Connection,
    national_id: &str,
) -> Result<Option<ClientSummary>, DbError> {
    let client = conn
        .query_row(
            &format!("{CLIENT_SUMMARY_SQL} WHERE national_id = ?1"),
            [national_id],
            client_summary,
        )
        .optional()?;
    Ok(client)
}

pub fn insert_client(
    conn: &Connection,
    client: &ClientInput,
    actor_id: i64,
) -> Result<i64, DbError> {
    conn.execute(
        "INSERT INTO clients \
         (first_name, last_name, national_id, phone, search_key, created_by, updated_by) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![
            client.first_name,
            client.last_name,
            client.national_id,
            client.phone,
            key_of(client),
            actor_id
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn apply_client_update(
    conn: &Connection,
    client_id: i64,
    client: &ClientInput,
    actor_id: i64,
) -> Result<(), DbError> {
    conn.execute(
        &format!(
            "UPDATE clients SET first_name = ?2, last_name = ?3, national_id = ?4, phone = ?5, \
             search_key = ?6, updated_at = {LOCAL_MINUTE}, updated_by = ?7 WHERE id = ?1"
        ),
        params![
            client_id,
            client.first_name,
            client.last_name,
            client.national_id,
            client.phone,
            key_of(client),
            actor_id
        ],
    )?;
    Ok(())
}

pub fn set_client_deleted(
    conn: &Connection,
    client_id: i64,
    deleted: bool,
    actor_id: i64,
) -> Result<(), DbError> {
    conn.execute(
        &format!(
            "UPDATE clients SET deleted_at = CASE WHEN ?2 THEN {LOCAL_MINUTE} END, \
             updated_at = {LOCAL_MINUTE}, updated_by = ?3 WHERE id = ?1"
        ),
        params![client_id, deleted, actor_id],
    )?;
    Ok(())
}

#[cfg(test)]
#[path = "repository_test.rs"]
mod tests;
