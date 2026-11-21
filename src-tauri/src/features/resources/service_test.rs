use rusqlite::Connection;
use serde_json::{json, Value};

use super::*;
use crate::db::{migrate, Database};
use crate::features::audit::repository::list_all;
use crate::features::audit::AuditEntry;
use crate::features::resources::model::{ResourceFilter, ResourceKind};
use crate::features::resources::repository;
use crate::features::users::repository::{insert_user, NewUserRow};

const OWNER_ROLE: i64 = 1;
const SEEDED_RESOURCES: usize = 3;
const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";

struct Fixture {
    database: Database,
    actor: i64,
}

fn fixture() -> Fixture {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    let row = NewUserRow {
        username: "duena".to_string(),
        password_hash: "hash-opaco".to_string(),
        role_id: OWNER_ROLE,
    };
    let actor = insert_user(&conn, &row, None).unwrap();
    Fixture {
        database: Database::new(conn),
        actor,
    }
}

fn run<T>(
    fixture: &Fixture,
    operation: impl FnOnce(&Connection) -> Result<T, ResourcesError>,
) -> Result<T, ResourcesError> {
    fixture.database.with_tx(|tx| operation(tx))
}

fn audit_rows(fixture: &Fixture) -> Vec<AuditEntry> {
    fixture.database.with_conn(list_all).unwrap()
}

fn diff_of(entry: &AuditEntry) -> Value {
    serde_json::from_str(entry.diff.as_ref().unwrap()).unwrap()
}

fn stored(fixture: &Fixture, id: i64) -> ResourceSummary {
    fixture
        .database
        .with_conn(|conn| repository::find_resource(conn, id))
        .unwrap()
        .unwrap()
}

fn resource_count(fixture: &Fixture) -> usize {
    fixture
        .database
        .with_conn(|conn| {
            repository::list_resources(
                conn,
                ResourceFilter {
                    include_inactive: true,
                },
            )
        })
        .unwrap()
        .len()
}

fn break_audit(fixture: &Fixture) {
    fixture
        .database
        .with_conn(|conn| {
            conn.execute_batch(FAIL_AUDIT_INSERTS)?;
            Ok(())
        })
        .unwrap();
}

fn input(name: &str) -> ResourceInput {
    ResourceInput {
        name: name.to_string(),
        kind: ResourceKind::Cabin,
    }
}

fn create(fixture: &Fixture, name: &str) -> ResourceSummary {
    run(fixture, |conn| {
        create_resource(conn, fixture.actor, &input(name))
    })
    .unwrap()
}

fn try_create(fixture: &Fixture, name: &str) -> ResourcesError {
    run(fixture, |conn| {
        create_resource(conn, fixture.actor, &input(name))
    })
    .unwrap_err()
}

fn update_of(resource: &ResourceSummary) -> ResourceUpdate {
    ResourceUpdate {
        id: resource.id,
        name: resource.name.clone(),
        kind: resource.kind,
    }
}

fn update(fixture: &Fixture, change: &ResourceUpdate) -> Result<ResourceSummary, ResourcesError> {
    run(fixture, |conn| update_resource(conn, fixture.actor, change))
}

fn rename(
    fixture: &Fixture,
    resource: &ResourceSummary,
    name: &str,
) -> Result<ResourceSummary, ResourcesError> {
    update(
        fixture,
        &ResourceUpdate {
            name: name.to_string(),
            ..update_of(resource)
        },
    )
}

fn activate(fixture: &Fixture, id: i64, active: bool) -> Result<ResourceSummary, ResourcesError> {
    run(fixture, |conn| {
        set_resource_active(conn, fixture.actor, &ResourceActivation { id, active })
    })
}

fn is_field(error: ResourcesError, expected: &str) -> bool {
    matches!(error, ResourcesError::Validation { field } if field == expected)
}

#[test]
fn create_resource_persists_and_audits_a_create_on_the_resource_entity() {
    let fixture = fixture();

    let created = create(&fixture, "Sala");

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action.as_str(), "create");
    assert_eq!(rows[0].entity.as_str(), "resource");
    assert_eq!(rows[0].entity_id, Some(created.id));
    assert_eq!(rows[0].actor_user_id, Some(fixture.actor));
    assert_eq!(
        diff_of(&rows[0]),
        json!({ "name": "Sala", "kind": "cabin", "active": true })
    );
    assert_eq!(created.name, "Sala");
    assert_eq!(created.kind, ResourceKind::Cabin);
    assert!(created.active);
    assert_eq!(created, stored(&fixture, created.id));
}

