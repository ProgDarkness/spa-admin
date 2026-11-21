use super::tests::{
    activation, audit_rows, break_audit, create, diff_of, fixture, input, is_field, run,
    service_count, stored, update_of, OWNER_ROLE,
};
use super::*;
use crate::features::users::repository::{insert_user, NewUserRow};

#[test]
fn update_service_audits_only_the_changed_fields_with_before_and_after() {
    let fixture = fixture();
    let created = create(&fixture, "Masaje");

    let updated = run(&fixture, |conn| {
        update_service(
            conn,
            fixture.actor,
            &ServiceUpdate {
                price_cents: 4200,
                duration_min: 90,
                ..update_of(&created)
            },
        )
    })
    .unwrap();

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1].action.as_str(), "update");
    assert_eq!(rows[1].entity.as_str(), "service");
    assert_eq!(rows[1].entity_id, Some(created.id));
    assert_eq!(rows[1].actor_user_id, Some(fixture.actor));
    assert_eq!(
        diff_of(&rows[1]),
        json!({
            "priceCents": { "before": 3500, "after": 4200 },
            "durationMin": { "before": 60, "after": 90 }
        })
    );
    assert_eq!((updated.price_cents, updated.duration_min), (4200, 90));
    assert_eq!(updated.name, "Masaje");
    assert_eq!(updated, stored(&fixture, created.id));
}

#[test]
fn update_service_with_a_renamed_name_only_reports_the_name() {
    let fixture = fixture();
    let created = create(&fixture, "Masaje");

    run(&fixture, |conn| {
        update_service(
            conn,
            fixture.actor,
            &ServiceUpdate {
                name: "  Masaje sueco ".into(),
                ..update_of(&created)
            },
        )
    })
    .unwrap();

    assert_eq!(
        diff_of(&audit_rows(&fixture)[1]),
        json!({ "name": { "before": "Masaje", "after": "Masaje sueco" } })
    );
}

#[test]
fn update_service_without_changes_does_not_audit_or_touch_the_row() {
    let fixture = fixture();
    let created = create(&fixture, "Masaje");
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
        update_service(
            conn,
            other_actor,
            &ServiceUpdate {
                name: "  Masaje  ".into(),
                ..update_of(&created)
            },
        )
    })
    .unwrap();

    let updated_by: i64 = fixture
        .database
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT updated_by FROM services WHERE id = ?1",
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
fn update_service_validates_each_field_and_leaves_the_row_untouched() {
    let fixture = fixture();
    let created = create(&fixture, "Masaje");
    let invalid_changes = [
        (
            "name",
            ServiceUpdate {
                name: " ".into(),
                ..update_of(&created)
            },
        ),
        (
            "priceCents",
            ServiceUpdate {
                price_cents: 0,
                ..update_of(&created)
            },
        ),
        (
            "priceCents",
            ServiceUpdate {
                price_cents: MAX_AMOUNT_CENTS + 1,
                ..update_of(&created)
            },
        ),
        (
            "durationMin",
            ServiceUpdate {
                duration_min: 7,
                ..update_of(&created)
            },
        ),
        (
            "durationMin",
            ServiceUpdate {
                duration_min: 1445,
                ..update_of(&created)
            },
        ),
    ];

    for (field, change) in invalid_changes {
        let error = run(&fixture, |conn| {
            update_service(conn, fixture.actor, &change)
        })
        .unwrap_err();
        assert!(is_field(error, field), "{field}");
    }

    assert_eq!(stored(&fixture, created.id), created);
    assert_eq!(audit_rows(&fixture).len(), 1);
}

