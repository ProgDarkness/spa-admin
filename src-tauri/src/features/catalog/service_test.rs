use rusqlite::Connection;
use serde_json::{json, Value};

use super::*;
use crate::db::{migrate, Database};
use crate::features::audit::repository::list_all;
use crate::features::audit::AuditEntry;
use crate::features::catalog::model::ServiceFilter;
use crate::features::catalog::repository;
use crate::features::users::repository::{insert_user, NewUserRow};

pub(super) const OWNER_ROLE: i64 = 1;
const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";

pub(super) struct Fixture {
    pub(super) database: Database,
    pub(super) actor: i64,
}

pub(super) fn fixture() -> Fixture {
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

pub(super) fn run<T>(
    fixture: &Fixture,
    operation: impl FnOnce(&Connection) -> Result<T, CatalogError>,
) -> Result<T, CatalogError> {
    fixture.database.with_tx(|tx| operation(tx))
}

pub(super) fn audit_rows(fixture: &Fixture) -> Vec<AuditEntry> {
    fixture.database.with_conn(list_all).unwrap()
}

pub(super) fn diff_of(entry: &AuditEntry) -> Value {
    serde_json::from_str(entry.diff.as_ref().unwrap()).unwrap()
}

pub(super) fn stored(fixture: &Fixture, id: i64) -> ServiceSummary {
    fixture
        .database
        .with_conn(|conn| repository::find_service(conn, id))
        .unwrap()
        .unwrap()
}

pub(super) fn service_count(fixture: &Fixture) -> usize {
    fixture
        .database
        .with_conn(|conn| {
            repository::list_services(
                conn,
                ServiceFilter {
                    include_inactive: true,
                },
            )
        })
        .unwrap()
        .len()
}

pub(super) fn break_audit(fixture: &Fixture) {
    fixture
        .database
        .with_conn(|conn| {
            conn.execute_batch(FAIL_AUDIT_INSERTS)?;
            Ok(())
        })
        .unwrap();
}

pub(super) fn input(name: &str) -> ServiceInput {
    ServiceInput {
        name: name.to_string(),
        price_cents: 3500,
        duration_min: 60,
    }
}

pub(super) fn create(fixture: &Fixture, name: &str) -> ServiceSummary {
    run(fixture, |conn| {
        create_service(conn, fixture.actor, &input(name))
    })
    .unwrap()
}

pub(super) fn update_of(service: &ServiceSummary) -> ServiceUpdate {
    ServiceUpdate {
        id: service.id,
        name: service.name.clone(),
        price_cents: service.price_cents,
        duration_min: service.duration_min,
    }
}

pub(super) fn activation(id: i64, active: bool) -> ServiceActivation {
    ServiceActivation { id, active }
}

pub(super) fn is_field(error: CatalogError, expected: &str) -> bool {
    matches!(error, CatalogError::Validation { field } if field == expected)
}

#[test]
fn create_service_persists_and_audits_a_create_on_the_service_entity() {
    let fixture = fixture();

    let created = create(&fixture, "Masaje");

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action.as_str(), "create");
    assert_eq!(rows[0].entity.as_str(), "service");
    assert_eq!(rows[0].entity_id, Some(created.id));
    assert_eq!(rows[0].actor_user_id, Some(fixture.actor));
    assert_eq!(
        diff_of(&rows[0]),
        json!({
            "name": "Masaje",
            "priceCents": 3500,
            "durationMin": 60,
            "active": true
        })
    );
    assert_eq!(created.name, "Masaje");
    assert!(created.active);
    assert_eq!(created, stored(&fixture, created.id));
}

#[test]
fn create_service_trims_and_normalizes_the_name_to_nfc() {
    let fixture = fixture();

    let created = create(&fixture, "  Cafe\u{301} relajante  ");

    assert_eq!(created.name, "Caf\u{e9} relajante");
    assert_eq!(
        diff_of(&audit_rows(&fixture)[0])["name"],
        "Caf\u{e9} relajante"
    );
}

