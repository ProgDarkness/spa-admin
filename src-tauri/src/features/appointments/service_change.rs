use rusqlite::Connection;

use super::model::{
    AppointmentError, AppointmentMove, AppointmentStatus, AppointmentSummary,
    AppointmentTransitionRequest,
};
use super::repository;
use super::rules::{self, status_after};
use super::service::{
    active_resource, appointment_change_diff, ensure_slot_free, record, require_appointment,
    require_valid_start, slot_end,
};
use crate::db::require_valid_local_minute;
use crate::features::audit::AuditAction;

const RESOURCE_ID_FIELD: &str = "resourceId";

fn record_change_between(
    conn: &Connection,
    actor_id: i64,
    before: &AppointmentSummary,
    after: &AppointmentSummary,
) -> Result<(), AppointmentError> {
    let diff = appointment_change_diff(before, after);
    record(conn, actor_id, AuditAction::Update, after.id, diff)
}

pub fn move_appointment(
    conn: &Connection,
    actor_id: i64,
    movement: &AppointmentMove,
) -> Result<AppointmentSummary, AppointmentError> {
    if movement.resource_id <= 0 {
        return Err(AppointmentError::Validation {
            field: RESOURCE_ID_FIELD,
        });
    }
    require_valid_start(&movement.starts_at)?;
    let before = require_appointment(conn, movement.id)?;
    if before.status != AppointmentStatus::Scheduled {
        return Err(AppointmentError::InvalidTransition);
    }
    if before.resource_id == movement.resource_id && before.starts_at == movement.starts_at {
        return Ok(before);
    }
    active_resource(conn, movement.resource_id)?;
    let ends_at = slot_end(&movement.starts_at, before.duration_min_snapshot)?;
    ensure_slot_free(
        conn,
        movement.resource_id,
        &movement.starts_at,
        &ends_at,
        Some(before.id),
    )?;
    repository::update_slot(
        conn,
        before.id,
        movement.resource_id,
        &movement.starts_at,
        &ends_at,
        actor_id,
    )?;
    let after = require_appointment(conn, before.id)?;
    record_change_between(conn, actor_id, &before, &after)?;
    Ok(after)
}

fn ensure_can_hold_slot(
    conn: &Connection,
    appointment: &AppointmentSummary,
    now: &str,
) -> Result<(), AppointmentError> {
    if appointment.ends_at.as_str() > now {
        active_resource(conn, appointment.resource_id)?;
    }
    ensure_slot_free(
        conn,
        appointment.resource_id,
        &appointment.starts_at,
        &appointment.ends_at,
        Some(appointment.id),
    )
}

pub fn transition_appointment_at(
    conn: &Connection,
    actor_id: i64,
    request: &AppointmentTransitionRequest,
    now: &str,
) -> Result<AppointmentSummary, AppointmentError> {
    require_valid_local_minute(conn, now)?;
    let before = require_appointment(conn, request.id)?;
    if !rules::can_transition(before.status, request.transition, &before.starts_at, now) {
        return Err(AppointmentError::InvalidTransition);
    }
    let target = status_after(request.transition);
    if target == AppointmentStatus::Scheduled {
        ensure_can_hold_slot(conn, &before, now)?;
    }
    repository::set_status(conn, before.id, target, actor_id)?;
    let after = require_appointment(conn, before.id)?;
    record_change_between(conn, actor_id, &before, &after)?;
    Ok(after)
}

pub fn transition_appointment(
    conn: &Connection,
    actor_id: i64,
    request: &AppointmentTransitionRequest,
) -> Result<AppointmentSummary, AppointmentError> {
    let now = repository::local_minute_now(conn)?;
    transition_appointment_at(conn, actor_id, request, &now)
}

#[cfg(test)]
#[path = "service_change_test.rs"]
mod tests;
