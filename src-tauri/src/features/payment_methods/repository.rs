use rusqlite::{params, Connection, OptionalExtension, Row};

use super::model::{PaymentMethodFilter, PaymentMethodInput, PaymentMethodSummary};
use crate::db::DbError;
use crate::features::named_records::{name_key, name_taken, NamedTable};

const PAYMENT_METHOD_SUMMARY_SQL: &str =
    "SELECT id, name, active, created_at, updated_at FROM payment_methods";

const LOCAL_MINUTE: &str = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";

fn payment_method_summary(row: &Row<'_>) -> rusqlite::Result<PaymentMethodSummary> {
    Ok(PaymentMethodSummary {
        id: row.get(0)?,
        name: row.get(1)?,
        active: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

pub fn list_payment_methods(
    conn: &Connection,
    filter: PaymentMethodFilter,
) -> Result<Vec<PaymentMethodSummary>, DbError> {
    let mut statement = conn.prepare(&format!(
        "{PAYMENT_METHOD_SUMMARY_SQL} WHERE (?1 OR active = 1) ORDER BY name COLLATE NOCASE, id"
    ))?;
    let methods = statement
        .query_map([filter.include_inactive], payment_method_summary)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(methods)
}

pub fn find_payment_method(
    conn: &Connection,
    payment_method_id: i64,
) -> Result<Option<PaymentMethodSummary>, DbError> {
    let method = conn
        .query_row(
            &format!("{PAYMENT_METHOD_SUMMARY_SQL} WHERE id = ?1"),
            [payment_method_id],
            payment_method_summary,
        )
        .optional()?;
    Ok(method)
}

pub fn payment_method_name_taken(
    conn: &Connection,
    name: &str,
    except_payment_method_id: Option<i64>,
) -> Result<bool, DbError> {
    name_taken(
        conn,
        NamedTable::PaymentMethods,
        name,
        except_payment_method_id,
    )
}

pub fn insert_payment_method(
    conn: &Connection,
    method: &PaymentMethodInput,
    actor_id: i64,
) -> Result<i64, DbError> {
    conn.execute(
        "INSERT INTO payment_methods (name, name_key, created_by, updated_by) \
         VALUES (?1, ?2, ?3, ?3)",
        params![method.name, name_key(&method.name), actor_id],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn apply_payment_method_update(
    conn: &Connection,
    payment_method_id: i64,
    method: &PaymentMethodInput,
    actor_id: i64,
) -> Result<(), DbError> {
    conn.execute(
        &format!(
            "UPDATE payment_methods SET name = ?2, name_key = ?3, \
             updated_at = {LOCAL_MINUTE}, updated_by = ?4 WHERE id = ?1"
        ),
        params![
            payment_method_id,
            method.name,
            name_key(&method.name),
            actor_id
        ],
    )?;
    Ok(())
}

pub fn set_payment_method_active(
    conn: &Connection,
    payment_method_id: i64,
    active: bool,
    actor_id: i64,
) -> Result<(), DbError> {
    conn.execute(
        &format!(
            "UPDATE payment_methods SET active = ?2, updated_at = {LOCAL_MINUTE}, updated_by = ?3 \
             WHERE id = ?1"
        ),
        params![payment_method_id, active, actor_id],
    )?;
    Ok(())
}

#[cfg(test)]
#[path = "repository_test.rs"]
mod tests;
