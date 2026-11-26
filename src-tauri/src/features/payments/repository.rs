use rusqlite::types::Type;
use rusqlite::{params, Connection, OptionalExtension, Row};

use super::model::{PaymentCurrency, PaymentSummary};
use crate::db::DbError;

const PAYMENT_SUMMARY_SQL: &str = "SELECT id, appointment_id, method_id, currency, amount_cents, \
     rate_bs_per_usd_e4, usd_equivalent_cents, paid_at, voided_at, voided_by, void_reason \
     FROM appointment_payments";

const LOCAL_MINUTE: &str = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";

const CHRONOLOGICAL: &str = "ORDER BY paid_at, id";

const EXPECTED_AFFECTED_ROWS: usize = 1;

pub struct NewPayment {
    pub appointment_id: i64,
    pub method_id: i64,
    pub currency: PaymentCurrency,
    pub amount_cents: i64,
    pub rate_bs_per_usd_e4: Option<i64>,
    pub usd_equivalent_cents: i64,
    pub paid_at: String,
}

fn stored_currency(row: &Row<'_>, index: usize) -> rusqlite::Result<PaymentCurrency> {
    let raw: String = row.get(index)?;
    PaymentCurrency::parse(&raw).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(index, "currency".to_string(), Type::Text)
    })
}

pub(crate) fn payment_summary(row: &Row<'_>) -> rusqlite::Result<PaymentSummary> {
    Ok(PaymentSummary {
        id: row.get(0)?,
        appointment_id: row.get(1)?,
        method_id: row.get(2)?,
        currency: stored_currency(row, 3)?,
        amount_cents: row.get(4)?,
        rate_bs_per_usd_e4: row.get(5)?,
        usd_equivalent_cents: row.get(6)?,
        paid_at: row.get(7)?,
        voided_at: row.get(8)?,
        voided_by: row.get(9)?,
        void_reason: row.get(10)?,
    })
}

pub fn insert_payment(
    conn: &Connection,
    payment: &NewPayment,
    actor_id: i64,
) -> Result<i64, DbError> {
    conn.execute(
        "INSERT INTO appointment_payments (appointment_id, method_id, currency, amount_cents, \
         rate_bs_per_usd_e4, usd_equivalent_cents, paid_at, created_by, updated_by) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            payment.appointment_id,
            payment.method_id,
            payment.currency.as_str(),
            payment.amount_cents,
            payment.rate_bs_per_usd_e4,
            payment.usd_equivalent_cents,
            payment.paid_at,
            actor_id
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn find_payment(conn: &Connection, payment_id: i64) -> Result<Option<PaymentSummary>, DbError> {
    let payment = conn
        .query_row(
            &format!("{PAYMENT_SUMMARY_SQL} WHERE id = ?1"),
            [payment_id],
            payment_summary,
        )
        .optional()?;
    Ok(payment)
}

pub fn list_payments_of_appointment(
    conn: &Connection,
    appointment_id: i64,
) -> Result<Vec<PaymentSummary>, DbError> {
    let mut statement = conn.prepare(&format!(
        "{PAYMENT_SUMMARY_SQL} WHERE appointment_id = ?1 {CHRONOLOGICAL}"
    ))?;
    let rows = statement
        .query_map([appointment_id], payment_summary)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn mark_voided(
    conn: &Connection,
    payment_id: i64,
    voided_at: &str,
    actor_id: i64,
    reason: &str,
) -> Result<bool, DbError> {
    let affected = conn.execute(
        &format!(
            "UPDATE appointment_payments SET voided_at = ?2, voided_by = ?3, void_reason = ?4, \
             updated_at = {LOCAL_MINUTE}, updated_by = ?3 WHERE id = ?1 AND voided_at IS NULL"
        ),
        params![payment_id, voided_at, actor_id, reason],
    )?;
    Ok(affected == EXPECTED_AFFECTED_ROWS)
}

#[cfg(test)]
#[path = "repository_test.rs"]
mod tests;
