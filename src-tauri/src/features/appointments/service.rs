use rusqlite::Connection;
use serde_json::{json, Value};

use super::model::{AppointmentError, AppointmentInput, AppointmentRange, AppointmentSummary};
use super::repository::{self, NewAppointment};
use super::rules::{self, SlotError};
use crate::features::audit::{AuditAction, AuditEntity, Diff};
use crate::features::auth::username::is_allowed_text_character;
use crate::features::catalog::repository::find_service;
use crate::features::clients::repository::find_client;
use crate::features::named_records::record_change;
use crate::features::resources::model::ResourceSummary;
use crate::features::resources::repository::find_resource;

const CLIENT_ID_FIELD: &str = "clientId";
const SERVICE_ID_FIELD: &str = "serviceId";
const RESOURCE_ID_FIELD: &str = "resourceId";
const STARTS_AT_FIELD: &str = "startsAt";
const ENDS_AT_FIELD: &str = "endsAt";
const STATUS_FIELD: &str = "status";
const PRICE_SNAPSHOT_FIELD: &str = "priceCentsSnapshot";
const DURATION_SNAPSHOT_FIELD: &str = "durationMinSnapshot";
const DURATION_FIELD: &str = "durationMin";
const MAX_DURATION_MIN: u32 = 1_440;
const NOTES_FIELD: &str = "notes";
const HAS_NOTES_FIELD: &str = "hasNotes";
const NOTES_CHANGED_FIELD: &str = "notesChanged";
const FROM_FIELD: &str = "from";
const TO_FIELD: &str = "to";
const MAX_RANGE_DAYS: i64 = 366;
const MAX_NOTES_CHARS: usize = 500;

pub(crate) fn record(
    conn: &Connection,
    actor_id: i64,
    action: AuditAction,
    appointment_id: i64,
    diff: Option<Diff>,
) -> Result<(), AppointmentError> {
    Ok(record_change(
        conn,
        actor_id,
        action,
        AuditEntity::Appointment,
        appointment_id,
        diff,
    )?)
}

pub(crate) fn appointment_snapshot(appointment: &AppointmentSummary) -> Value {
    json!({
        CLIENT_ID_FIELD: appointment.client_id,
        SERVICE_ID_FIELD: appointment.service_id,
        RESOURCE_ID_FIELD: appointment.resource_id,
        STARTS_AT_FIELD: appointment.starts_at,
        ENDS_AT_FIELD: appointment.ends_at,
        STATUS_FIELD: appointment.status.as_str(),
        PRICE_SNAPSHOT_FIELD: appointment.price_cents_snapshot,
        DURATION_SNAPSHOT_FIELD: appointment.duration_min_snapshot,
        HAS_NOTES_FIELD: appointment.notes.is_some(),
    })
}

pub(crate) fn appointment_change_diff(
    before: &AppointmentSummary,
    after: &AppointmentSummary,
) -> Option<Diff> {
    let notes_edited =
        before.notes.is_some() && after.notes.is_some() && before.notes != after.notes;
    let (before_fields, after_fields) = (appointment_snapshot(before), appointment_snapshot(after));
    if !notes_edited {
        return Diff::between(&before_fields, &after_fields);
    }
    let marker = json!({ NOTES_CHANGED_FIELD: true });
    Diff::between_in_context(&marker, &before_fields, &after_fields)
        .or_else(|| Diff::created(&marker))
}

pub(crate) fn require_appointment(
    conn: &Connection,
    appointment_id: i64,
) -> Result<AppointmentSummary, AppointmentError> {
    repository::find_appointment(conn, appointment_id)?.ok_or(AppointmentError::NotFound)
}

pub(super) fn require_valid_start(starts_at: &str) -> Result<(), AppointmentError> {
    if rules::has_valid_start(starts_at) {
        Ok(())
    } else {
        Err(AppointmentError::Validation {
            field: STARTS_AT_FIELD,
        })
    }
}

fn require_positive(id: i64, field: &'static str) -> Result<(), AppointmentError> {
    if id > 0 {
        Ok(())
    } else {
        Err(AppointmentError::Validation { field })
    }
}

fn valid_notes(raw: Option<&str>) -> Result<Option<String>, AppointmentError> {
    let trimmed = raw.map_or("", str::trim);
    let is_clean = trimmed.chars().all(is_allowed_text_character);
    if !is_clean || trimmed.chars().count() > MAX_NOTES_CHARS {
        return Err(AppointmentError::Validation { field: NOTES_FIELD });
    }
    Ok((!trimmed.is_empty()).then(|| trimmed.to_string()))
}

