use rusqlite::Connection;

use super::model::{MetricsError, MonthlyMetrics};
use super::repository::{self, MonthAmounts};
use super::rules::month_bounds;
use crate::features::payments::model::AmountsByCurrency;
use crate::features::payments::rules::MAX_JS_SAFE_INTEGER;

fn is_safe(total: i64) -> bool {
    (0..=MAX_JS_SAFE_INTEGER).contains(&total)
}

fn require_safe_totals(amounts: &MonthAmounts) -> Result<(), MetricsError> {
    let buckets: [&AmountsByCurrency; 3] = [
        &amounts.revenue,
        &amounts.collected_on_non_completed,
        &amounts.pending,
    ];
    if buckets
        .iter()
        .all(|bucket| is_safe(bucket.usd) && is_safe(bucket.ves))
    {
        Ok(())
    } else {
        Err(MetricsError::TotalExceedsSafeRange)
    }
}

pub fn monthly_metrics(conn: &Connection, month: &str) -> Result<MonthlyMetrics, MetricsError> {
    let bounds = month_bounds(month)?;
    let appointments = repository::status_counts(conn, &bounds)?;
    let turnover = repository::client_turnover(conn, &bounds)?;
    let amounts = repository::month_amounts(conn, &bounds)?;
    require_safe_totals(&amounts)?;
    Ok(MonthlyMetrics {
        month: month.to_string(),
        new_clients: turnover.new_clients,
        recurring_clients: turnover.recurring_clients,
        appointments,
        revenue_by_currency: amounts.revenue,
        collected_on_non_completed_by_currency: amounts.collected_on_non_completed,
        pending_by_currency: amounts.pending,
    })
}

#[cfg(test)]
#[path = "service_test.rs"]
mod tests;
