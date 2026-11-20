use std::collections::BTreeSet;

use serde_json::json;

use super::*;

fn rendered(diff: Option<Diff>) -> serde_json::Value {
    serde_json::from_str(&diff.expect("diff expected").to_json()).unwrap()
}

#[test]
fn diff_strips_sensitive_keys() {
    let after =
        json!({"username": "ana", "password_hash": "h", "recoveryCode": "c", "db-key": "k"});
    let diff = rendered(Diff::created(&after));
    assert_eq!(diff, json!({"username": "ana"}));
}

#[test]
fn diff_strips_nested_sensitive_keys() {
    let after =
        json!({"profile": {"name": "ana", "Secret": "s", "deep": [{"token": "t", "ok": 1}]}});
    let diff = rendered(Diff::created(&after));
    assert_eq!(
        diff,
        json!({"profile": {"name": "ana", "deep": [{"ok": 1}]}})
    );
}

#[test]
fn between_never_leaks_sensitive_keys_even_when_changed() {
    let before = json!({"name": "a", "passwordHash": "x"});
    let after = json!({"name": "b", "passwordHash": "y"});
    let diff = rendered(Diff::between(&before, &after));
    assert_eq!(diff, json!({"name": {"before": "a", "after": "b"}}));
}

#[test]
fn between_strips_nested_sensitive_keys_inside_values() {
    let before = json!({"profile": {"name": "a", "token": "x"}});
    let after = json!({"profile": {"name": "b", "token": "y"}});
    let diff = rendered(Diff::between(&before, &after));
    assert_eq!(
        diff,
        json!({"profile": {"before": {"name": "a"}, "after": {"name": "b"}}})
    );
}

#[test]
fn update_diff_lists_only_changed_fields_before_after() {
    let before = json!({"username": "ana", "role_id": 1, "active": true});
    let after = json!({"username": "ana", "role_id": 2, "active": true});
    let diff = rendered(Diff::between(&before, &after));
    assert_eq!(diff, json!({"role_id": {"before": 1, "after": 2}}));
}

#[test]
fn between_reports_added_and_removed_keys_with_null() {
    let diff = rendered(Diff::between(&json!({"a": 1}), &json!({"b": 2})));
    assert_eq!(
        diff,
        json!({"a": {"before": 1, "after": null}, "b": {"before": null, "after": 2}})
    );
}

#[test]
fn between_equal_values_yields_none() {
    let value = json!({"a": 1});
    assert_eq!(Diff::between(&value, &value), None);
}

#[test]
fn diff_with_only_sensitive_keys_yields_none() {
    assert_eq!(Diff::created(&json!({"password": "p"})), None);
    assert_eq!(
        Diff::between(&json!({"password": "a"}), &json!({"password": "b"})),
        None
    );
}

#[test]
fn note_wraps_text_under_note_key() {
    assert_eq!(
        rendered(Some(Diff::note("resume"))),
        json!({"note": "resume"})
    );
}

#[test]
fn redact_leaves_scalars_untouched() {
    assert_eq!(redact(&json!("password")), json!("password"));
}

