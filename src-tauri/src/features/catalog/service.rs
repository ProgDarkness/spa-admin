use rusqlite::Connection;
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

use super::model::{
    CatalogError, ServiceActivation, ServiceInput, ServiceSummary, ServiceUpdate, MAX_AMOUNT_CENTS,
};
use super::repository;
use crate::features::audit::{self, AuditAction, AuditEntity, Diff, NewAuditEntry};
use crate::features::auth::username::is_allowed_text_character;

const ID_FIELD: &str = "id";
const NAME_FIELD: &str = "name";
const PRICE_FIELD: &str = "priceCents";
const DURATION_FIELD: &str = "durationMin";
const MAX_NAME_CHARS: usize = 80;
const MAX_DURATION_MIN: i64 = 1440;
const DURATION_STEP_MIN: i64 = 5;

fn valid_name(raw: &str) -> Result<String, CatalogError> {
    let name: String = raw.trim().nfc().collect();
    let is_clean = name.chars().all(is_allowed_text_character);
    if is_clean && (1..=MAX_NAME_CHARS).contains(&name.chars().count()) {
        Ok(name)
    } else {
        Err(CatalogError::Validation { field: NAME_FIELD })
    }
}

fn valid_price(price_cents: i64) -> Result<i64, CatalogError> {
    if (1..=MAX_AMOUNT_CENTS).contains(&price_cents) {
        Ok(price_cents)
    } else {
        Err(CatalogError::Validation { field: PRICE_FIELD })
    }
}

fn valid_duration(duration_min: i64) -> Result<i64, CatalogError> {
    let is_valid = duration_min > 0
        && duration_min <= MAX_DURATION_MIN
        && duration_min % DURATION_STEP_MIN == 0;
    if is_valid {
        Ok(duration_min)
    } else {
        Err(CatalogError::Validation {
            field: DURATION_FIELD,
        })
    }
}

fn validated(
    name: &str,
    price_cents: i64,
    duration_min: i64,
) -> Result<ServiceInput, CatalogError> {
    Ok(ServiceInput {
        name: valid_name(name)?,
        price_cents: valid_price(price_cents)?,
        duration_min: valid_duration(duration_min)?,
    })
}

fn require_service(conn: &Connection, service_id: i64) -> Result<ServiceSummary, CatalogError> {
    repository::find_service(conn, service_id)?.ok_or(CatalogError::Validation { field: ID_FIELD })
}

fn ensure_name_free(
    conn: &Connection,
    name: &str,
    except_service_id: Option<i64>,
) -> Result<(), CatalogError> {
    if repository::service_name_taken(conn, name, except_service_id)? {
        Err(CatalogError::Validation { field: NAME_FIELD })
    } else {
        Ok(())
    }
}

fn record(
    conn: &Connection,
    actor_id: i64,
    action: AuditAction,
    service_id: i64,
    diff: Option<Diff>,
) -> Result<(), CatalogError> {
    let entry = NewAuditEntry {
        actor_user_id: Some(actor_id),
        action,
        entity: AuditEntity::Service,
        entity_id: Some(service_id),
        diff,
    };
    audit::record(conn, &entry)?;
    Ok(())
}

fn service_snapshot(service: &ServiceSummary) -> Value {
    json!({
        NAME_FIELD: service.name,
        PRICE_FIELD: service.price_cents,
        DURATION_FIELD: service.duration_min,
        "active": service.active,
    })
}

pub fn create_service(
    conn: &Connection,
    actor_id: i64,
    input: &ServiceInput,
) -> Result<ServiceSummary, CatalogError> {
    let valid = validated(&input.name, input.price_cents, input.duration_min)?;
    ensure_name_free(conn, &valid.name, None)?;
    let id = repository::insert_service(conn, &valid, actor_id)?;
    let created = require_service(conn, id)?;
    let diff = Diff::created(&service_snapshot(&created));
    record(conn, actor_id, AuditAction::Create, id, diff)?;
    Ok(created)
}

fn changes_nothing(before: &ServiceSummary, change: &ServiceInput) -> bool {
    before.name == change.name
        && before.price_cents == change.price_cents
        && before.duration_min == change.duration_min
}

pub fn update_service(
    conn: &Connection,
    actor_id: i64,
    update: &ServiceUpdate,
) -> Result<ServiceSummary, CatalogError> {
    let before = require_service(conn, update.id)?;
    let valid = validated(&update.name, update.price_cents, update.duration_min)?;
    ensure_name_free(conn, &valid.name, Some(update.id))?;
    if changes_nothing(&before, &valid) {
        return Ok(before);
    }
    repository::apply_service_update(conn, update.id, &valid, actor_id)?;
    let after = require_service(conn, update.id)?;
    let diff = Diff::between(&service_snapshot(&before), &service_snapshot(&after));
    record(conn, actor_id, AuditAction::Update, after.id, diff)?;
    Ok(after)
}

pub fn set_service_active(
    conn: &Connection,
    actor_id: i64,
    activation: &ServiceActivation,
) -> Result<ServiceSummary, CatalogError> {
    let before = require_service(conn, activation.id)?;
    if before.active == activation.active {
        return Ok(before);
    }
    repository::set_service_active(conn, activation.id, activation.active, actor_id)?;
    let after = require_service(conn, activation.id)?;
    let diff = Diff::between(&service_snapshot(&before), &service_snapshot(&after));
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
