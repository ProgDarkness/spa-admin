use rusqlite::{params, Connection, OptionalExtension, Row};

use super::model::ExchangeRate;
use crate::db::DbError;

const RATE_SQL: &str = "SELECT id, date, rate_bs_per_usd_e4 FROM exchange_rates";

const EXPECTED_AFFECTED_ROWS: usize = 1;

const LOCAL_MINUTE: &str = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredRate {
    pub id: i64,
    pub rate: ExchangeRate,
}

fn stored_rate(row: &Row<'_>) -> rusqlite::Result<StoredRate> {
    Ok(StoredRate {
        id: row.get(0)?,
        rate: ExchangeRate {
            date: row.get(1)?,
            rate_bs_per_usd_e4: row.get(2)?,
        },
    })
}

pub fn list_rates(conn: &Connection) -> Result<Vec<ExchangeRate>, DbError> {
    let mut statement = conn.prepare(&format!("{RATE_SQL} ORDER BY date DESC"))?;
    let rates = statement
        .query_map([], stored_rate)?
        .map(|stored| stored.map(|found| found.rate))
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rates)
}

pub fn find_rate(conn: &Connection, date: &str) -> Result<Option<StoredRate>, DbError> {
    let found = conn
        .query_row(&format!("{RATE_SQL} WHERE date = ?1"), [date], stored_rate)
        .optional()?;
    Ok(found)
}

pub fn insert_rate(conn: &Connection, rate: &ExchangeRate, actor_id: i64) -> Result<i64, DbError> {
    conn.execute(
        "INSERT INTO exchange_rates (date, rate_bs_per_usd_e4, created_by, updated_by) \
         VALUES (?1, ?2, ?3, ?3)",
        params![rate.date, rate.rate_bs_per_usd_e4, actor_id],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn apply_rate_value(
    conn: &Connection,
    rate_id: i64,
    rate_bs_per_usd_e4: i64,
    actor_id: i64,
) -> Result<(), DbError> {
    let affected = conn.execute(
        &format!(
            "UPDATE exchange_rates SET rate_bs_per_usd_e4 = ?2, \
             updated_at = {LOCAL_MINUTE}, updated_by = ?3 WHERE id = ?1"
        ),
        params![rate_id, rate_bs_per_usd_e4, actor_id],
    )?;
    if affected == EXPECTED_AFFECTED_ROWS {
        Ok(())
    } else {
        Err(rusqlite::Error::StatementChangedRows(affected).into())
    }
}

#[cfg(test)]
#[path = "repository_test.rs"]
mod tests;
