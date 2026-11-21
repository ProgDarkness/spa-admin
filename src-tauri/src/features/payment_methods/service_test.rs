use rusqlite::Connection;
use serde_json::{json, Value};

use super::*;
use crate::db::{migrate, Database};
use crate::features::audit::repository::list_all;
use crate::features::audit::AuditEntry;
use crate::features::payment_methods::model::PaymentMethodFilter;
use crate::features::payment_methods::repository;
use crate::features::users::repository::{insert_user, NewUserRow};

const OWNER_ROLE: i64 = 1;
const SEEDED_METHODS: usize = 5;
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
    operation: impl FnOnce(&Connection) -> Result<T, PaymentMethodsError>,
) -> Result<T, PaymentMethodsError> {
    fixture.database.with_tx(|tx| operation(tx))
}

fn audit_rows(fixture: &Fixture) -> Vec<AuditEntry> {
    fixture.database.with_conn(list_all).unwrap()
}

fn diff_of(entry: &AuditEntry) -> Value {
    serde_json::from_str(entry.diff.as_ref().unwrap()).unwrap()
}

fn stored(fixture: &Fixture, id: i64) -> PaymentMethodSummary {
    fixture
        .database
        .with_conn(|conn| repository::find_payment_method(conn, id))
        .unwrap()
        .unwrap()
}