#[test]
fn audit_entry_serializes_camel_case() {
    let entry = AuditEntry {
        id: 3,
        occurred_at: "2026-05-01T09:00:00".to_string(),
        actor_user_id: Some(1),
        actor_username: Some("ana".to_string()),
        action: AuditAction::RolePermissionsChanged,
        entity: AuditEntity::Role,
        entity_id: Some(2),
        diff: Some(r#"{"note":"x"}"#.to_string()),
    };

    let value = serde_json::to_value(&entry).unwrap();

    assert_eq!(
        value,
        json!({
            "id": 3,
            "occurredAt": "2026-05-01T09:00:00",
            "actorUserId": 1,
            "actorUsername": "ana",
            "action": "role_permissions_changed",
            "entity": "role",
            "entityId": 2,
            "diff": "{\"note\":\"x\"}",
        })
    );
}

#[test]
fn serialized_names_match_stored_names_for_every_action_and_entity() {
    for action in AuditAction::ALL {
        assert_eq!(
            serde_json::to_value(action).unwrap(),
            json!(action.as_str())
        );
        assert_eq!(AuditAction::parse(action.as_str()), Some(action));
    }
    for entity in AuditEntity::ALL {
        assert_eq!(
            serde_json::to_value(entity).unwrap(),
            json!(entity.as_str())
        );
        assert_eq!(AuditEntity::parse(entity.as_str()), Some(entity));
    }
    assert_eq!(AuditAction::ALL.len(), 24);
    assert_eq!(AuditAction::parse("hack"), None);
    assert_eq!(AuditEntity::parse("mystery"), None);
}

fn is_snake_case(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('_')
        && !name.ends_with('_')
        && !name.contains("__")
        && name.chars().all(|c| c.is_ascii_lowercase() || c == '_')
}

#[test]
fn action_and_entity_strings_are_snake_case_and_unique() {
    let action_names: Vec<&str> = AuditAction::ALL
        .into_iter()
        .map(AuditAction::as_str)
        .collect();
    let entity_names: Vec<&str> = AuditEntity::ALL
        .into_iter()
        .map(AuditEntity::as_str)
        .collect();

    assert!(action_names.iter().all(|name| is_snake_case(name)));
    assert!(entity_names.iter().all(|name| is_snake_case(name)));
    assert_eq!(action_names.iter().collect::<BTreeSet<_>>().len(), 24);
    assert_eq!(entity_names.iter().collect::<BTreeSet<_>>().len(), 10);
}

fn quoted_values_after(sql: &str, column: &str) -> std::collections::BTreeSet<String> {
    let marker = format!("{column} IN (");
    let start = sql.find(&marker).expect("column check present") + marker.len();
    let list = &sql[start..start + sql[start..].find(')').unwrap()];
    list.split('\'')
        .skip(1)
        .step_by(2)
        .map(str::to_string)
        .collect()
}

fn stored_audit_table_sql() -> String {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::db::migrate(&mut conn).unwrap();
    conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'",
        [],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn every_audit_action_matches_the_check_constraint_exactly() {
    let sql = stored_audit_table_sql();
    let declared: std::collections::BTreeSet<String> = AuditAction::ALL
        .iter()
        .map(|action| action.as_str().to_string())
        .collect();
    assert_eq!(declared.len(), AuditAction::ALL.len());
    assert_eq!(quoted_values_after(&sql, "action"), declared);
}

#[test]
fn every_audit_entity_matches_the_check_constraint_exactly() {
    let sql = stored_audit_table_sql();
    let declared: std::collections::BTreeSet<String> = AuditEntity::ALL
        .iter()
        .map(|entity| entity.as_str().to_string())
        .collect();
    assert_eq!(declared.len(), AuditEntity::ALL.len());
    assert_eq!(quoted_values_after(&sql, "entity"), declared);
}

const SENSITIVE_NESTED_KEYS: [&str; 10] = [
    "newPassword",
    "currentPassword",
    "apiKey",
    "accessToken",
    "refreshToken",
    "passphrase",
    "pin",
    "salt",
    "cardNumber",
    "cvv",
];

#[test]
fn created_redacts_every_sensitive_key_variant_when_nested() {
    for key in SENSITIVE_NESTED_KEYS {
        let after =
            json!({"profile": {"name": "ana", key: "secreto", "list": [{key: "x", "ok": 1}]}});
        assert_eq!(
            rendered(Diff::created(&after)),
            json!({"profile": {"name": "ana", "list": [{"ok": 1}]}}),
            "key {key} leaked"
        );
    }
}

#[test]
fn between_redacts_every_sensitive_key_variant_even_when_changed() {
    for key in SENSITIVE_NESTED_KEYS {
        let before = json!({"name": "a", key: "x", "nested": {key: "x", "v": 1}});
        let after = json!({"name": "b", key: "y", "nested": {key: "y", "v": 2}});
        assert_eq!(
            rendered(Diff::between(&before, &after)),
            json!({
                "name": {"before": "a", "after": "b"},
                "nested": {"before": {"v": 1}, "after": {"v": 2}}
            }),
            "key {key} leaked"
        );
    }
}

#[test]
fn redaction_matches_sensitive_fragments_ignoring_case_and_separators() {
    let after = json!({"API_KEY": 1, "Access-Token": 2, "user_pin": 3, "Card_Number": 4, "ok": 5});
    assert_eq!(rendered(Diff::created(&after)), json!({"ok": 5}));
}

#[test]
fn redaction_keeps_the_keys_the_audit_trail_legitimately_records() {
    let after = json!({
        "username": "ana",
        "roleId": 2,
        "active": true,
        "name": "Recepción",
        "permissions": ["clients.read"],
        "lastRecordedAt": "a",
        "detectedAt": "b",
        "lastRecordedAtUtc": "c",
        "detectedAtUtc": "d",
        "note": "n"
    });
    assert_eq!(rendered(Diff::created(&after)), after);
}

#[test]
fn recovery_code_keys_stay_redacted() {
    let after = json!({"recoveryCode": "c", "recovery_code_hash": "h", "ok": 1});
    assert_eq!(rendered(Diff::created(&after)), json!({"ok": 1}));
}

fn rust_sources_outside_tests(directory: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut found = Vec::new();
    for entry in std::fs::read_dir(directory).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            found.extend(rust_sources_outside_tests(&path));
        } else if path.extension().is_some_and(|ext| ext == "rs")
            && !path.to_string_lossy().ends_with("_test.rs")
        {
            found.push(path);
        }
    }
    found
}

