use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

pub const MAX_AUDIT_PAGE: u32 = 200;

#[derive(Serialize, specta::Type, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum AuditAction {
    LoginSucceeded,
    Logout,
    LoginFailed,
    LoginLockedOut,
    SessionLocked,
    SessionUnlocked,
    OwnerCreated,
    RecoveryUsed,
    ClockRollback,
    UserCreated,
    UserUpdated,
    PasswordReset,
    RoleCreated,
    UnlockFailed,
    RecoveryFailed,
    RolePermissionsChanged,
}

impl AuditAction {
    pub const ALL: [Self; 16] = [
        Self::LoginSucceeded,
        Self::Logout,
        Self::LoginFailed,
        Self::LoginLockedOut,
        Self::SessionLocked,
        Self::SessionUnlocked,
        Self::OwnerCreated,
        Self::RecoveryUsed,
        Self::ClockRollback,
        Self::UserCreated,
        Self::UserUpdated,
        Self::PasswordReset,
        Self::RoleCreated,
        Self::UnlockFailed,
        Self::RecoveryFailed,
        Self::RolePermissionsChanged,
    ];

    pub fn parse(candidate: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|action| action.as_str() == candidate)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::LoginSucceeded => "login_succeeded",
            Self::Logout => "logout",
            Self::LoginFailed => "login_failed",
            Self::LoginLockedOut => "login_locked_out",
            Self::SessionLocked => "session_locked",
            Self::SessionUnlocked => "session_unlocked",
            Self::OwnerCreated => "owner_created",
            Self::RecoveryUsed => "recovery_used",
            Self::ClockRollback => "clock_rollback",
            Self::UserCreated => "user_created",
            Self::UserUpdated => "user_updated",
            Self::PasswordReset => "password_reset",
            Self::RoleCreated => "role_created",
            Self::UnlockFailed => "unlock_failed",
            Self::RecoveryFailed => "recovery_failed",
            Self::RolePermissionsChanged => "role_permissions_changed",
        }
    }
}

#[derive(Serialize, specta::Type, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum AuditEntity {
    User,
    Role,
    System,
}

impl AuditEntity {
    pub const ALL: [Self; 3] = [Self::User, Self::Role, Self::System];

    pub fn parse(candidate: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|entity| entity.as_str() == candidate)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Role => "role",
            Self::System => "system",
        }
    }
}

pub const FORBIDDEN_DIFF_KEYS: [&str; 8] = [
    "password",
    "passwordhash",
    "recoverycode",
    "recoverycodehash",
    "key",
    "dbkey",
    "secret",
    "token",
];

#[derive(Clone, PartialEq, Debug)]
pub struct Diff(Value);

impl Diff {
    pub fn between(before: &Value, after: &Value) -> Option<Diff> {
        let (before, after) = (fields_of(before), fields_of(after));
        let keys: BTreeSet<&String> = before.keys().chain(after.keys()).collect();
        let changes = keys
            .into_iter()
            .filter(|key| !is_forbidden(key))
            .filter_map(|key| change_of(key, before.get(key), after.get(key)))
            .collect();
        Self::from_fields(changes)
    }

    pub fn created(after: &Value) -> Option<Diff> {
        match redact(after) {
            Value::Object(fields) => Self::from_fields(fields),
            _ => None,
        }
    }

    pub fn note(text: &str) -> Diff {
        Diff(json!({ "note": text }))
    }

    pub fn to_json(&self) -> String {
        self.0.to_string()
    }

    fn from_fields(fields: Map<String, Value>) -> Option<Diff> {
        (!fields.is_empty()).then_some(Diff(Value::Object(fields)))
    }
}

fn fields_of(value: &Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

fn change_of(key: &str, before: Option<&Value>, after: Option<&Value>) -> Option<(String, Value)> {
    let before = before.map_or(Value::Null, redact);
    let after = after.map_or(Value::Null, redact);
    (before != after).then(|| (key.to_string(), json!({ "before": before, "after": after })))
}

fn normalized(key: &str) -> String {
    key.chars()
        .filter(|c| *c != '_' && *c != '-')
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_forbidden(key: &str) -> bool {
    FORBIDDEN_DIFF_KEYS.contains(&normalized(key).as_str())
}

pub fn redact(value: &Value) -> Value {
    match value {
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .filter(|(key, _)| !is_forbidden(key))
                .map(|(key, nested)| (key.clone(), redact(nested)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(redact).collect()),
        scalar => scalar.clone(),
    }
}

#[derive(Clone, PartialEq, Debug)]
pub struct NewAuditEntry {
    pub actor_user_id: Option<i64>,
    pub action: AuditAction,
    pub entity: AuditEntity,
    pub entity_id: Option<i64>,
    pub diff: Option<Diff>,
}

#[derive(Serialize, specta::Type, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: i64,
    pub occurred_at: String,
    pub actor_user_id: Option<i64>,
    pub actor_username: Option<String>,
    pub action: AuditAction,
    pub entity: AuditEntity,
    pub entity_id: Option<i64>,
    pub diff: Option<String>,
}

#[derive(Deserialize, specta::Type, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuditQuery {
    pub before_id: Option<i64>,
    pub limit: u32,
}

#[derive(Serialize, specta::Type, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AuditPage {
    pub entries: Vec<AuditEntry>,
    pub next_before_id: Option<i64>,
}

impl AuditPage {
    pub fn from_fetched(fetched: Vec<AuditEntry>, limit: usize) -> Self {
        let has_more = fetched.len() > limit;
        let entries: Vec<AuditEntry> = fetched.into_iter().take(limit).collect();
        let next_before_id = entries.last().filter(|_| has_more).map(|entry| entry.id);
        Self {
            entries,
            next_before_id,
        }
    }
}

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClockRollback {
    pub last_recorded_at: String,
    pub detected_at: String,
}

#[cfg(test)]
#[path = "model_test.rs"]
mod tests;
