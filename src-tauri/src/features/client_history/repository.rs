use rusqlite::Connection;

use crate::db::DbError;
use crate::features::appointments::model::AppointmentSummary;
use crate::features::appointments::repository::appointment_summary;
use crate::features::payments::model::{AmountsByCurrency, PaymentSummary};
use crate::features::payments::repository::payment_summary;

const ENTRIES_SQL: &str = "SELECT a.id, a.client_id, a.service_id, a.resource_id, a.starts_at, \
     a.ends_at, a.status, a.price_cents_snapshot, a.duration_min_snapshot, a.notes, \
     s.name, r.name \
     FROM appointments a \
     JOIN services s ON s.id = a.service_id \
     JOIN resources r ON r.id = a.resource_id \
     WHERE a.client_id = ?1 ORDER BY a.starts_at DESC, a.id DESC";

const PAYMENTS_SQL: &str = "SELECT p.id, p.appointment_id, p.method_id, p.currency, \
     p.amount_cents, p.rate_bs_per_usd_e4, p.usd_equivalent_cents, p.paid_at, p.voided_at, \
     p.voided_by, p.void_reason \
     FROM appointment_payments p JOIN appointments a ON a.id = p.appointment_id \
     WHERE a.client_id = ?1 ORDER BY p.paid_at, p.id";

const TOTALS_SQL: &str = "SELECT \
     (SELECT COALESCE(SUM(duration_min_snapshot), 0) FROM appointments \
        WHERE client_id = ?1 AND status = 'completed'), \
     COALESCE(SUM(CASE WHEN a.status = 'completed' AND p.currency = 'USD' \
        THEN p.amount_cents END), 0), \
     COALESCE(SUM(CASE WHEN a.status = 'completed' AND p.currency = 'VES' \
        THEN p.amount_cents END), 0), \
     COALESCE(SUM(CASE WHEN a.status IN ('cancelled', 'no_show') AND p.currency = 'USD' \
        THEN p.amount_cents END), 0), \
     COALESCE(SUM(CASE WHEN a.status IN ('cancelled', 'no_show') AND p.currency = 'VES' \
        THEN p.amount_cents END), 0), \
     COALESCE(SUM(CASE WHEN a.status = 'completed' AND p.currency = 'VES' \
        THEN p.usd_equivalent_cents END), 0), \
     COALESCE(SUM(CASE WHEN a.status IN ('scheduled', 'in_progress') AND p.currency = 'USD' \
        THEN p.amount_cents END), 0), \
     COALESCE(SUM(CASE WHEN a.status IN ('scheduled', 'in_progress') AND p.currency = 'VES' \
        THEN p.amount_cents END), 0) \
     FROM appointments a JOIN appointment_payments p ON p.appointment_id = a.id \
     WHERE a.client_id = ?1 AND p.voided_at IS NULL";

pub struct HistoryAppointment {
    pub appointment: AppointmentSummary,
    pub service_name: String,
    pub resource_name: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct HistoryTotals {
    pub total_minutes: i64,
    pub paid_completed: AmountsByCurrency,
    pub collected_on_non_completed: AmountsByCurrency,
    pub pending: AmountsByCurrency,
    pub ves_usd_equivalent_of_completed: i64,
}

pub fn client_appointments(
    conn: &Connection,
    client_id: i64,
) -> Result<Vec<HistoryAppointment>, DbError> {
    let mut statement = conn.prepare(ENTRIES_SQL)?;
    let rows = statement
        .query_map([client_id], |row| {
            Ok(HistoryAppointment {
                appointment: appointment_summary(row)?,
                service_name: row.get(10)?,
                resource_name: row.get(11)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn client_payments(conn: &Connection, client_id: i64) -> Result<Vec<PaymentSummary>, DbError> {
    let mut statement = conn.prepare(PAYMENTS_SQL)?;
    let rows = statement
        .query_map([client_id], payment_summary)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn client_totals(conn: &Connection, client_id: i64) -> Result<HistoryTotals, DbError> {
    let totals = conn.query_row(TOTALS_SQL, [client_id], |row| {
        Ok(HistoryTotals {
            total_minutes: row.get(0)?,
            paid_completed: AmountsByCurrency {
                usd: row.get(1)?,
                ves: row.get(2)?,
            },
            collected_on_non_completed: AmountsByCurrency {
                usd: row.get(3)?,
                ves: row.get(4)?,
            },
            ves_usd_equivalent_of_completed: row.get(5)?,
            pending: AmountsByCurrency {
                usd: row.get(6)?,
                ves: row.get(7)?,
            },
        })
    })?;
    Ok(totals)
}

#[cfg(test)]
#[path = "repository_test.rs"]
mod tests;
