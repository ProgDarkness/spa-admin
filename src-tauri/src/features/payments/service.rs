use rusqlite::Connection;
use serde_json::{json, Value};

use super::model::{
    PaymentCurrency, PaymentError, PaymentInput, PaymentSummary, PaymentVoidRequest,
};
use super::repository::{self, NewPayment};
use super::rules::{self, EquivalentError, MAX_AMOUNT_CENTS, MAX_RATE_E4};
use crate::db::require_valid_local_minute;
use crate::features::appointments::repository::{find_appointment, local_minute_now};
use crate::features::audit::{AuditAction, AuditEntity, Diff};
use crate::features::named_records::record_change;
use crate::features::payment_methods::repository::find_payment_method;
use crate::features::rates::repository::find_rate;

const APPOINTMENT_ID_FIELD: &str = "appointmentId";
const METHOD_ID_FIELD: &str = "methodId";
const AMOUNT_FIELD: &str = "amountCents";
const RATE_FIELD: &str = "rateBsPerUsdE4";
const REASON_FIELD: &str = "reason";
const CURRENCY_FIELD: &str = "currency";
const USD_EQUIVALENT_FIELD: &str = "usdEquivalentCents";
const PAID_AT_FIELD: &str = "paidAt";
const VOIDED_AT_FIELD: &str = "voidedAt";
const VOIDED_BY_FIELD: &str = "voidedBy";
const VOID_REASON_FIELD: &str = "voidReason";
const DATE_LENGTH: usize = 10;

fn record(
    conn: &Connection,
    actor_id: i64,
    action: AuditAction,
    payment_id: i64,
    diff: Option<Diff>,
) -> Result<(), PaymentError> {
    Ok(record_change(
        conn,
        actor_id,
        action,
        AuditEntity::Payment,
        payment_id,
        diff,
    )?)
}

fn payment_snapshot(payment: &PaymentSummary) -> Value {
    json!({
        APPOINTMENT_ID_FIELD: payment.appointment_id,
        METHOD_ID_FIELD: payment.method_id,
        CURRENCY_FIELD: payment.currency.as_str(),
        AMOUNT_FIELD: payment.amount_cents,
        RATE_FIELD: payment.rate_bs_per_usd_e4,
        USD_EQUIVALENT_FIELD: payment.usd_equivalent_cents,
        PAID_AT_FIELD: payment.paid_at,
    })
}

fn void_state(payment: &PaymentSummary) -> Value {
    json!({
        VOIDED_AT_FIELD: payment.voided_at,
        VOIDED_BY_FIELD: payment.voided_by,
        VOID_REASON_FIELD: payment.void_reason,
    })
}

fn require_positive(id: i64, field: &'static str) -> Result<(), PaymentError> {
    if id > 0 {
        Ok(())
    } else {
        Err(PaymentError::Validation { field })
    }
}

fn validated_format(input: &PaymentInput) -> Result<(), PaymentError> {
    require_positive(input.appointment_id, APPOINTMENT_ID_FIELD)?;
    require_positive(input.method_id, METHOD_ID_FIELD)?;
    if !(1..=MAX_AMOUNT_CENTS).contains(&input.amount_cents) {
        return Err(PaymentError::Validation {
            field: AMOUNT_FIELD,
        });
    }
    let rate_is_valid = input
        .rate_bs_per_usd_e4
        .is_none_or(|rate| (1..=MAX_RATE_E4).contains(&rate));
    if !rate_is_valid {
        return Err(PaymentError::Validation { field: RATE_FIELD });
    }
    Ok(())
}

fn require_active_method(conn: &Connection, method_id: i64) -> Result<(), PaymentError> {
    let method = find_payment_method(conn, method_id)?.ok_or(PaymentError::ReferenceMissing {
        field: METHOD_ID_FIELD,
    })?;
    if method.active {
        Ok(())
    } else {
        Err(PaymentError::Validation {
            field: METHOD_ID_FIELD,
        })
    }
}

