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
    assert_eq!(AuditAction::ALL.len(), 16);
    assert_eq!(AuditAction::parse("hack"), None);
    assert_eq!(AuditEntity::parse("mystery"), None);
}

#[test]
fn action_and_entity_strings_are_snake_case_and_unique() {
    let actions = [
        AuditAction::LoginSucceeded,
        AuditAction::Logout,
        AuditAction::LoginFailed,
        AuditAction::LoginLockedOut,
        AuditAction::SessionLocked,
        AuditAction::SessionUnlocked,
        AuditAction::OwnerCreated,
        AuditAction::RecoveryUsed,
        AuditAction::ClockRollback,
        AuditAction::UserCreated,
        AuditAction::UserUpdated,
        AuditAction::PasswordReset,
        AuditAction::RoleCreated,
        AuditAction::UnlockFailed,
        AuditAction::RecoveryFailed,
        AuditAction::RolePermissionsChanged,
    ];
    let names: std::collections::BTreeSet<&str> = actions.iter().map(|a| a.as_str()).collect();
    let expected: std::collections::BTreeSet<&str> = [
        "login_succeeded",
        "login_failed",
        "login_locked_out",
        "logout",
        "session_locked",
        "session_unlocked",
        "unlock_failed",
        "owner_created",
        "recovery_used",
        "recovery_failed",
        "user_created",
        "user_updated",
        "password_reset",
        "role_created",
        "role_permissions_changed",
        "clock_rollback",
    ]
    .into_iter()
    .collect();
    assert_eq!(names, expected);
    assert_eq!(
        [AuditEntity::User, AuditEntity::Role, AuditEntity::System].map(AuditEntity::as_str),
        ["user", "role", "system"]
    );
}
