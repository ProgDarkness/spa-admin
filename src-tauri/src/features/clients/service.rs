use rusqlite::Connection;
use serde_json::{json, Value};

use super::model::{ClientDeletion, ClientError, ClientInput, ClientSummary, ClientUpdate};
use super::normalization::{normalize_national_id, valid_phone};
use super::repository;
use crate::features::audit::{AuditAction, AuditEntity, Diff};
use crate::features::named_records::{record_change, valid_name};

const FIRST_NAME_FIELD: &str = "firstName";
const LAST_NAME_FIELD: &str = "lastName";
const NATIONAL_ID_FIELD: &str = "nationalId";
const PHONE_FIELD: &str = "phone";
const DELETED_FIELD: &str = "deleted";

fn validated(field: &'static str, candidate: Option<String>) -> Result<String, ClientError> {
    candidate.ok_or(ClientError::Validation { field })
}

fn valid_client(raw: &ClientInput) -> Result<ClientInput, ClientError> {
    Ok(ClientInput {
        first_name: validated(FIRST_NAME_FIELD, valid_name(&raw.first_name))?,
        last_name: validated(LAST_NAME_FIELD, valid_name(&raw.last_name))?,
        national_id: validated(NATIONAL_ID_FIELD, normalize_national_id(&raw.national_id))?,
        phone: validated(PHONE_FIELD, valid_phone(&raw.phone))?,
    })
}

fn has_same_fields(client: &ClientSummary, candidate: &ClientInput) -> bool {
    client.first_name == candidate.first_name
        && client.last_name == candidate.last_name
        && client.national_id == candidate.national_id
        && client.phone == candidate.phone
}

pub fn get_client(conn: &Connection, client_id: i64) -> Result<ClientSummary, ClientError> {
    repository::find_client(conn, client_id)?.ok_or(ClientError::NotFound)
}

fn record(
    conn: &Connection,
    actor_id: i64,
    action: AuditAction,
    client_id: i64,
    diff: Option<Diff>,
) -> Result<(), ClientError> {
    Ok(record_change(
        conn,
        actor_id,
        action,
        AuditEntity::Client,
        client_id,
        diff,
    )?)
}

fn client_snapshot(client: &ClientSummary) -> Value {
    json!({
        FIRST_NAME_FIELD: client.first_name,
        LAST_NAME_FIELD: client.last_name,
        NATIONAL_ID_FIELD: client.national_id,
        PHONE_FIELD: client.phone,
        DELETED_FIELD: client.deleted_at.is_some(),
    })
}

fn ensure_national_id_available_for_new(
    conn: &Connection,
    national_id: &str,
) -> Result<(), ClientError> {
    match repository::find_client_by_national_id(conn, national_id)? {
        None => Ok(()),
        Some(holder) if holder.deleted_at.is_some() => Err(ClientError::DeletedHolder {
            client_id: holder.id,
        }),
        Some(_) => Err(ClientError::NationalIdTaken),
    }
}

fn ensure_national_id_free_of_others(
    conn: &Connection,
    national_id: &str,
    own_id: i64,
) -> Result<(), ClientError> {
    match repository::find_client_by_national_id(conn, national_id)? {
        Some(holder) if holder.id != own_id => Err(ClientError::NationalIdTaken),
        _ => Ok(()),
    }
}

pub fn create_client(
    conn: &Connection,
    actor_id: i64,
    input: &ClientInput,
) -> Result<ClientSummary, ClientError> {
    let valid = valid_client(input)?;
    ensure_national_id_available_for_new(conn, &valid.national_id)?;
    let id = repository::insert_client(conn, &valid, actor_id)?;
    let created = get_client(conn, id)?;
    let diff = Diff::created(&client_snapshot(&created));
    record(conn, actor_id, AuditAction::Create, id, diff)?;
    Ok(created)
}

pub fn update_client(
    conn: &Connection,
    actor_id: i64,
    update: &ClientUpdate,
) -> Result<ClientSummary, ClientError> {
    let before = get_client(conn, update.id)?;
    let valid = valid_client(&ClientInput {
        first_name: update.first_name.clone(),
        last_name: update.last_name.clone(),
        national_id: update.national_id.clone(),
        phone: update.phone.clone(),
    })?;
    ensure_national_id_free_of_others(conn, &valid.national_id, update.id)?;
    if has_same_fields(&before, &valid) {
        return Ok(before);
    }
    repository::apply_client_update(conn, update.id, &valid, actor_id)?;
    let after = get_client(conn, update.id)?;
    let diff = Diff::between(&client_snapshot(&before), &client_snapshot(&after));
    record(conn, actor_id, AuditAction::Update, after.id, diff)?;
    Ok(after)
}

pub fn set_client_deleted(
    conn: &Connection,
    actor_id: i64,
    deletion: &ClientDeletion,
) -> Result<ClientSummary, ClientError> {
    let before = get_client(conn, deletion.id)?;
    if before.deleted_at.is_some() == deletion.deleted {
        return Ok(before);
    }
    repository::set_client_deleted(conn, deletion.id, deletion.deleted, actor_id)?;
    let after = get_client(conn, deletion.id)?;
    let diff = Diff::between(&client_snapshot(&before), &client_snapshot(&after));
    let action = if deletion.deleted {
        AuditAction::SoftDelete
    } else {
        AuditAction::Reactivate
    };
    record(conn, actor_id, action, after.id, diff)?;
    Ok(after)
}

#[cfg(test)]
#[path = "service_test.rs"]
mod tests;

#[cfg(test)]
#[path = "service_audit_test.rs"]
mod audit_tests;