#[test]
fn create_resource_keeps_the_requested_kind() {
    let fixture = fixture();

    let created = run(&fixture, |conn| {
        create_resource(
            conn,
            fixture.actor,
            &ResourceInput {
                name: "Puesto B".to_string(),
                kind: ResourceKind::Manicure,
            },
        )
    })
    .unwrap();

    assert_eq!(created.kind, ResourceKind::Manicure);
    assert_eq!(diff_of(&audit_rows(&fixture)[0])["kind"], "manicure");
}

#[test]
fn the_audit_actions_of_resources_are_allowed_for_the_resource_entity() {
    for action in [
        AuditAction::Create,
        AuditAction::Update,
        AuditAction::Deactivate,
        AuditAction::Reactivate,
    ] {
        assert!(
            action.allowed_entities().contains(&AuditEntity::Resource),
            "{}",
            action.as_str()
        );
    }
}

#[test]
fn create_resource_trims_and_normalizes_the_name_to_nfc() {
    let fixture = fixture();

    let created = create(&fixture, "  Cafe\u{301} sala  ");

    assert_eq!(created.name, "Caf\u{e9} sala");
    assert_eq!(diff_of(&audit_rows(&fixture)[0])["name"], "Caf\u{e9} sala");
}

#[test]
fn blank_name_is_rejected_on_the_name_field() {
    let fixture = fixture();

    for name in ["", "   ", "\t\n"] {
        assert!(is_field(try_create(&fixture, name), "name"), "{name:?}");
    }

    assert_eq!(resource_count(&fixture), SEEDED_RESOURCES);
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn names_with_control_format_or_bidi_characters_are_rejected_on_create_and_rename() {
    let fixture = fixture();
    let existing = create(&fixture, "Facial");
    let hostile = [
        "Sala\u{200B}",
        "Sa\nla",
        "Sa\tla",
        "Sala\u{202E}",
        "\u{FEFF}Sala",
        "Sa\u{2066}la",
        "Sa\u{0000}la",
        "Sa\u{00A0}la",
    ];

    for name in hostile {
        let on_rename = rename(&fixture, &existing, name).unwrap_err();
        assert!(is_field(try_create(&fixture, name), "name"), "{name:?}");
        assert!(is_field(on_rename, "name"), "{name:?}");
    }

    assert_eq!(resource_count(&fixture), SEEDED_RESOURCES + 1);
    assert_eq!(audit_rows(&fixture).len(), 1);
}

#[test]
fn names_with_inner_spaces_accents_and_parentheses_remain_valid() {
    let fixture = fixture();

    let created = create(&fixture, "Cabina pi\u{e9} (norte)");

    assert_eq!(created.name, "Cabina pi\u{e9} (norte)");
}

#[test]
fn name_length_is_limited_to_eighty_characters_after_normalization() {
    let fixture = fixture();
    let eighty_composed_from_160_scalars = "e\u{301}".repeat(80);

    let too_long = try_create(&fixture, &"a".repeat(81));
    let at_limit = create(&fixture, &"a".repeat(80));
    let composed = create(&fixture, &eighty_composed_from_160_scalars);

    assert!(is_field(too_long, "name"));
    assert_eq!(at_limit.name.chars().count(), 80);
    assert_eq!(composed.name.chars().count(), 80);
}

#[test]
fn duplicate_name_ignoring_case_is_rejected_on_create_and_rename() {
    let fixture = fixture();
    create(&fixture, "Sala");
    let patio = create(&fixture, "Patio");
    let audits_before = audit_rows(&fixture).len();

    let on_create = try_create(&fixture, "sALA");
    let on_rename = rename(&fixture, &patio, "SALA").unwrap_err();

    assert!(is_field(on_create, "name"));
    assert!(is_field(on_rename, "name"));
    assert_eq!(resource_count(&fixture), SEEDED_RESOURCES + 2);
    assert_eq!(audit_rows(&fixture).len(), audits_before);
}

#[test]
fn a_seeded_name_cannot_be_taken_again() {
    let fixture = fixture();

    let on_create = try_create(&fixture, "CABINA 1");
    let on_rename = rename(&fixture, &stored(&fixture, 2), "cabina 1").unwrap_err();

    assert!(is_field(on_create, "name"));
    assert!(is_field(on_rename, "name"));
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn duplicate_name_is_detected_after_trim_and_normalization() {
    let fixture = fixture();
    create(&fixture, "Caf\u{e9}");

    let error = try_create(&fixture, "  CAFE\u{301} ");

    assert!(is_field(error, "name"));
}

#[test]
fn a_resource_may_change_only_the_letter_case_of_its_own_name() {
    let fixture = fixture();
    let created = create(&fixture, "sala");

    let renamed = rename(&fixture, &created, "Sala").unwrap();

    assert_eq!(renamed.name, "Sala");
    assert_eq!(
        diff_of(&audit_rows(&fixture)[1]),
        json!({ "name": { "before": "sala", "after": "Sala" } })
    );
}

#[test]
fn full_width_lookalike_names_collide_on_create_and_rename() {
    let fixture = fixture();
    create(&fixture, "Sala");
    let patio = create(&fixture, "Patio");

    let on_create = try_create(&fixture, "\u{FF33}ala");
    let on_rename = rename(&fixture, &patio, "\u{FF33}ALA").unwrap_err();

    assert!(is_field(on_create, "name"));
    assert!(is_field(on_rename, "name"));
    assert_eq!(resource_count(&fixture), SEEDED_RESOURCES + 2);
}

fn seed_decomposed(fixture: &Fixture, name: &str, name_key: &str) {
    fixture
        .database
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO resources (name, name_key, kind) VALUES (?1, ?2, 'cabin')",
                [name, name_key],
            )?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_stored_decomposed_name_collides_with_its_composed_form() {
    let fixture = fixture();
    seed_decomposed(&fixture, "Cafe\u{301}", "caf\u{e9}");

    let error = try_create(&fixture, "CAF\u{c9}");

    assert!(is_field(error, "name"));
    assert_eq!(resource_count(&fixture), SEEDED_RESOURCES + 1);
}

#[test]
fn update_resource_audits_only_the_changed_fields_with_before_and_after() {
    let fixture = fixture();
    let created = create(&fixture, "Sala");

    let updated = update(
        &fixture,
        &ResourceUpdate {
            name: "Puesto".into(),
            kind: ResourceKind::Manicure,
            ..update_of(&created)
        },
    )
    .unwrap();

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1].action.as_str(), "update");
    assert_eq!(rows[1].entity.as_str(), "resource");
    assert_eq!(rows[1].entity_id, Some(created.id));
    assert_eq!(rows[1].actor_user_id, Some(fixture.actor));
    assert_eq!(
        diff_of(&rows[1]),
        json!({
            "name": { "before": "Sala", "after": "Puesto" },
            "kind": { "before": "cabin", "after": "manicure" }
        })
    );
    assert_eq!(updated, stored(&fixture, created.id));
}

