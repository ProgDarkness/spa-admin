use rusqlite::Connection;

use crate::db::DbError;
use crate::dev_seed::configured_password;
use crate::dev_seed_catalog::seeded_owner_id;
use crate::features::payments::model::{
    PaymentCurrency, PaymentError, PaymentInput, PaymentVoidRequest,
};
use crate::features::payments::service::{create_payment_at, void_payment_at};
use crate::setup::SetupError;

impl From<PaymentError> for SetupError {
    fn from(error: PaymentError) -> Self {
        match error {
            PaymentError::Auth(inner) => SetupError::Auth(inner),
            PaymentError::Db(inner) => SetupError::Db(inner),
            other => SetupError::SeedPaymentRejected(other),
        }
    }
}

const SEEDED_APPOINTMENTS: i64 = 16;
const SEED_RATE_E4: i64 = 365_000;
const VOID_DELAY_MINUTES: i64 = 30;
const VOID_REASON: &str = "Monto digitado por error";

struct SeedPayment {
    appointment_id: i64,
    method_id: i64,
    currency: PaymentCurrency,
    amount_cents: i64,
    voided: bool,
}

const fn seed(
    appointment_id: i64,
    method_id: i64,
    currency: PaymentCurrency,
    amount_cents: i64,
    voided: bool,
) -> SeedPayment {
    SeedPayment {
        appointment_id,
        method_id,
        currency,
        amount_cents,
        voided,
    }
}

const SEED_PAYMENTS: [SeedPayment; 11] = [
    seed(1, 1, PaymentCurrency::Usd, 3_500, false),
    seed(2, 2, PaymentCurrency::Ves, 182_500, false),
    seed(4, 3, PaymentCurrency::Usd, 2_000, false),
    seed(4, 2, PaymentCurrency::Ves, 73_000, false),
    seed(8, 4, PaymentCurrency::Usd, 12_000, false),
    seed(9, 3, PaymentCurrency::Usd, 6_000, false),
    seed(9, 1, PaymentCurrency::Usd, 1_000, true),
    seed(10, 1, PaymentCurrency::Usd, 1_500, false),
    seed(13, 1, PaymentCurrency::Usd, 3_500, false),
    seed(14, 1, PaymentCurrency::Usd, 1_500, false),
    seed(15, 5, PaymentCurrency::Ves, 73_000, false),
];

fn has_no_payments(conn: &Connection) -> Result<bool, DbError> {
    let rows: i64 = conn.query_row("SELECT COUNT(*) FROM appointment_payments", [], |row| {
        row.get(0)
    })?;
    Ok(rows == 0)
}

fn has_seeded_appointments(conn: &Connection) -> Result<bool, DbError> {
    let present: bool = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM appointments WHERE id <= ?1) >= ?1",
        [SEEDED_APPOINTMENTS],
        |row| row.get(0),
    )?;
    Ok(present)
}

fn start_of(conn: &Connection, appointment_id: i64) -> Result<String, DbError> {
    Ok(conn.query_row(
        "SELECT starts_at FROM appointments WHERE id = ?1",
        [appointment_id],
        |row| row.get(0),
    )?)
}

fn minutes_after(conn: &Connection, moment: &str, minutes: i64) -> Result<String, DbError> {
    let shifted: Option<String> = conn.query_row(
        "SELECT strftime('%Y-%m-%dT%H:%M', ?1, ?2)",
        rusqlite::params![moment, format!("+{minutes} minutes")],
        |row| row.get(0),
    )?;
    shifted.ok_or(DbError::InvalidLocalMinute)
}

fn insert_seed_payment(
    conn: &Connection,
    owner_id: i64,
    spec: &SeedPayment,
) -> Result<(), SetupError> {
    let paid_at = start_of(conn, spec.appointment_id)?;
    let input = PaymentInput {
        appointment_id: spec.appointment_id,
        method_id: spec.method_id,
        currency: spec.currency,
        amount_cents: spec.amount_cents,
        rate_bs_per_usd_e4: (spec.currency == PaymentCurrency::Ves).then_some(SEED_RATE_E4),
    };
    let created = create_payment_at(conn, owner_id, &input, &paid_at)?;
    if spec.voided {
        let voided_at = minutes_after(conn, &paid_at, VOID_DELAY_MINUTES)?;
        let request = PaymentVoidRequest {
            id: created.id,
            reason: VOID_REASON.to_string(),
        };
        void_payment_at(conn, owner_id, &request, &voided_at)?;
    }
    Ok(())
}

pub fn seed_payments(conn: &Connection) -> Result<(), SetupError> {
    let Some(owner_id) = seeded_owner_id(conn)? else {
        return Ok(());
    };
    let transaction = conn.unchecked_transaction().map_err(DbError::from)?;
    if has_no_payments(&transaction)? && has_seeded_appointments(&transaction)? {
        for spec in &SEED_PAYMENTS {
            insert_seed_payment(&transaction, owner_id, spec)?;
        }
    }
    transaction.commit().map_err(DbError::from)?;
    Ok(())
}

pub fn seed_payments_if_empty(
    conn: &Connection,
    read_env: &dyn Fn(&str) -> Option<String>,
) -> Result<(), SetupError> {
    if configured_password(read_env).is_none() {
        return Ok(());
    }
    seed_payments(conn)
}

#[cfg(test)]
#[path = "dev_seed_payments_test.rs"]
mod tests;
