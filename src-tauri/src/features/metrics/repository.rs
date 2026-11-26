use rusqlite::Connection;

use super::model::{AppointmentCounts, MetricsError};
use super::rules::MonthBounds;
use crate::db::DbError;
use crate::features::appointments::model::AppointmentStatus;
use crate::features::payments::model::AmountsByCurrency;

const COUNTS_SQL: &str = "SELECT status, COUNT(*) FROM appointments \
     WHERE starts_at >= ?1 AND starts_at < ?2 GROUP BY status";

const TURNOVER_SQL: &str = "SELECT COUNT(*), COALESCE(SUM(is_recurring), 0) FROM ( \
     SELECT EXISTS( \
        SELECT 1 FROM appointments earlier \
        WHERE earlier.client_id = a.client_id AND earlier.status = 'completed' \
          AND earlier.starts_at < ?1) AS is_recurring \
     FROM appointments a \
     WHERE a.status = 'completed' AND a.starts_at >= ?1 AND a.starts_at < ?2 \
     GROUP BY a.client_id)";

const AMOUNTS_SQL: &str = "SELECT \
     COALESCE(SUM(CASE WHEN a.status = 'completed' AND p.currency = 'USD' \
        THEN p.amount_cents END), 0), \
     COALESCE(SUM(CASE WHEN a.status = 'completed' AND p.currency = 'VES' \
        THEN p.amount_cents END), 0), \
     COALESCE(SUM(CASE WHEN a.status IN ('cancelled', 'no_show') AND p.currency = 'USD' \
        THEN p.amount_cents END), 0), \
     COALESCE(SUM(CASE WHEN a.status IN ('cancelled', 'no_show') AND p.currency = 'VES' \
        THEN p.amount_cents END), 0), \
     COALESCE(SUM(CASE WHEN a.status IN ('scheduled', 'in_progress') AND p.currency = 'USD' \
        THEN p.amount_cents END), 0), \
     COALESCE(SUM(CASE WHEN a.status IN ('scheduled', 'in_progress') AND p.currency = 'VES' \
        THEN p.amount_cents END), 0) \
     FROM appointments a JOIN appointment_payments p ON p.appointment_id = a.id \
     WHERE a.starts_at >= ?1 AND a.starts_at < ?2 AND p.voided_at IS NULL";

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ClientTurnover {
    pub new_clients: i64,
    pub recurring_clients: i64,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct MonthAmounts {
    pub revenue: AmountsByCurrency,
    pub collected_on_non_completed: AmountsByCurrency,
    pub pending: AmountsByCurrency,
}

const INTEGER_OVERFLOW_MESSAGE: &str = "integer overflow";

fn counts_from_rows(rows: Vec<(String, i64)>) -> Result<AppointmentCounts, MetricsError> {
    rows.into_iter()
        .try_fold(AppointmentCounts::default(), |counts, (status, total)| {
            let status = AppointmentStatus::parse(&status).ok_or(MetricsError::UnknownStatus)?;
            Ok(match status {
                AppointmentStatus::Scheduled => AppointmentCounts {
                    scheduled: total,
                    ..counts
                },
                AppointmentStatus::InProgress => AppointmentCounts {
                    in_progress: total,
                    ..counts
                },
                AppointmentStatus::Completed => AppointmentCounts {
                    completed: total,
                    ..counts
                },
                AppointmentStatus::Cancelled => AppointmentCounts {
                    cancelled: total,
                    ..counts
                },
                AppointmentStatus::NoShow => AppointmentCounts {
                    no_show: total,
                    ..counts
                },
            })
        })
}

fn amounts_failure(error: rusqlite::Error) -> MetricsError {
    match &error {
        rusqlite::Error::SqliteFailure(_, Some(message)) if message == INTEGER_OVERFLOW_MESSAGE => {
            MetricsError::TotalExceedsSafeRange
        }
        _ => MetricsError::Db(DbError::from(error)),
    }
}

pub fn status_counts(
    conn: &Connection,
    month: &MonthBounds,
) -> Result<AppointmentCounts, MetricsError> {
    let mut statement = conn.prepare(COUNTS_SQL).map_err(DbError::from)?;
    let rows = statement
        .query_map([&month.start, &month.end], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(DbError::from)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(DbError::from)?;
    counts_from_rows(rows)
}

pub fn client_turnover(
    conn: &Connection,
    month: &MonthBounds,
) -> Result<ClientTurnover, MetricsError> {
    let (active, recurring): (i64, i64) = conn
        .query_row(TURNOVER_SQL, [&month.start, &month.end], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(DbError::from)?;
    Ok(ClientTurnover {
        new_clients: active - recurring,
        recurring_clients: recurring,
    })
}

pub fn month_amounts(conn: &Connection, month: &MonthBounds) -> Result<MonthAmounts, MetricsError> {
    conn.query_row(AMOUNTS_SQL, [&month.start, &month.end], |row| {
        Ok(MonthAmounts {
            revenue: AmountsByCurrency {
                usd: row.get(0)?,
                ves: row.get(1)?,
            },
            collected_on_non_completed: AmountsByCurrency {
                usd: row.get(2)?,
                ves: row.get(3)?,
            },
            pending: AmountsByCurrency {
                usd: row.get(4)?,
                ves: row.get(5)?,
            },
        })
    })
    .map_err(amounts_failure)
}

#[cfg(test)]
#[path = "repository_test.rs"]
mod tests;