#[test]
fn blank_name_is_rejected_on_the_name_field() {
    let fixture = fixture();

    for name in ["", "   ", "\t\n"] {
        let error = run(&fixture, |conn| {
            create_service(conn, fixture.actor, &input(name))
        })
        .unwrap_err();
        assert!(is_field(error, "name"), "{name:?}");
    }

    assert_eq!(service_count(&fixture), 0);
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn names_with_control_format_or_bidi_characters_are_rejected_on_create_and_rename() {
    let fixture = fixture();
    let existing = create(&fixture, "Facial");
    let hostile = [
        "Masaje\u{200B}",
        "Ma\nsaje",
        "Ma\tsaje",
        "Masaje\u{202E}",
        "\u{FEFF}Masaje",
        "Ma\u{2066}saje",
        "Ma\u{0000}saje",
        "Ma\u{00A0}saje",
    ];

    for name in hostile {
        let on_create = run(&fixture, |conn| {
            create_service(conn, fixture.actor, &input(name))
        })
        .unwrap_err();
        let on_rename = run(&fixture, |conn| {
            update_service(
                conn,
                fixture.actor,
                &ServiceUpdate {
                    name: name.to_string(),
                    ..update_of(&existing)
                },
            )
        })
        .unwrap_err();
        assert!(is_field(on_create, "name"), "{name:?}");
        assert!(is_field(on_rename, "name"), "{name:?}");
    }

    assert_eq!(service_count(&fixture), 1);
    assert_eq!(audit_rows(&fixture).len(), 1);
}

#[test]
fn names_with_inner_spaces_and_accents_remain_valid() {
    let fixture = fixture();

    let created = create(&fixture, "Masaje con pi\u{e9}dras calientes");

    assert_eq!(created.name, "Masaje con pi\u{e9}dras calientes");
}

#[test]
fn name_length_is_limited_to_eighty_characters_after_normalization() {
    let fixture = fixture();
    let exactly_eighty = "a".repeat(80);
    let eighty_composed_from_160_scalars = "e\u{301}".repeat(80);

    let too_long = run(&fixture, |conn| {
        create_service(conn, fixture.actor, &input(&"a".repeat(81)))
    })
    .unwrap_err();
    let at_limit = create(&fixture, &exactly_eighty);
    let composed = create(&fixture, &eighty_composed_from_160_scalars);

    assert!(is_field(too_long, "name"));
    assert_eq!(at_limit.name.chars().count(), 80);
    assert_eq!(composed.name.chars().count(), 80);
}

#[test]
fn price_must_be_between_one_cent_and_the_maximum_amount() {
    let fixture = fixture();

    for price_cents in [0, -1, i64::MIN, MAX_AMOUNT_CENTS + 1, i64::MAX] {
        let error = run(&fixture, |conn| {
            create_service(
                conn,
                fixture.actor,
                &ServiceInput {
                    price_cents,
                    ..input("Masaje")
                },
            )
        })
        .unwrap_err();
        assert!(is_field(error, "priceCents"), "{price_cents}");
    }
    let cheapest = run(&fixture, |conn| {
        create_service(
            conn,
            fixture.actor,
            &ServiceInput {
                price_cents: 1,
                ..input("Barato")
            },
        )
    })
    .unwrap();
    let priciest = run(&fixture, |conn| {
        create_service(
            conn,
            fixture.actor,
            &ServiceInput {
                price_cents: MAX_AMOUNT_CENTS,
                ..input("Caro")
            },
        )
    })
    .unwrap();

    assert_eq!(cheapest.price_cents, 1);
    assert_eq!(priciest.price_cents, MAX_AMOUNT_CENTS);
    assert_eq!(service_count(&fixture), 2);
}

#[test]
fn duration_must_be_positive_a_multiple_of_five_and_at_most_a_day() {
    let fixture = fixture();

    for duration_min in [0, -5, 1, 7, 61, 1445, 1500, i64::MAX, i64::MIN] {
        let error = run(&fixture, |conn| {
            create_service(
                conn,
                fixture.actor,
                &ServiceInput {
                    duration_min,
                    ..input("Masaje")
                },
            )
        })
        .unwrap_err();
        assert!(is_field(error, "durationMin"), "{duration_min}");
    }
    let shortest = run(&fixture, |conn| {
        create_service(
            conn,
            fixture.actor,
            &ServiceInput {
                duration_min: 5,
                ..input("Corto")
            },
        )
    })
    .unwrap();
    let longest = run(&fixture, |conn| {
        create_service(
            conn,
            fixture.actor,
            &ServiceInput {
                duration_min: 1440,
                ..input("Largo")
            },
        )
    })
    .unwrap();

    assert_eq!((shortest.duration_min, longest.duration_min), (5, 1440));
    assert_eq!(service_count(&fixture), 2);
}

#[test]
fn duplicate_name_ignoring_case_is_rejected_on_create_and_rename() {
    let fixture = fixture();
    create(&fixture, "Masaje");
    let facial = create(&fixture, "Facial");
    let audits_before = audit_rows(&fixture).len();

    let on_create = run(&fixture, |conn| {
        create_service(conn, fixture.actor, &input("mASAJE"))
    })
    .unwrap_err();
    let on_rename = run(&fixture, |conn| {
        update_service(
            conn,
            fixture.actor,
            &ServiceUpdate {
                name: "MASAJE".into(),
                ..update_of(&facial)
            },
        )
    })
    .unwrap_err();

    assert!(is_field(on_create, "name"));
    assert!(is_field(on_rename, "name"));
    assert_eq!(service_count(&fixture), 2);
    assert_eq!(audit_rows(&fixture).len(), audits_before);
}

#[test]
fn duplicate_name_is_detected_after_trim_and_normalization() {
    let fixture = fixture();
    create(&fixture, "Caf\u{e9}");

    let error = run(&fixture, |conn| {
        create_service(conn, fixture.actor, &input("  CAFE\u{301} "))
    })
    .unwrap_err();

    assert!(is_field(error, "name"));
}

#[test]
fn a_service_may_change_only_the_letter_case_of_its_own_name() {
    let fixture = fixture();
    let created = create(&fixture, "masaje");

    let renamed = run(&fixture, |conn| {
        update_service(
            conn,
            fixture.actor,
            &ServiceUpdate {
                name: "Masaje".into(),
                ..update_of(&created)
            },
        )
    })
    .unwrap();

    assert_eq!(renamed.name, "Masaje");
}

fn seed_decomposed(fixture: &Fixture, name: &str, name_key: &str) {
    fixture
        .database
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO services (name, name_key, price_cents, duration_min) \
                 VALUES (?1, ?2, 3500, 60)",
                [name, name_key],
            )?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn full_width_lookalike_names_collide_on_create_and_rename() {
    let fixture = fixture();
    create(&fixture, "Masaje");
    let facial = create(&fixture, "Facial");

    let on_create = run(&fixture, |conn| {
        create_service(conn, fixture.actor, &input("\u{FF2D}asaje"))
    })
    .unwrap_err();
    let on_rename = run(&fixture, |conn| {
        update_service(
            conn,
            fixture.actor,
            &ServiceUpdate {
                name: "\u{FF2D}ASAJE".into(),
                ..update_of(&facial)
            },
        )
    })
    .unwrap_err();

    assert!(is_field(on_create, "name"));
    assert!(is_field(on_rename, "name"));
    assert_eq!(service_count(&fixture), 2);
}

#[test]
fn a_stored_decomposed_name_collides_with_its_composed_form() {
    let fixture = fixture();
    seed_decomposed(&fixture, "Cafe\u{301}", "caf\u{e9}");

    let error = run(&fixture, |conn| {
        create_service(conn, fixture.actor, &input("CAF\u{c9}"))
    })
    .unwrap_err();

    assert!(is_field(error, "name"));
    assert_eq!(service_count(&fixture), 1);
}
