use serde_json::json;

use super::tests::{
    audit_rows, break_audit, create, diff_of, everyone, fixture, input, maria, stored, try_create,
    try_set_deleted, try_update,
};
use super::*;
use crate::features::audit::{AuditAction, AuditEntity};

#[test]
fn create_audits_a_snapshot_of_the_new_client_attributed_to_the_actor() {
    let fixture = fixture();

    let created = create(&fixture, &maria());

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action, AuditAction::Create);
    assert_eq!(rows[0].entity, AuditEntity::Client);
    assert_eq!(rows[0].entity_id, Some(created.id));
    assert_eq!(rows[0].actor_user_id, Some(fixture.actor));
    assert_eq!(
        diff_of(&rows[0]),
        json!({
            "firstName": "María",
            "lastName": "González",
            "nationalId": "V-12345678",
            "phone": "0414-1234567",
            "deleted": false
        })
    );
}

#[test]
fn update_audits_only_the_changed_fields_with_before_and_after() {
    let fixture = fixture();
    let created = create(&fixture, &maria());

    try_update(
        &fixture,
        created.id,
        &input("María", "González", "V-12345678", "0414-7654321"),
    )
    .unwrap();

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1].action, AuditAction::Update);
    assert_eq!(rows[1].entity, AuditEntity::Client);
    assert_eq!(rows[1].entity_id, Some(created.id));
    assert_eq!(
        diff_of(&rows[1]),
        json!({ "phone": { "before": "0414-1234567", "after": "0414-7654321" } })
    );
}

#[test]
fn update_audits_the_canonical_national_id_not_the_typed_spelling() {
    let fixture = fixture();
    let created = create(&fixture, &maria());

    try_update(
        &fixture,
        created.id,
        &input("María", "González", "e 81.234.567", "0414-1234567"),
    )
    .unwrap();

    assert_eq!(
        diff_of(&audit_rows(&fixture)[1]),
        json!({ "nationalId": { "before": "V-12345678", "after": "E-81234567" } })
    );
}

#[test]
fn update_without_changes_audits_nothing_even_when_spelled_differently() {
    let fixture = fixture();
    let created = create(&fixture, &maria());

    let same = try_update(
        &fixture,
        created.id,
        &input("  María ", "González", "v 12.345.678", " 0414-1234567 "),
    )
    .unwrap();

    assert_eq!(same, created);
    assert_eq!(audit_rows(&fixture).len(), 1);
}

#[test]
fn deletion_and_reactivation_audit_their_own_actions_with_the_flag_flip() {
    let fixture = fixture();
    let created = create(&fixture, &maria());

    try_set_deleted(&fixture, created.id, true).unwrap();
    try_set_deleted(&fixture, created.id, false).unwrap();

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[1].action, AuditAction::SoftDelete);
    assert_eq!(rows[2].action, AuditAction::Reactivate);
    assert!(rows[1..]
        .iter()
        .all(|row| row.entity == AuditEntity::Client && row.entity_id == Some(created.id)));
    assert_eq!(
        diff_of(&rows[1]),
        json!({ "deleted": { "before": false, "after": true } })
    );
    assert_eq!(
        diff_of(&rows[2]),
        json!({ "deleted": { "before": true, "after": false } })
    );
}

#[test]
fn repeated_deletion_or_reactivation_audits_nothing() {
    let fixture = fixture();
    let created = create(&fixture, &maria());
    try_set_deleted(&fixture, created.id, false).unwrap();
    try_set_deleted(&fixture, created.id, true).unwrap();

    try_set_deleted(&fixture, created.id, true).unwrap();

    assert_eq!(audit_rows(&fixture).len(), 2);
}

#[test]
fn rejected_operations_audit_nothing() {
    let fixture = fixture();
    let created = create(&fixture, &maria());

    let _ = try_create(&fixture, &maria());
    let _ = try_create(&fixture, &input("", "", "", ""));
    let _ = try_update(&fixture, 99, &maria());
    let _ = try_set_deleted(&fixture, 99, true);

    assert_eq!(audit_rows(&fixture).len(), 1);
    assert_eq!(stored(&fixture, created.id), created);
}

#[test]
fn the_search_key_never_leaks_into_the_audit_diff() {
    let fixture = fixture();
    let created = create(&fixture, &maria());
    try_update(
        &fixture,
        created.id,
        &input("Sofía", "Ramírez", "V-12345678", "0414-1234567"),
    )
    .unwrap();

    let serialized: String = audit_rows(&fixture)
        .iter()
        .filter_map(|row| row.diff.clone())
        .collect();

    assert!(!serialized.contains("searchKey"));
    assert!(!serialized.contains("sofia ramirez"));
}

#[test]
fn a_failing_audit_rolls_back_the_created_client() {
    let fixture = fixture();
    break_audit(&fixture);

    let outcome = try_create(&fixture, &maria());

    assert!(matches!(outcome, Err(ClientError::Db(_))));
    assert!(everyone(&fixture).is_empty());
}

#[test]
fn a_failing_audit_rolls_back_the_update() {
    let fixture = fixture();
    let created = create(&fixture, &maria());
    break_audit(&fixture);

    let outcome = try_update(
        &fixture,
        created.id,
        &input("Sofía", "Ramírez", "V-12345678", "0414-1234567"),
    );

    assert!(matches!(outcome, Err(ClientError::Db(_))));
    assert_eq!(stored(&fixture, created.id), created);
}

#[test]
fn a_failing_audit_rolls_back_the_deletion_and_the_reactivation() {
    let fixture = fixture();
    let created = create(&fixture, &maria());
    break_audit(&fixture);

    let deletion = try_set_deleted(&fixture, created.id, true);

    assert!(matches!(deletion, Err(ClientError::Db(_))));
    assert_eq!(stored(&fixture, created.id).deleted_at, None);
}

#[test]
fn a_failing_audit_keeps_a_deleted_client_deleted_when_reactivating() {
    let fixture = fixture();
    let created = create(&fixture, &maria());
    let deleted = try_set_deleted(&fixture, created.id, true).unwrap();
    break_audit(&fixture);

    let reactivation = try_set_deleted(&fixture, created.id, false);

    assert!(matches!(reactivation, Err(ClientError::Db(_))));
    assert_eq!(stored(&fixture, created.id), deleted);
}