pub(crate) fn slot_end(starts_at: &str, duration_min: i64) -> Result<String, AppointmentError> {
    let duration = u32::try_from(duration_min)
        .ok()
        .filter(|minutes| (1..=MAX_DURATION_MIN).contains(minutes))
        .ok_or(AppointmentError::Validation {
            field: DURATION_FIELD,
        })?;
    rules::ends_at(starts_at, duration).map_err(|failure| match failure {
        SlotError::InvalidStart => AppointmentError::Validation {
            field: STARTS_AT_FIELD,
        },
        SlotError::CrossesMidnight => AppointmentError::CrossesMidnight,
    })
}

pub(super) fn ensure_slot_free(
    conn: &Connection,
    resource_id: i64,
    starts_at: &str,
    ends_at: &str,
    except_id: Option<i64>,
) -> Result<(), AppointmentError> {
    let conflicting_ids =
        repository::find_overlaps(conn, resource_id, starts_at, ends_at, except_id)?;
    if conflicting_ids.is_empty() {
        Ok(())
    } else {
        Err(AppointmentError::Overlap { conflicting_ids })
    }
}

pub(super) fn existing_resource(
    conn: &Connection,
    resource_id: i64,
) -> Result<ResourceSummary, AppointmentError> {
    find_resource(conn, resource_id)?.ok_or(AppointmentError::ReferenceMissing {
        field: RESOURCE_ID_FIELD,
    })
}

pub(super) fn active_resource(
    conn: &Connection,
    resource_id: i64,
) -> Result<ResourceSummary, AppointmentError> {
    let resource = existing_resource(conn, resource_id)?;
    if resource.active {
        Ok(resource)
    } else {
        Err(AppointmentError::ResourceInactive)
    }
}

pub fn create_appointment(
    conn: &Connection,
    actor_id: i64,
    input: &AppointmentInput,
) -> Result<AppointmentSummary, AppointmentError> {
    require_positive(input.client_id, CLIENT_ID_FIELD)?;
    require_positive(input.service_id, SERVICE_ID_FIELD)?;
    require_positive(input.resource_id, RESOURCE_ID_FIELD)?;
    require_valid_start(&input.starts_at)?;
    let notes = valid_notes(input.notes.as_deref())?;
    find_client(conn, input.client_id)?
        .filter(|client| client.deleted_at.is_none())
        .ok_or(AppointmentError::ReferenceMissing {
            field: CLIENT_ID_FIELD,
        })?;
    let service =
        find_service(conn, input.service_id)?.ok_or(AppointmentError::ReferenceMissing {
            field: SERVICE_ID_FIELD,
        })?;
    existing_resource(conn, input.resource_id)?;
    if !service.active {
        return Err(AppointmentError::Validation {
            field: SERVICE_ID_FIELD,
        });
    }
    active_resource(conn, input.resource_id)?;
    let ends_at = slot_end(&input.starts_at, service.duration_min)?;
    ensure_slot_free(conn, input.resource_id, &input.starts_at, &ends_at, None)?;
    let id = repository::insert_appointment(
        conn,
        &NewAppointment {
            client_id: input.client_id,
            service_id: input.service_id,
            resource_id: input.resource_id,
            starts_at: input.starts_at.clone(),
            ends_at,
            price_cents_snapshot: service.price_cents,
            duration_min_snapshot: service.duration_min,
            notes,
        },
        actor_id,
    )?;
    let created = require_appointment(conn, id)?;
    let diff = Diff::created(&appointment_snapshot(&created));
    record(conn, actor_id, AuditAction::Create, id, diff)?;
    Ok(created)
}

fn validated_range(range: &AppointmentRange) -> Result<(), AppointmentError> {
    if !rules::is_local_date(&range.from) {
        return Err(AppointmentError::Validation { field: FROM_FIELD });
    }
    let span = rules::days_between(&range.from, &range.to);
    if !span.is_some_and(|days| (0..MAX_RANGE_DAYS).contains(&days)) {
        return Err(AppointmentError::Validation { field: TO_FIELD });
    }
    range
        .resource_id
        .map_or(Ok(()), |id| require_positive(id, RESOURCE_ID_FIELD))
}

pub fn list_appointments(
    conn: &Connection,
    range: &AppointmentRange,
) -> Result<Vec<AppointmentSummary>, AppointmentError> {
    validated_range(range)?;
    Ok(repository::list_appointments(conn, range)?)
}

#[cfg(test)]
#[path = "service_create_test.rs"]
mod create_tests;

#[cfg(test)]
#[path = "service_list_test.rs"]
mod list_tests;

#[cfg(test)]
#[path = "service_notes_audit_test.rs"]
mod notes_audit_tests;
