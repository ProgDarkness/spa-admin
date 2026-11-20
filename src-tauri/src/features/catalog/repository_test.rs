use rusqlite::Connection;

use super::*;
use crate::db::migrate;
use crate::features::users::repository::{insert_user, NewUserRow};

const OWNER_ROLE: i64 = 1;
const INCLUDING_INACTIVE: ServiceFilter = ServiceFilter {
    include_inactive: true,
};
const ONLY_ACTIVE: ServiceFilter = ServiceFilter {
    include_inactive: false,
};

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn actor(conn: &Connection) -> i64 {
    let row = NewUserRow {
        username: "duena".to_string(),
        password_hash: "hash-opaco".to_string(),
        role_id: OWNER_ROLE,
    };
    insert_user(conn, &row, None).unwrap()
}

fn input(name: &str) -> ServiceInput {
    ServiceInput {
        name: name.to_string(),
        price_cents: 3500,
        duration_min: 60,
    }
}

fn seed(conn: &Connection, actor_id: i64, name: &str) -> i64 {
    insert_service(conn, &input(name), actor_id).unwrap()
}

fn names(services: Vec<ServiceSummary>) -> Vec<String> {
    services.into_iter().map(|service| service.name).collect()
}

fn audit_stamp(conn: &Connection, id: i64) -> (i64, i64) {
    conn.query_row(
        "SELECT created_by, updated_by FROM services WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap()
}

#[test]
fn insert_service_stores_the_input_as_an_active_usd_service_stamped_with_the_actor() {
    let conn = migrated();
    let actor_id = actor(&conn);

    let id = insert_service(&conn, &input("Masaje"), actor_id).unwrap();
    let stored = find_service(&conn, id).unwrap().unwrap();

    assert_eq!(stored.id, id);
    assert_eq!(stored.name, "Masaje");
    assert_eq!(stored.price_cents, 3500);
    assert_eq!(stored.duration_min, 60);
    assert_eq!(stored.currency, "USD");
    assert!(stored.active);
    assert_eq!(stored.created_at.len(), 16);
    assert_eq!(audit_stamp(&conn, id), (actor_id, actor_id));
}

#[test]
fn find_service_misses_unknown_ids() {
    let conn = migrated();

    assert_eq!(find_service(&conn, 999).unwrap(), None);
}

#[test]
fn list_services_hides_inactive_unless_requested() {
    let conn = migrated();
    let actor_id = actor(&conn);
    seed(&conn, actor_id, "Facial");
    let retired = seed(&conn, actor_id, "Masaje");
    set_service_active(&conn, retired, false, actor_id).unwrap();

    let visible = names(list_services(&conn, ONLY_ACTIVE).unwrap());
    let everything = names(list_services(&conn, INCLUDING_INACTIVE).unwrap());

    assert_eq!(visible, vec!["Facial"]);
    assert_eq!(everything, vec!["Facial", "Masaje"]);
}

#[test]
fn list_services_orders_by_name_ignoring_case_regardless_of_insertion_order() {
    let conn = migrated();
    let actor_id = actor(&conn);
    for name in ["pedicura", "Masaje", "facial", "Manicura"] {
        seed(&conn, actor_id, name);
    }

    let listed = names(list_services(&conn, INCLUDING_INACTIVE).unwrap());

    assert_eq!(listed, vec!["facial", "Manicura", "Masaje", "pedicura"]);
}

#[test]
fn list_services_on_an_empty_catalog_is_empty() {
    let conn = migrated();

    assert!(list_services(&conn, INCLUDING_INACTIVE).unwrap().is_empty());
}

#[test]
fn service_name_taken_is_nocase_and_can_exclude_one_service() {
    let conn = migrated();
    let actor_id = actor(&conn);
    let id = seed(&conn, actor_id, "Masaje");

    assert!(service_name_taken(&conn, "masaje", None).unwrap());
    assert!(service_name_taken(&conn, "MASAJE", None).unwrap());
    assert!(!service_name_taken(&conn, "masaje", Some(id)).unwrap());
    assert!(!service_name_taken(&conn, "Facial", None).unwrap());
}

#[test]
fn service_name_taken_folds_non_ascii_letters() {
    let conn = migrated();
    let actor_id = actor(&conn);
    seed(&conn, actor_id, "Ñandú Spa");

    assert!(service_name_taken(&conn, "ñandú spa", None).unwrap());
}

#[test]
fn apply_service_update_replaces_the_editable_fields_and_stamps_the_updater() {
    let conn = migrated();
    let creator = actor(&conn);
    let id = seed(&conn, creator, "Masaje");
    let updater = insert_user(
        &conn,
        &NewUserRow {
            username: "otra".to_string(),
            password_hash: "hash-opaco".to_string(),
            role_id: OWNER_ROLE,
        },
        None,
    )
    .unwrap();
    let update = ServiceInput {
        name: "Masaje relajante".to_string(),
        price_cents: 4200,
        duration_min: 90,
    };

    apply_service_update(&conn, id, &update, updater).unwrap();

    let stored = find_service(&conn, id).unwrap().unwrap();
    assert_eq!(stored.name, "Masaje relajante");
    assert_eq!(stored.price_cents, 4200);
    assert_eq!(stored.duration_min, 90);
    assert!(stored.active);
    assert_eq!(audit_stamp(&conn, id), (creator, updater));
}

#[test]
fn set_service_active_flips_only_the_flag() {
    let conn = migrated();
    let actor_id = actor(&conn);
    let id = seed(&conn, actor_id, "Masaje");

    set_service_active(&conn, id, false, actor_id).unwrap();
    let retired = find_service(&conn, id).unwrap().unwrap();
    set_service_active(&conn, id, true, actor_id).unwrap();
    let restored = find_service(&conn, id).unwrap().unwrap();

    assert!(!retired.active);
    assert_eq!(
        (retired.name.as_str(), retired.price_cents),
        ("Masaje", 3500)
    );
    assert!(restored.active);
}

fn seed_with_key(conn: &Connection, name: &str, name_key: &str) -> i64 {
    conn.execute(
        "INSERT INTO services (name, name_key, price_cents, duration_min) \
         VALUES (?1, ?2, 3500, 60)",
        [name, name_key],
    )
    .unwrap();
    conn.last_insert_rowid()
}

fn stored_key(conn: &Connection, id: i64) -> String {
    conn.query_row("SELECT name_key FROM services WHERE id = ?1", [id], |row| {
        row.get(0)
    })
    .unwrap()
}

#[test]
fn name_key_unifies_case_width_and_normalization_forms() {
    assert_eq!(name_key("Masaje"), name_key("MASAJE"));
    assert_eq!(name_key("\u{FF2D}asaje"), name_key("Masaje"));
    assert_eq!(name_key("Cafe\u{301}"), name_key("CAF\u{c9}"));
    assert_eq!(name_key("\u{FB01}nal"), name_key("FINAL"));
    assert_ne!(name_key("Masaje"), name_key("Masajes"));
}

#[test]
fn insert_and_update_persist_the_name_key_of_the_name() {
    let conn = migrated();
    let actor_id = actor(&conn);

    let id = seed(&conn, actor_id, "\u{FF2D}asaje");
    let after_insert = stored_key(&conn, id);
    apply_service_update(&conn, id, &input("CAFE\u{301}"), actor_id).unwrap();

    assert_eq!(after_insert, name_key("Masaje"));
    assert_eq!(stored_key(&conn, id), name_key("CAF\u{e9}"));
}

#[test]
fn service_name_taken_matches_full_width_letters() {
    let conn = migrated();
    let actor_id = actor(&conn);
    seed(&conn, actor_id, "Masaje");

    assert!(service_name_taken(&conn, "\u{FF2D}asaje", None).unwrap());
}

#[test]
fn service_name_taken_matches_a_stored_decomposed_name_against_a_composed_one() {
    let conn = migrated();
    seed_with_key(&conn, "Cafe\u{301}", "caf\u{e9}");

    assert!(service_name_taken(&conn, "CAF\u{c9}", None).unwrap());
    assert!(service_name_taken(&conn, "CAFE\u{301}", None).unwrap());
}

#[test]
fn service_name_taken_frees_the_old_name_after_a_rename() {
    let conn = migrated();
    let actor_id = actor(&conn);
    let id = seed(&conn, actor_id, "Masaje");

    apply_service_update(&conn, id, &input("Facial"), actor_id).unwrap();

    assert!(!service_name_taken(&conn, "Masaje", None).unwrap());
    assert!(service_name_taken(&conn, "FACIAL", None).unwrap());
}

#[test]
fn inserting_two_services_with_colliding_keys_fails_in_the_database() {
    let conn = migrated();
    let actor_id = actor(&conn);
    seed(&conn, actor_id, "Masaje");

    let collision = insert_service(&conn, &input("MASAJE"), actor_id);

    assert!(collision.is_err());
}
