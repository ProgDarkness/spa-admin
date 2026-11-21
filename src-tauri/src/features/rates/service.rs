use rusqlite::Connection;
use serde_json::{json, Value};

use super::model::{is_calendar_date, ExchangeRate, RatesError, MAX_RATE_E4};
use super::repository;
use crate::features::audit::{AuditAction, AuditEntity, Diff};
use crate::features::named_records::record_change;

const DATE_FIELD: &str = "date";
const RATE_FIELD: &str = "rateBsPerUsdE4";

fn require_calendar_date(date: &str) -> Result<(), RatesError> {
    if is_calendar_date(date) {
        Ok(())
    } else {
        Err(RatesError::Validation { field: DATE_FIELD })
    }
}

fn require_rate_in_range(rate_bs_per_usd_e4: i64) -> Result<(), RatesError> {
    if (1..=MAX_RATE_E4).contains(&rate_bs_per_usd_e4) {
        Ok(())
    } else {
        Err(RatesError::Validation { field: RATE_FIELD })
    }
}

fn record(
    conn: &Connection,
    actor_id: i64,
    action: AuditAction,
    rate_id: i64,
    diff: Option<Diff>,
) -> Result<(), RatesError> {
    Ok(record_change(
        conn,
        actor_id,
        action,
        AuditEntity::ExchangeRate,
        rate_id,
        diff,
    )?)
}

fn rate_snapshot(rate: &ExchangeRate) -> Value {
    json!({ RATE_FIELD: rate.rate_bs_per_usd_e4 })
}

fn date_context(rate: &ExchangeRate) -> Value {
    json!({ DATE_FIELD: rate.date })
}

pub fn get_rate(conn: &Connection, date: &str) -> Result<Option<ExchangeRate>, RatesError> {
    require_calendar_date(date)?;
    Ok(repository::find_rate(conn, date)?.map(|stored| stored.rate))
}

pub fn upsert_rate(
    conn: &Connection,
    actor_id: i64,
    date: &str,
    rate_bs_per_usd_e4: i64,
) -> Result<ExchangeRate, RatesError> {
    require_calendar_date(date)?;
    require_rate_in_range(rate_bs_per_usd_e4)?;
    let requested = ExchangeRate {
        date: date.to_string(),
        rate_bs_per_usd_e4,
    };
    match repository::find_rate(conn, date)? {
        None => create_rate(conn, actor_id, requested),
        Some(existing) => update_rate(conn, actor_id, existing, requested),
    }
}

fn create_rate(
    conn: &Connection,
    actor_id: i64,
    requested: ExchangeRate,
) -> Result<ExchangeRate, RatesError> {
    let id = repository::insert_rate(conn, &requested, actor_id)?;
    let diff = Diff::created(&json!({
        DATE_FIELD: requested.date,
        RATE_FIELD: requested.rate_bs_per_usd_e4,
    }));
    record(conn, actor_id, AuditAction::Create, id, diff)?;
    Ok(requested)
}

fn update_rate(
    conn: &Connection,
    actor_id: i64,
    existing: repository::StoredRate,
    requested: ExchangeRate,
) -> Result<ExchangeRate, RatesError> {
    if existing.rate == requested {
        return Ok(existing.rate);
    }
    repository::apply_rate_value(conn, existing.id, requested.rate_bs_per_usd_e4, actor_id)?;
    let diff = Diff::between_in_context(
        &date_context(&requested),
        &rate_snapshot(&existing.rate),
        &rate_snapshot(&requested),
    );
    record(conn, actor_id, AuditAction::Update, existing.id, diff)?;
    Ok(requested)
}

#[cfg(test)]
#[path = "service_test.rs"]
mod tests;