fn method_count(fixture: &Fixture) -> usize {
    fixture
        .database
        .with_conn(|conn| {
            repository::list_payment_methods(
                conn,
                PaymentMethodFilter {
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

fn input(name: &str) -> PaymentMethodInput {
    PaymentMethodInput {
        name: name.to_string(),
    }
}

fn create(fixture: &Fixture, name: &str) -> PaymentMethodSummary {
    run(fixture, |conn| {
        create_payment_method(conn, fixture.actor, &input(name))
    })
    .unwrap()
}

fn try_create(fixture: &Fixture, name: &str) -> PaymentMethodsError {
    run(fixture, |conn| {
        create_payment_method(conn, fixture.actor, &input(name))
    })
    .unwrap_err()
}

fn rename(
    fixture: &Fixture,
    method: &PaymentMethodSummary,
    name: &str,
) -> Result<PaymentMethodSummary, PaymentMethodsError> {
    run(fixture, |conn| {
        update_payment_method(
            conn,
            fixture.actor,
            &PaymentMethodUpdate {
                id: method.id,
                name: name.to_string(),
            },
        )
    })
}

fn activate(
    fixture: &Fixture,
    id: i64,
    active: bool,
) -> Result<PaymentMethodSummary, PaymentMethodsError> {
    run(fixture, |conn| {
        set_payment_method_active(conn, fixture.actor, &PaymentMethodActivation { id, active })
    })
}

fn is_field(error: PaymentMethodsError, expected: &str) -> bool {
    matches!(error, PaymentMethodsError::Validation { field } if field == expected)
}

#[test]
fn create_payment_method_persists_and_audits_a_create_on_the_payment_method_entity() {
    let fixture = fixture();

    let created = create(&fixture, "Cheque");

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action.as_str(), "create");
    assert_eq!(rows[0].entity.as_str(), "payment_method");
    assert_eq!(rows[0].entity_id, Some(created.id));
    assert_eq!(rows[0].actor_user_id, Some(fixture.actor));
    assert_eq!(
        diff_of(&rows[0]),
        json!({ "name": "Cheque", "active": true })
    );
    assert_eq!(created.name, "Cheque");
    assert!(created.active);
    assert_eq!(created, stored(&fixture, created.id));
}

#[test]
fn the_audit_actions_of_payment_methods_are_allowed_for_the_payment_method_entity() {
    for action in [
        AuditAction::Create,
        AuditAction::Update,
        AuditAction::Deactivate,
        AuditAction::Reactivate,
    ] {
        assert!(
            action
                .allowed_entities()
                .contains(&AuditEntity::PaymentMethod),
            "{}",
            action.as_str()
        );
    }
}

#[test]
fn create_payment_method_trims_and_normalizes_the_name_to_nfc() {
    let fixture = fixture();

    let created = create(&fixture, "  Cafe\u{301} pay  ");

    assert_eq!(created.name, "Caf\u{e9} pay");
    assert_eq!(diff_of(&audit_rows(&fixture)[0])["name"], "Caf\u{e9} pay");
}

#[test]
fn blank_name_is_rejected_on_the_name_field() {
    let fixture = fixture();

    for name in ["", "   ", "\t\n"] {
        assert!(is_field(try_create(&fixture, name), "name"), "{name:?}");
    }

    assert_eq!(method_count(&fixture), SEEDED_METHODS);
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn names_with_control_format_or_bidi_characters_are_rejected_on_create_and_rename() {
    let fixture = fixture();
    let existing = create(&fixture, "Cheque");
    let hostile = [
        "Pay\u{200B}",
        "Pa\ny",
        "Pa\ty",
        "Pay\u{202E}",
        "\u{FEFF}Pay",
        "Pa\u{2066}y",
        "Pa\u{0000}y",
        "Pa\u{00A0}y",
    ];

    for name in hostile {
        let on_rename = rename(&fixture, &existing, name).unwrap_err();
        assert!(is_field(try_create(&fixture, name), "name"), "{name:?}");
        assert!(is_field(on_rename, "name"), "{name:?}");
    }

    assert_eq!(method_count(&fixture), SEEDED_METHODS + 1);
    assert_eq!(audit_rows(&fixture).len(), 1);
}

#[test]
fn names_with_inner_spaces_accents_and_parentheses_remain_valid() {
    let fixture = fixture();

    let created = create(&fixture, "Pago m\u{f3}vil (banco)");

    assert_eq!(created.name, "Pago m\u{f3}vil (banco)");
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
fn duplicate_name_ignoring_case_is_rejected_on_create_and_rename() {
    let fixture = fixture();
    create(&fixture, "Cheque");
    let cripto = create(&fixture, "Cripto");
    let audits_before = audit_rows(&fixture).len();

    let on_create = try_create(&fixture, "cHEQUE");
    let on_rename = rename(&fixture, &cripto, "CHEQUE").unwrap_err();

    assert!(is_field(on_create, "name"));
    assert!(is_field(on_rename, "name"));
    assert_eq!(method_count(&fixture), SEEDED_METHODS + 2);
    assert_eq!(audit_rows(&fixture).len(), audits_before);
}

#[test]
fn a_seeded_name_cannot_be_taken_again() {
    let fixture = fixture();

    let on_create = try_create(&fixture, "ZELLE");
    let on_rename = rename(&fixture, &stored(&fixture, 1), "zelle").unwrap_err();

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
fn inner_space_runs_collide_with_the_single_spaced_name_on_create_and_rename() {
    let fixture = fixture();
    let cheque = create(&fixture, "Cheque");
    let audits_before = audit_rows(&fixture).len();

    let seeded_on_create = try_create(&fixture, "Punto  de venta");
    let seeded_on_rename = rename(&fixture, &cheque, "Punto   de   venta").unwrap_err();

    assert!(is_field(seeded_on_create, "name"));
    assert!(is_field(seeded_on_rename, "name"));
    assert_eq!(method_count(&fixture), SEEDED_METHODS + 1);
    assert_eq!(audit_rows(&fixture).len(), audits_before);
}

#[test]
fn inner_space_runs_are_stored_collapsed_with_a_matching_name_key() {
    let fixture = fixture();

    let created = create(&fixture, "  Pago   Digital  ");
    let renamed = rename(&fixture, &created, "Pago    Web").unwrap();

    let key: String = fixture
        .database
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT name_key FROM payment_methods WHERE id = ?1",
                [renamed.id],
                |row| row.get(0),
            )?)
        })
        .unwrap();
    assert_eq!(created.name, "Pago Digital");
    assert_eq!(renamed.name, "Pago Web");
    assert_eq!(stored(&fixture, renamed.id).name, "Pago Web");
    assert_eq!(key, "pago web");
}

#[test]
fn full_width_lookalike_names_collide_on_create_and_rename() {
    let fixture = fixture();
    let cheque = create(&fixture, "Cheque");

    let on_create = try_create(&fixture, "\u{FF3A}elle");
    let on_rename = rename(&fixture, &cheque, "\u{FF3A}ELLE").unwrap_err();

    assert!(is_field(on_create, "name"));
    assert!(is_field(on_rename, "name"));
    assert_eq!(method_count(&fixture), SEEDED_METHODS + 1);
}

#[test]
fn a_method_may_change_only_the_letter_case_of_its_own_name() {
    let fixture = fixture();
    let created = create(&fixture, "cheque");

    let renamed = rename(&fixture, &created, "Cheque").unwrap();

    assert_eq!(renamed.name, "Cheque");
    assert_eq!(
        diff_of(&audit_rows(&fixture)[1]),
        json!({ "name": { "before": "cheque", "after": "Cheque" } })
    );
}

#[test]
fn update_payment_method_audits_only_the_changed_field_with_before_and_after() {
    let fixture = fixture();
    let created = create(&fixture, "Cheque");

    let updated = rename(&fixture, &created, "  Cheque  bancario ").unwrap();

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1].action.as_str(), "update");
    assert_eq!(rows[1].entity.as_str(), "payment_method");
    assert_eq!(rows[1].entity_id, Some(created.id));
    assert_eq!(rows[1].actor_user_id, Some(fixture.actor));
    assert_eq!(
        diff_of(&rows[1]),
        json!({ "name": { "before": "Cheque", "after": "Cheque bancario" } })
    );
    assert_eq!(updated, stored(&fixture, created.id));
}

#[test]
fn update_payment_method_without_changes_does_not_audit_or_touch_the_row() {
    let fixture = fixture();
    let created = create(&fixture, "Cheque");
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
        update_payment_method(
            conn,
            other_actor,
            &PaymentMethodUpdate {
                id: created.id,
                name: "  Cheque  ".into(),
            },
        )
    })
    .unwrap();

    let updated_by: i64 = fixture
        .database
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT updated_by FROM payment_methods WHERE id = ?1",
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
fn renaming_to_the_same_name_with_extra_spaces_changes_nothing() {
    let fixture = fixture();
    let seeded = stored(&fixture, 5);

    let unchanged = rename(&fixture, &seeded, "Punto   de venta").unwrap();

    assert_eq!(unchanged, seeded);
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn update_payment_method_validates_the_name_and_leaves_the_row_untouched() {
    let fixture = fixture();
    let created = create(&fixture, "Cheque");

    for name in ["", "  ", "Ch\u{200B}eque", &"a".repeat(81), "ZELLE"] {
        let error = rename(&fixture, &created, name).unwrap_err();
        assert!(is_field(error, "name"), "{name:?}");
    }

    assert_eq!(stored(&fixture, created.id), created);
    assert_eq!(audit_rows(&fixture).len(), 1);
}

#[test]
fn unknown_payment_method_id_is_a_validation_error_on_the_id_field() {
    let fixture = fixture();
    let ghost = |name: &str| PaymentMethodUpdate {
        id: 999,
        name: name.into(),
    };
    let update = |change: PaymentMethodUpdate| {
        run(&fixture, |conn| {
            update_payment_method(conn, fixture.actor, &change)
        })
        .unwrap_err()
    };

    let on_update = update(ghost("Fantasma"));
    let on_invalid_update = update(ghost(" "));
    let on_deactivate = activate(&fixture, 999, false).unwrap_err();

    assert!(is_field(on_update, "id"));
    assert!(is_field(on_invalid_update, "id"));
    assert!(is_field(on_deactivate, "id"));
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn deactivating_audits_a_deactivate_and_reactivating_audits_a_reactivate() {
    let fixture = fixture();
    let created = create(&fixture, "Cheque");

    let retired = activate(&fixture, created.id, false).unwrap();
    let restored = activate(&fixture, created.id, true).unwrap();

    let rows = audit_rows(&fixture);
    let actions: Vec<&str> = rows.iter().map(|row| row.action.as_str()).collect();
    assert_eq!(actions, ["create", "deactivate", "reactivate"]);
    assert!(rows[1..]
        .iter()
        .all(|row| row.entity.as_str() == "payment_method"));
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
fn a_seeded_method_can_be_deactivated_and_audited() {
    let fixture = fixture();

    let retired = activate(&fixture, 3, false).unwrap();

    let rows = audit_rows(&fixture);
    assert!(!retired.active);
    assert_eq!(retired.name, "Zelle");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action.as_str(), "deactivate");
    assert_eq!(rows[0].entity_id, Some(3));
}

#[test]
fn setting_the_state_a_method_already_has_does_not_audit() {
    let fixture = fixture();
    let created = create(&fixture, "Cheque");

    let still_active = activate(&fixture, created.id, true).unwrap();
    activate(&fixture, created.id, false).unwrap();
    let still_inactive = activate(&fixture, created.id, false).unwrap();

    assert!(still_active.active);
    assert!(!still_inactive.active);
    assert_eq!(audit_rows(&fixture).len(), 2);
}

#[test]
fn an_inactive_method_can_still_be_edited() {
    let fixture = fixture();
    let created = create(&fixture, "Cheque");
    activate(&fixture, created.id, false).unwrap();

    let edited = rename(&fixture, &created, "Cheque viejo").unwrap();

    assert_eq!(edited.name, "Cheque viejo");
    assert!(!edited.active);
}

#[test]
fn a_failing_audit_rolls_back_the_created_method() {
    let fixture = fixture();
    break_audit(&fixture);

    let outcome = run(&fixture, |conn| {
        create_payment_method(conn, fixture.actor, &input("Cheque"))
    });

    assert!(matches!(outcome, Err(PaymentMethodsError::Db(_))));
    assert_eq!(method_count(&fixture), SEEDED_METHODS);
}

#[test]
fn a_failing_audit_rolls_back_the_update() {
    let fixture = fixture();
    let created = create(&fixture, "Cheque");
    break_audit(&fixture);

    let outcome = rename(&fixture, &created, "Otro");

    assert!(matches!(outcome, Err(PaymentMethodsError::Db(_))));
    assert_eq!(stored(&fixture, created.id), created);
}

#[test]
fn a_failing_audit_rolls_back_the_deactivation() {
    let fixture = fixture();
    let created = create(&fixture, "Cheque");
    break_audit(&fixture);

    let outcome = activate(&fixture, created.id, false);

    assert!(matches!(outcome, Err(PaymentMethodsError::Db(_))));
    assert!(stored(&fixture, created.id).active);
}
