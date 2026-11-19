use rusqlite::{Connection, OptionalExtension};

use super::model::{AuditAction, AuditEntity, ClockRollback, Diff, NewAuditEntry};
use crate::db::{require_valid_instant, DbError};

pub const CLOCK_ROLLBACK_TOLERANCE_SECS: i64 = 300;

const LOCAL_STAMP_FORMAT: &str = "%Y-%m-%dT%H:%M:%S";
const UTC_STAMP_FORMAT: &str = "%Y-%m-%dT%H:%M:%fZ";

pub struct ClockRollbackNotice(pub Option<ClockRollback>);

pub fn detect_clock_rollback(conn: &Connection) -> Result<Option<ClockRollback>, DbError> {
    Ok(detect_clock_rollback_at(conn, "now")?.map(DetectedRollback::into_notice))
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct DetectedRollback {
    last_recorded_at: String,
    detected_at: String,
    last_recorded_at_utc: String,
    detected_at_utc: String,
}

impl DetectedRollback {
    fn into_notice(self) -> ClockRollback {
        ClockRollback {
            last_recorded_at: self.last_recorded_at,
            detected_at: self.detected_at,
        }
    }
}

pub(crate) fn detect_clock_rollback_at(
    conn: &Connection,
    now: &str,
) -> Result<Option<DetectedRollback>, DbError> {
    require_valid_instant(conn, now)?;
    Ok(conn
        .query_row(
            "SELECT occurred_at, strftime(?1, ?3, 'localtime'), occurred_at_utc, \
                    strftime(?4, ?3)
             FROM audit_log
             WHERE id = (SELECT id FROM audit_log ORDER BY occurred_at_utc DESC, id DESC LIMIT 1)
               AND CAST(strftime('%s', occurred_at_utc) AS INTEGER)
                   - CAST(strftime('%s', ?3) AS INTEGER) > ?2",
            rusqlite::params![
                LOCAL_STAMP_FORMAT,
                CLOCK_ROLLBACK_TOLERANCE_SECS,
                now,
                UTC_STAMP_FORMAT
            ],
            |row| {
                Ok(DetectedRollback {
                    last_recorded_at: row.get(0)?,
                    detected_at: row.get(1)?,
                    last_recorded_at_utc: row.get(2)?,
                    detected_at_utc: row.get(3)?,
                })
            },
        )
        .optional()?)
}

pub fn record_clock_rollback(conn: &Connection) -> Result<Option<ClockRollback>, DbError> {
    record_clock_rollback_at(conn, "now")
}

pub(crate) fn record_clock_rollback_at(
    conn: &Connection,
    now: &str,
) -> Result<Option<ClockRollback>, DbError> {
    let Some(rollback) = detect_clock_rollback_at(conn, now)? else {
        return Ok(None);
    };
    let entry = NewAuditEntry {
        actor_user_id: None,
        action: AuditAction::ClockRollback,
        entity: AuditEntity::System,
        entity_id: None,
        diff: Diff::created(&serde_json::json!({
            "lastRecordedAt": rollback.last_recorded_at,
            "detectedAt": rollback.detected_at,
            "lastRecordedAtUtc": rollback.last_recorded_at_utc,
            "detectedAtUtc": rollback.detected_at_utc,
        })),
    };
    super::record(conn, &entry)?;
    Ok(Some(rollback.into_notice()))
}

#[cfg(test)]
#[path = "clock_test.rs"]
mod tests;

#[cfg(test)]
#[path = "clock_dst_test.rs"]
mod dst_tests;
