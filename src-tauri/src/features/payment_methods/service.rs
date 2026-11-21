use rusqlite::Connection;
use serde_json::{json, Value};

use super::model::{
    PaymentMethodActivation, PaymentMethodInput, PaymentMethodSummary, PaymentMethodUpdate,
    PaymentMethodsError,
};
use super::repository;
use crate::features::audit::{AuditAction, AuditEntity, Diff};
use crate::features::named_records::{record_change, valid_name as valid_record_name};

const ID_FIELD: &str = "id";
const NAME_FIELD: &str = "name";
const ACTIVE_FIELD: &str = "active";

fn valid_name(raw: &str) -> Result<String, PaymentMethodsError> {
    valid_record_name(raw).ok_or(PaymentMethodsError::Validation { field: NAME_FIELD })
}

fn require_payment_method(
    conn: &Connection,
    payment_method_id: i64,
) -> Result<PaymentMethodSummary, PaymentMethodsError> {
    repository::find_payment_method(conn, payment_method_id)?
        .ok_or(PaymentMethodsError::Validation { field: ID_FIELD })
}

fn ensure_name_free(
    conn: &Connection,
    name: &str,
    except_payment_method_id: Option<i64>,
) -> Result<(), PaymentMethodsError> {
    if repository::payment_method_name_taken(conn, name, except_payment_method_id)? {
        Err(PaymentMethodsError::Validation { field: NAME_FIELD })
    } else {
        Ok(())
    }
}

fn record(
    conn: &Connection,
    actor_id: i64,
    action: AuditAction,
    payment_method_id: i64,
    diff: Option<Diff>,
) -> Result<(), PaymentMethodsError> {
    Ok(record_change(
        conn,
        actor_id,
        action,
        AuditEntity::PaymentMethod,
        payment_method_id,
        diff,
    )?)
}

fn payment_method_snapshot(method: &PaymentMethodSummary) -> Value {
    json!({
        NAME_FIELD: method.name,
        ACTIVE_FIELD: method.active,
    })
}

pub fn create_payment_method(
    conn: &Connection,
    actor_id: i64,
    input: &PaymentMethodInput,
) -> Result<PaymentMethodSummary, PaymentMethodsError> {
    let valid = PaymentMethodInput {
        name: valid_name(&input.name)?,
    };
    ensure_name_free(conn, &valid.name, None)?;
    let id = repository::insert_payment_method(conn, &valid, actor_id)?;
    let created = require_payment_method(conn, id)?;
    let diff = Diff::created(&payment_method_snapshot(&created));
    record(conn, actor_id, AuditAction::Create, id, diff)?;
    Ok(created)
}

pub fn update_payment_method(
    conn: &Connection,
    actor_id: i64,
    update: &PaymentMethodUpdate,
) -> Result<PaymentMethodSummary, PaymentMethodsError> {
    let before = require_payment_method(conn, update.id)?;
    let valid = PaymentMethodInput {
        name: valid_name(&update.name)?,
    };
    ensure_name_free(conn, &valid.name, Some(update.id))?;
    if before.name == valid.name {
        return Ok(before);
    }
    repository::apply_payment_method_update(conn, update.id, &valid, actor_id)?;
    let after = require_payment_method(conn, update.id)?;
    let diff = Diff::between(
        &payment_method_snapshot(&before),
        &payment_method_snapshot(&after),
    );
    record(conn, actor_id, AuditAction::Update, after.id, diff)?;
    Ok(after)
}

pub fn set_payment_method_active(
    conn: &Connection,
    actor_id: i64,
    activation: &PaymentMethodActivation,
) -> Result<PaymentMethodSummary, PaymentMethodsError> {
    let before = require_payment_method(conn, activation.id)?;
    if before.active == activation.active {
        return Ok(before);
    }
    repository::set_payment_method_active(conn, activation.id, activation.active, actor_id)?;
    let after = require_payment_method(conn, activation.id)?;
    let diff = Diff::between(
        &payment_method_snapshot(&before),
        &payment_method_snapshot(&after),
    );
    let action = if after.active {
        AuditAction::Reactivate
    } else {
        AuditAction::Deactivate
    };
    record(conn, actor_id, action, after.id, diff)?;
    Ok(after)
}

#[cfg(test)]
#[path = "service_test.rs"]
mod tests;