#[test]
fn update_resource_with_only_a_new_name_reports_only_the_name() {
    let fixture = fixture();
    let created = create(&fixture, "Sala");

    rename(&fixture, &created, "  Sala norte ").unwrap();

    assert_eq!(
        diff_of(&audit_rows(&fixture)[1]),
        json!({ "name": { "before": "Sala", "after": "Sala norte" } })
    );
}

#[test]
fn update_resource_with_only_a_new_kind_reports_only_the_kind() {
    let fixture = fixture();
    let created = create(&fixture, "Sala");

    let updated = update(
        &fixture,
        &ResourceUpdate {
            kind: ResourceKind::Manicure,
            ..update_of(&created)
        },
    )
    .unwrap();

    assert_eq!(updated.kind, ResourceKind::Manicure);
    assert_eq!(
        diff_of(&audit_rows(&fixture)[1]),
        json!({ "kind": { "before": "cabin", "after": "manicure" } })
    );
}

#[test]
fn update_resource_without_changes_does_not_audit_or_touch_the_row() {
    let fixture = fixture();
    let created = create(&fixture, "Sala");
    let other_actor = fixture
        .database
        .with_conn(|conn| {
            insert_user(
                conn,
                &NewUserRow {
                    username: "otra".to_string(),
                    password_hash: "hash-opaco".to_string(),
                    role_id: OWNER_ROLE,
                },
                None,
            )
        })
        .unwrap();

    let unchanged = run(&fixture, |conn| {
        update_resource(
            conn,
            other_actor,
            &ResourceUpdate {
                name: "  Sala  ".into(),
                ..update_of(&created)
            },
        )
    })
    .unwrap();

    let updated_by: i64 = fixture
        .database
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT updated_by FROM resources WHERE id = ?1",
                [created.id],
                |row| row.get(0),
            )?)
        })
        .unwrap();
    assert_eq!(unchanged, created);
    assert_eq!(updated_by, fixture.actor);
    assert_eq!(audit_rows(&fixture).len(), 1);
}

