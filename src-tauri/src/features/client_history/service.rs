use std::collections::HashMap;

use rusqlite::Connection;

use super::model::{ClientHistory, ClientHistoryEntry, ClientHistoryError};
use super::repository::{self, HistoryTotals};
use crate::features::clients::repository::find_client;
use crate::features::payments::model::PaymentSummary;
use crate::features::payments::rules::MAX_JS_SAFE_INTEGER;

fn payments_by_appointment(payments: Vec<PaymentSummary>) -> HashMap<i64, Vec<PaymentSummary>> {
    payments
        .into_iter()
        .fold(HashMap::new(), |mut grouped, payment| {
            grouped
                .entry(payment.appointment_id)
                .or_insert_with(Vec::new)
                .push(payment);
            grouped
        })
}

fn require_safe_totals(totals: &HistoryTotals) -> Result<(), ClientHistoryError> {
    let aggregates = [
        totals.total_minutes,
        totals.paid_completed.usd,
        totals.paid_completed.ves,
        totals.collected_on_non_completed.usd,
        totals.collected_on_non_completed.ves,
        totals.pending.usd,
        totals.pending.ves,
        totals.ves_usd_equivalent_of_completed,
    ];
    if aggregates
        .iter()
        .all(|total| (0..=MAX_JS_SAFE_INTEGER).contains(total))
    {
        Ok(())
    } else {
        Err(ClientHistoryError::TotalExceedsSafeRange)
    }
}

pub fn client_history(
    conn: &Connection,
    client_id: i64,
) -> Result<ClientHistory, ClientHistoryError> {
    let client = find_client(conn, client_id)?.ok_or(ClientHistoryError::NotFound)?;
    let mut grouped = payments_by_appointment(repository::client_payments(conn, client_id)?);
    let entries = repository::client_appointments(conn, client_id)?
        .into_iter()
        .map(|row| ClientHistoryEntry {
            payments: grouped.remove(&row.appointment.id).unwrap_or_default(),
            appointment: row.appointment,
            service_name: row.service_name,
            resource_name: row.resource_name,
        })
        .collect();
    let totals = repository::client_totals(conn, client_id)?;
    require_safe_totals(&totals)?;
    Ok(ClientHistory {
        client,
        entries,
        total_minutes: totals.total_minutes,
        paid_by_currency: totals.paid_completed,
        collected_on_non_completed_by_currency: totals.collected_on_non_completed,
        ves_usd_equivalent_of_completed: totals.ves_usd_equivalent_of_completed,
        pending_by_currency: totals.pending,
    })
}

#[cfg(test)]
#[path = "service_test.rs"]
mod tests;
