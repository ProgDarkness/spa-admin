use rusqlite::{params, Connection};
use unicode_normalization::UnicodeNormalization;

use crate::db::DbError;
use crate::features::audit::{self, AuditAction, AuditEntity, Diff, NewAuditEntry};
use crate::features::auth::username::{
    collapse_ascii_spaces, is_allowed_text_character, unicode_casefold,
};

const MAX_NAME_CHARS: usize = 80;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NamedTable {
    Services,
    Resources,
    PaymentMethods,
}

impl NamedTable {
    fn sql_name(self) -> &'static str {
        match self {
            Self::Services => "services",
            Self::Resources => "resources",
            Self::PaymentMethods => "payment_methods",
        }
    }
}

pub fn valid_name(raw: &str) -> Option<String> {
    let composed: String = raw.trim().nfc().collect();
    let name = collapse_ascii_spaces(&composed);
    let is_clean = name.chars().all(is_allowed_text_character);
    (is_clean && (1..=MAX_NAME_CHARS).contains(&name.chars().count())).then_some(name)
}

pub fn name_key(name: &str) -> String {
    unicode_casefold(&name.nfkc().collect::<String>())
}

pub fn name_taken(
    conn: &Connection,
    table: NamedTable,
    name: &str,
    except_id: Option<i64>,
) -> Result<bool, DbError> {
    let taken = conn.query_row(
        &format!(
            "SELECT EXISTS(SELECT 1 FROM {} WHERE name_key = ?1 AND id IS NOT ?2)",
            table.sql_name()
        ),
        params![name_key(name), except_id],
        |row| row.get(0),
    )?;
    Ok(taken)
}

pub fn record_change(
    conn: &Connection,
    actor_id: i64,
    action: AuditAction,
    entity: AuditEntity,
    entity_id: i64,
    diff: Option<Diff>,
) -> Result<(), DbError> {
    let entry = NewAuditEntry {
        actor_user_id: Some(actor_id),
        action,
        entity,
        entity_id: Some(entity_id),
        diff,
    };
    audit::record(conn, &entry)?;
    Ok(())
}

#[cfg(test)]
#[path = "mod_test.rs"]
mod tests;