#[test]
fn update_resource_validates_the_name_and_leaves_the_row_untouched() {
    let fixture = fixture();
    let created = create(&fixture, "Sala");

    for name in ["", "  ", "Sa\u{200B}la", &"a".repeat(81), "CABINA 1"] {
        let error = rename(&fixture, &created, name).unwrap_err();
        assert!(is_field(error, "name"), "{name:?}");
    }

    assert_eq!(stored(&fixture, created.id), created);
    assert_eq!(audit_rows(&fixture).len(), 1);
}

#[test]
fn unknown_resource_id_is_a_validation_error_on_the_id_field() {
    let fixture = fixture();
    let ghost = ResourceUpdate {
        id: 999,
        name: "Fantasma".into(),
        kind: ResourceKind::Cabin,
    };

    let on_update = update(&fixture, &ghost).unwrap_err();
    let on_invalid_update = update(
        &fixture,
        &ResourceUpdate {
            name: " ".into(),
            ..ghost.clone()
        },
    )
    .unwrap_err();
    let on_deactivate = activate(&fixture, 999, false).unwrap_err();

    assert!(is_field(on_update, "id"));
    assert!(is_field(on_invalid_update, "id"));
    assert!(is_field(on_deactivate, "id"));
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn deactivating_audits_a_deactivate_and_reactivating_audits_a_reactivate() {
    let fixture = fixture();
    let created = create(&fixture, "Sala");

    let retired = activate(&fixture, created.id, false).unwrap();
    let restored = activate(&fixture, created.id, true).unwrap();

    let rows = audit_rows(&fixture);
    let actions: Vec<&str> = rows.iter().map(|row| row.action.as_str()).collect();
    assert_eq!(actions, ["create", "deactivate", "reactivate"]);
    assert!(rows[1..]
        .iter()
        .all(|row| row.entity.as_str() == "resource"));
    assert!(rows[1..]
        .iter()
        .all(|row| row.entity_id == Some(created.id)));
    assert!(rows[1..]
        .iter()
        .all(|row| row.actor_user_id == Some(fixture.actor)));
    assert_eq!(
        diff_of(&rows[1]),
        json!({ "active": { "before": true, "after": false } })
    );
    assert_eq!(
        diff_of(&rows[2]),
        json!({ "active": { "before": false, "after": true } })
    );
    assert!(!retired.active);
    assert!(restored.active);
}

#[test]
fn the_seeded_inactive_manicure_post_can_be_reactivated_and_audited() {
    let fixture = fixture();

    let reactivated = activate(&fixture, 3, true).unwrap();

    let rows = audit_rows(&fixture);
    assert!(reactivated.active);
    assert_eq!(reactivated.kind, ResourceKind::Manicure);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action.as_str(), "reactivate");
    assert_eq!(rows[0].entity_id, Some(3));
}

#[test]
fn setting_the_state_a_resource_already_has_does_not_audit() {
    let fixture = fixture();
    let created = create(&fixture, "Sala");

    let still_active = activate(&fixture, created.id, true).unwrap();
    activate(&fixture, created.id, false).unwrap();
    let still_inactive = activate(&fixture, created.id, false).unwrap();

    assert!(still_active.active);
    assert!(!still_inactive.active);
    assert_eq!(audit_rows(&fixture).len(), 2);
}

#[test]
fn an_inactive_resource_can_still_be_edited() {
    let fixture = fixture();
    let created = create(&fixture, "Sala");
    activate(&fixture, created.id, false).unwrap();

    let edited = rename(&fixture, &created, "Sala vieja").unwrap();

    assert_eq!(edited.name, "Sala vieja");
    assert!(!edited.active);
}

#[test]
fn a_failing_audit_rolls_back_the_created_resource() {
    let fixture = fixture();
    break_audit(&fixture);

    let outcome = run(&fixture, |conn| {
        create_resource(conn, fixture.actor, &input("Sala"))
    });

    assert!(matches!(outcome, Err(ResourcesError::Db(_))));
    assert_eq!(resource_count(&fixture), SEEDED_RESOURCES);
}