#[test]
fn every_production_note_call_passes_a_literal_or_a_fixed_label() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let marker = concat!("Diff::", "note(");
    let mut call_sites = 0;
    for path in rust_sources_outside_tests(&root) {
        let source = std::fs::read_to_string(&path).unwrap();
        for (offset, _) in source.match_indices(marker) {
            let argument = source[offset + marker.len()..].trim_start();
            call_sites += 1;
            assert!(
                argument.starts_with('"') || argument.starts_with("reason_label("),
                "{path:?} passes non-static text to the audit note"
            );
        }
    }
    assert!(call_sites >= 1);
}

const USER_ACTIONS: [AuditAction; 13] = [
    AuditAction::LoginSucceeded,
    AuditAction::LoginFailed,
    AuditAction::LoginLockedOut,
    AuditAction::Logout,
    AuditAction::SessionLocked,
    AuditAction::SessionUnlocked,
    AuditAction::UnlockFailed,
    AuditAction::OwnerCreated,
    AuditAction::RecoveryUsed,
    AuditAction::RecoveryFailed,
    AuditAction::UserCreated,
    AuditAction::UserUpdated,
    AuditAction::PasswordReset,
];

const ROLE_ACTIONS: [AuditAction; 2] = [
    AuditAction::RoleCreated,
    AuditAction::RolePermissionsChanged,
];

const SYSTEM_ACTIONS: [AuditAction; 3] = [
    AuditAction::ClockRollback,
    AuditAction::BackupCreated,
    AuditAction::BackupRestored,
];

const CATALOG_ENTITIES: [AuditEntity; 4] = [
    AuditEntity::Client,
    AuditEntity::Service,
    AuditEntity::Resource,
    AuditEntity::PaymentMethod,
];

const RECORD_ENTITIES: [AuditEntity; 7] = [
    AuditEntity::Client,
    AuditEntity::Service,
    AuditEntity::Resource,
    AuditEntity::Appointment,
    AuditEntity::Payment,
    AuditEntity::PaymentMethod,
    AuditEntity::ExchangeRate,
];

fn expected_entities(action: AuditAction) -> Vec<AuditEntity> {
    match action {
        _ if USER_ACTIONS.contains(&action) => vec![AuditEntity::User],
        _ if ROLE_ACTIONS.contains(&action) => vec![AuditEntity::Role],
        _ if SYSTEM_ACTIONS.contains(&action) => vec![AuditEntity::System],
        AuditAction::Create | AuditAction::Update => RECORD_ENTITIES.to_vec(),
        AuditAction::Deactivate | AuditAction::SoftDelete | AuditAction::Reactivate => {
            CATALOG_ENTITIES.to_vec()
        }
        AuditAction::Void => vec![AuditEntity::Payment],
        _ => unreachable!("unclassified action {action:?}"),
    }
}

fn as_set(entities: &[AuditEntity]) -> BTreeSet<&'static str> {
    entities.iter().map(|entity| entity.as_str()).collect()
}

#[test]
fn allowed_entities_table_covers_every_action_with_the_expected_pairs() {
    assert_eq!(
        USER_ACTIONS.len() + ROLE_ACTIONS.len() + SYSTEM_ACTIONS.len() + 6,
        AuditAction::ALL.len()
    );
    for action in AuditAction::ALL {
        assert_eq!(
            as_set(action.allowed_entities()),
            as_set(&expected_entities(action)),
            "action {}",
            action.as_str()
        );
    }
}

#[test]
fn allows_is_true_exactly_for_the_allowed_entities() {
    for action in AuditAction::ALL {
        for entity in AuditEntity::ALL {
            assert_eq!(
                action.allows(entity),
                expected_entities(action).contains(&entity),
                "{} on {}",
                action.as_str(),
                entity.as_str()
            );
        }
    }
}

#[test]
fn nonsensical_pairs_are_not_allowed() {
    assert!(!AuditAction::LoginSucceeded.allows(AuditEntity::Payment));
    assert!(!AuditAction::BackupCreated.allows(AuditEntity::Client));
    assert!(!AuditAction::Create.allows(AuditEntity::System));
}