fn rate_for(
    conn: &Connection,
    input: &PaymentInput,
    now: &str,
) -> Result<Option<i64>, PaymentError> {
    if input.currency == PaymentCurrency::Usd {
        return Ok(None);
    }
    if input.rate_bs_per_usd_e4.is_some() {
        return Ok(input.rate_bs_per_usd_e4);
    }
    let day_rate = find_rate(conn, &now[..DATE_LENGTH])?
        .map(|stored| stored.rate.rate_bs_per_usd_e4)
        .ok_or(PaymentError::RateMissing)?;
    Ok(Some(day_rate))
}

fn equivalent_for(input: &PaymentInput, rate: Option<i64>) -> Result<i64, PaymentError> {
    let Some(rate) = rate else {
        return Ok(input.amount_cents);
    };
    let equivalent =
        rules::usd_equivalent_cents(input.amount_cents, rate).map_err(|failure| match failure {
            EquivalentError::Amount => PaymentError::Validation {
                field: AMOUNT_FIELD,
            },
            EquivalentError::Rate => PaymentError::Validation { field: RATE_FIELD },
        })?;
    if equivalent < 1 {
        return Err(PaymentError::Validation {
            field: AMOUNT_FIELD,
        });
    }
    Ok(equivalent)
}

fn require_payment(conn: &Connection, payment_id: i64) -> Result<PaymentSummary, PaymentError> {
    repository::find_payment(conn, payment_id)?.ok_or(PaymentError::NotFound)
}

pub fn create_payment_at(
    conn: &Connection,
    actor_id: i64,
    input: &PaymentInput,
    now: &str,
) -> Result<PaymentSummary, PaymentError> {
    require_valid_local_minute(conn, now)?;
    validated_format(input)?;
    find_appointment(conn, input.appointment_id)?.ok_or(PaymentError::ReferenceMissing {
        field: APPOINTMENT_ID_FIELD,
    })?;
    require_active_method(conn, input.method_id)?;
    let rate = rate_for(conn, input, now)?;
    let usd_equivalent_cents = equivalent_for(input, rate)?;
    let id = repository::insert_payment(
        conn,
        &NewPayment {
            appointment_id: input.appointment_id,
            method_id: input.method_id,
            currency: input.currency,
            amount_cents: input.amount_cents,
            rate_bs_per_usd_e4: rate,
            usd_equivalent_cents,
            paid_at: now.to_string(),
        },
        actor_id,
    )?;
    let created = require_payment(conn, id)?;
    let diff = Diff::created(&payment_snapshot(&created));
    record(conn, actor_id, AuditAction::Create, id, diff)?;
    Ok(created)
}

pub fn create_payment(
    conn: &Connection,
    actor_id: i64,
    input: &PaymentInput,
) -> Result<PaymentSummary, PaymentError> {
    let now = local_minute_now(conn)?;
    create_payment_at(conn, actor_id, input, &now)
}

pub fn void_payment_at(
    conn: &Connection,
    actor_id: i64,
    request: &PaymentVoidRequest,
    now: &str,
) -> Result<PaymentSummary, PaymentError> {
    require_valid_local_minute(conn, now)?;
    let reason = rules::valid_void_reason(&request.reason).ok_or(PaymentError::Validation {
        field: REASON_FIELD,
    })?;
    let before = require_payment(conn, request.id)?;
    if before.voided_at.is_some() {
        return Err(PaymentError::AlreadyVoided {
            payment_id: before.id,
        });
    }
    let voided = repository::mark_voided(conn, before.id, now, actor_id, &reason)?;
    if !voided {
        return Err(PaymentError::AlreadyVoided {
            payment_id: before.id,
        });
    }
    let after = require_payment(conn, before.id)?;
    let diff = Diff::between(&void_state(&before), &void_state(&after));
    record(conn, actor_id, AuditAction::Void, after.id, diff)?;
    Ok(after)
}

pub fn void_payment(
    conn: &Connection,
    actor_id: i64,
    request: &PaymentVoidRequest,
) -> Result<PaymentSummary, PaymentError> {
    let now = local_minute_now(conn)?;
    void_payment_at(conn, actor_id, request, &now)
}

#[cfg(test)]
#[path = "service_test.rs"]
mod tests;

#[cfg(test)]
#[path = "service_create_test.rs"]
mod create_tests;

#[cfg(test)]
#[path = "service_void_test.rs"]
mod void_tests;