#[test]
fn unknown_service_id_is_a_validation_error_on_the_id_field() {
    let fixture = fixture();
    let ghost = ServiceUpdate {
        id: 999,
        name: "Fantasma".into(),
        price_cents: 100,
        duration_min: 30,
    };

    let on_update = run(&fixture, |conn| update_service(conn, fixture.actor, &ghost)).unwrap_err();
    let on_invalid_update = run(&fixture, |conn| {
        update_service(
            conn,
            fixture.actor,
            &ServiceUpdate {
                name: " ".into(),
                ..ghost.clone()
            },
        )
    })
    .unwrap_err();
    let on_deactivate = run(&fixture, |conn| {
        set_service_active(conn, fixture.actor, &activation(999, false))
    })
    .unwrap_err();

    assert!(is_field(on_update, "id"));
    assert!(is_field(on_invalid_update, "id"));
    assert!(is_field(on_deactivate, "id"));
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn deactivating_audits_a_deactivate_and_reactivating_audits_a_reactivate() {
    let fixture = fixture();
    let created = create(&fixture, "Masaje");

    let retired = run(&fixture, |conn| {
        set_service_active(conn, fixture.actor, &activation(created.id, false))
    })
    .unwrap();
    let restored = run(&fixture, |conn| {
        set_service_active(conn, fixture.actor, &activation(created.id, true))
    })
    .unwrap();

    let rows = audit_rows(&fixture);
    let actions: Vec<&str> = rows.iter().map(|row| row.action.as_str()).collect();
    assert_eq!(actions, ["create", "deactivate", "reactivate"]);
    assert!(rows[1..].iter().all(|row| row.entity.as_str() == "service"));
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
fn setting_the_state_a_service_already_has_does_not_audit() {
    let fixture = fixture();
    let created = create(&fixture, "Masaje");

    let still_active = run(&fixture, |conn| {
        set_service_active(conn, fixture.actor, &activation(created.id, true))
    })
    .unwrap();
    run(&fixture, |conn| {
        set_service_active(conn, fixture.actor, &activation(created.id, false))
    })
    .unwrap();
    let still_inactive = run(&fixture, |conn| {
        set_service_active(conn, fixture.actor, &activation(created.id, false))
    })
    .unwrap();

    assert!(still_active.active);
    assert!(!still_inactive.active);
    assert_eq!(audit_rows(&fixture).len(), 2);
}

#[test]
fn an_inactive_service_can_still_be_edited() {
    let fixture = fixture();
    let created = create(&fixture, "Masaje");
    run(&fixture, |conn| {
        set_service_active(conn, fixture.actor, &activation(created.id, false))
    })
    .unwrap();

    let edited = run(&fixture, |conn| {
        update_service(
            conn,
            fixture.actor,
            &ServiceUpdate {
                price_cents: 5000,
                ..update_of(&created)
            },
        )
    })
    .unwrap();

    assert_eq!(edited.price_cents, 5000);
    assert!(!edited.active);
}

#[test]
fn a_failing_audit_rolls_back_the_created_service() {
    let fixture = fixture();
    break_audit(&fixture);

    let outcome = run(&fixture, |conn| {
        create_service(conn, fixture.actor, &input("Masaje"))
    });

    assert!(matches!(outcome, Err(CatalogError::Db(_))));
    assert_eq!(service_count(&fixture), 0);
}

#[test]
fn a_failing_audit_rolls_back_the_update() {
    let fixture = fixture();
    let created = create(&fixture, "Masaje");
    break_audit(&fixture);

    let outcome = run(&fixture, |conn| {
        update_service(
            conn,
            fixture.actor,
            &ServiceUpdate {
                price_cents: 9900,
                ..update_of(&created)
            },
        )
    });

    assert!(matches!(outcome, Err(CatalogError::Db(_))));
    assert_eq!(stored(&fixture, created.id), created);
}

#[test]
fn a_failing_audit_rolls_back_the_deactivation() {
    let fixture = fixture();
    let created = create(&fixture, "Masaje");
    break_audit(&fixture);

    let outcome = run(&fixture, |conn| {
        set_service_active(conn, fixture.actor, &activation(created.id, false))
    });

    assert!(matches!(outcome, Err(CatalogError::Db(_))));
    assert!(stored(&fixture, created.id).active);
}

#[test]
fn update_service_with_only_a_new_duration_audits_exactly_that_field() {
    let fixture = fixture();
    let created = create(&fixture, "Masaje");

    let updated = run(&fixture, |conn| {
        update_service(
            conn,
            fixture.actor,
            &ServiceUpdate {
                duration_min: 90,
                ..update_of(&created)
            },
        )
    })
    .unwrap();

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 2);
    assert_eq!(
        diff_of(&rows[1]),
        json!({ "durationMin": { "before": 60, "after": 90 } })
    );
    assert_eq!(updated.duration_min, 90);
    assert_eq!(updated, stored(&fixture, created.id));
}

#[test]
fn update_service_with_only_a_new_price_audits_exactly_that_field() {
    let fixture = fixture();
    let created = create(&fixture, "Masaje");

    let updated = run(&fixture, |conn| {
        update_service(
            conn,
            fixture.actor,
            &ServiceUpdate {
                price_cents: 4200,
                ..update_of(&created)
            },
        )
    })
    .unwrap();

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 2);
    assert_eq!(
        diff_of(&rows[1]),
        json!({ "priceCents": { "before": 3500, "after": 4200 } })
    );
    assert_eq!(updated.price_cents, 4200);
}
