use rusqlite::Connection;
use serde_json::{json, Value};

use super::model::{
    ResourceActivation, ResourceInput, ResourceSummary, ResourceUpdate, ResourcesError,
};
use super::repository;
use crate::features::audit::{AuditAction, AuditEntity, Diff};
use crate::features::named_records::{record_change, valid_name as valid_record_name};

const ID_FIELD: &str = "id";
const NAME_FIELD: &str = "name";
const KIND_FIELD: &str = "kind";
const ACTIVE_FIELD: &str = "active";

fn valid_name(raw: &str) -> Result<String, ResourcesError> {
    valid_record_name(raw).ok_or(ResourcesError::Validation { field: NAME_FIELD })
}

fn require_resource(
    conn: &Connection,
    resource_id: i64,
) -> Result<ResourceSummary, ResourcesError> {
    repository::find_resource(conn, resource_id)?
        .ok_or(ResourcesError::Validation { field: ID_FIELD })
}

fn ensure_name_free(
    conn: &Connection,
    name: &str,
    except_resource_id: Option<i64>,
) -> Result<(), ResourcesError> {
    if repository::resource_name_taken(conn, name, except_resource_id)? {
        Err(ResourcesError::Validation { field: NAME_FIELD })
    } else {
        Ok(())
    }
}

fn record(
    conn: &Connection,
    actor_id: i64,
    action: AuditAction,
    resource_id: i64,
    diff: Option<Diff>,
) -> Result<(), ResourcesError> {
    Ok(record_change(
        conn,
        actor_id,
        action,
        AuditEntity::Resource,
        resource_id,
        diff,
    )?)
}

fn resource_snapshot(resource: &ResourceSummary) -> Value {
    json!({
        NAME_FIELD: resource.name,
        KIND_FIELD: resource.kind.as_str(),
        ACTIVE_FIELD: resource.active,
    })
}

pub fn create_resource(
    conn: &Connection,
    actor_id: i64,
    input: &ResourceInput,
) -> Result<ResourceSummary, ResourcesError> {
    let valid = ResourceInput {
        name: valid_name(&input.name)?,
        kind: input.kind,
    };
    ensure_name_free(conn, &valid.name, None)?;
    let id = repository::insert_resource(conn, &valid, actor_id)?;
    let created = require_resource(conn, id)?;
    let diff = Diff::created(&resource_snapshot(&created));
    record(conn, actor_id, AuditAction::Create, id, diff)?;
    Ok(created)
}

fn changes_nothing(before: &ResourceSummary, change: &ResourceInput) -> bool {
    before.name == change.name && before.kind == change.kind
}

pub fn update_resource(
    conn: &Connection,
    actor_id: i64,
    update: &ResourceUpdate,
) -> Result<ResourceSummary, ResourcesError> {
    let before = require_resource(conn, update.id)?;
    let valid = ResourceInput {
        name: valid_name(&update.name)?,
        kind: update.kind,
    };
    ensure_name_free(conn, &valid.name, Some(update.id))?;
    if changes_nothing(&before, &valid) {
        return Ok(before);
    }
    repository::apply_resource_update(conn, update.id, &valid, actor_id)?;
    let after = require_resource(conn, update.id)?;
    let diff = Diff::between(&resource_snapshot(&before), &resource_snapshot(&after));
    record(conn, actor_id, AuditAction::Update, after.id, diff)?;
    Ok(after)
}

pub fn set_resource_active(
    conn: &Connection,
    actor_id: i64,
    activation: &ResourceActivation,
) -> Result<ResourceSummary, ResourcesError> {
    let before = require_resource(conn, activation.id)?;
    if before.active == activation.active {
        return Ok(before);
    }
    repository::set_resource_active(conn, activation.id, activation.active, actor_id)?;
    let after = require_resource(conn, activation.id)?;
    let diff = Diff::between(&resource_snapshot(&before), &resource_snapshot(&after));
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