#[test]
fn a_failing_audit_rolls_back_the_update() {
    let fixture = fixture();
    let created = create(&fixture, "Sala");
    break_audit(&fixture);

    let outcome = rename(&fixture, &created, "Otra");

    assert!(matches!(outcome, Err(ResourcesError::Db(_))));
    assert_eq!(stored(&fixture, created.id), created);
}

#[test]
fn a_failing_audit_rolls_back_the_deactivation() {
    let fixture = fixture();
    let created = create(&fixture, "Sala");
    break_audit(&fixture);

    let outcome = activate(&fixture, created.id, false);

    assert!(matches!(outcome, Err(ResourcesError::Db(_))));
    assert!(stored(&fixture, created.id).active);
}

fn stored_name_key(fixture: &Fixture, id: i64) -> String {
    fixture
        .database
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT name_key FROM resources WHERE id = ?1",
                [id],
                |row| row.get(0),
            )?)
        })
        .unwrap()
}

#[test]
fn inner_space_runs_collide_with_the_single_spaced_name_on_create_and_rename() {
    let fixture = fixture();
    let patio = create(&fixture, "Patio");
    let audits_before = audit_rows(&fixture).len();

    let seeded_on_create = try_create(&fixture, "Cabina  1");
    let seeded_on_rename = rename(&fixture, &patio, "Cabina   1").unwrap_err();
    create(&fixture, "Sala Norte");
    let created_on_create = try_create(&fixture, "Sala  Norte");

    assert!(is_field(seeded_on_create, "name"));
    assert!(is_field(seeded_on_rename, "name"));
    assert!(is_field(created_on_create, "name"));
    assert_eq!(resource_count(&fixture), SEEDED_RESOURCES + 2);
    assert_eq!(audit_rows(&fixture).len(), audits_before + 1);
}

#[test]
fn inner_space_runs_are_stored_collapsed_with_a_matching_name_key() {
    let fixture = fixture();

    let created = create(&fixture, "  Sala   Norte  ");
    let renamed = rename(&fixture, &created, "Sala    Sur").unwrap();

    assert_eq!(created.name, "Sala Norte");
    assert_eq!(diff_of(&audit_rows(&fixture)[0])["name"], "Sala Norte");
    assert_eq!(renamed.name, "Sala Sur");
    assert_eq!(stored(&fixture, renamed.id).name, "Sala Sur");
    assert_eq!(stored_name_key(&fixture, renamed.id), "sala sur");
}

#[test]
fn tabs_newlines_and_unicode_spaces_between_words_are_still_rejected() {
    let fixture = fixture();
    let existing = create(&fixture, "Facial");

    for name in [
        "Cabina\t 1",
        "Cabina \n1",
        "Cabina\u{00A0}\u{00A0}1",
        "Cabina \u{3000} 1",
    ] {
        assert!(is_field(try_create(&fixture, name), "name"), "{name:?}");
        assert!(
            is_field(rename(&fixture, &existing, name).unwrap_err(), "name"),
            "{name:?}"
        );
    }
    assert_eq!(resource_count(&fixture), SEEDED_RESOURCES + 1);
}

#[test]
fn the_length_limit_applies_after_collapsing_inner_spaces() {
    let fixture = fixture();
    let fits_after_collapse = format!("{}   {}", "a".repeat(40), "b".repeat(39));
    let too_long_after_collapse = format!("{}   {}", "c".repeat(40), "d".repeat(40));

    let accepted = create(&fixture, &fits_after_collapse);
    let rejected = try_create(&fixture, &too_long_after_collapse);

    assert_eq!(accepted.name.chars().count(), 80);
    assert!(is_field(rejected, "name"));
}

#[test]
fn collapsing_composes_with_nfc_normalization() {
    let fixture = fixture();

    let created = create(&fixture, "Cafe\u{301}   sala");

    assert_eq!(created.name, "Caf\u{e9} sala");
}

#[test]
fn renaming_to_the_same_name_with_extra_spaces_changes_nothing() {
    let fixture = fixture();
    let seeded = stored(&fixture, 1);

    let unchanged = rename(&fixture, &seeded, "Cabina   1").unwrap();

    assert_eq!(unchanged, seeded);
    assert!(audit_rows(&fixture).is_empty());
}
