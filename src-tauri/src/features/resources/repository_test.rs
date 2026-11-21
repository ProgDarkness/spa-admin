use rusqlite::Connection;

use super::*;
use crate::db::migrate;
use crate::features::users::repository::{insert_user, NewUserRow};

const OWNER_ROLE: i64 = 1;
const INCLUDING_INACTIVE: ResourceFilter = ResourceFilter {
    include_inactive: true,
};
const ONLY_ACTIVE: ResourceFilter = ResourceFilter {
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

fn input(name: &str) -> ResourceInput {
    ResourceInput {
        name: name.to_string(),
        kind: ResourceKind::Cabin,
    }
}

fn seed(conn: &Connection, actor_id: i64, name: &str) -> i64 {
    insert_resource(conn, &input(name), actor_id).unwrap()
}

fn names(resources: Vec<ResourceSummary>) -> Vec<String> {
    resources
        .into_iter()
        .map(|resource| resource.name)
        .collect()
}

fn clear_seeded(conn: &Connection) {
    conn.execute("DELETE FROM resources", []).unwrap();
}

fn audit_stamp(conn: &Connection, id: i64) -> (Option<i64>, Option<i64>) {
    conn.query_row(
        "SELECT created_by, updated_by FROM resources WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap()
}

fn stored_key(conn: &Connection, id: i64) -> String {
    conn.query_row(
        "SELECT name_key FROM resources WHERE id = ?1",
        [id],
        |row| row.get(0),
    )
    .unwrap()
}

fn seed_with_key(conn: &Connection, name: &str, name_key: &str) -> i64 {
    conn.execute(
        "INSERT INTO resources (name, name_key, kind) VALUES (?1, ?2, 'cabin')",
        [name, name_key],
    )
    .unwrap();
    conn.last_insert_rowid()
}

#[test]
fn the_seeded_resources_are_found_with_the_mock_ids_names_and_kinds() {
    let conn = migrated();

    let found: Vec<(i64, String, ResourceKind, bool)> = (1..=3)
        .map(|id| {
            let resource = find_resource(&conn, id).unwrap().unwrap();
            (resource.id, resource.name, resource.kind, resource.active)
        })
        .collect();

    assert_eq!(
        found,
        vec![
            (1, "Cabina 1".to_string(), ResourceKind::Cabin, true),
            (2, "Cabina 2".to_string(), ResourceKind::Cabin, true),
            (
                3,
                "Manicure (Rosa)".to_string(),
                ResourceKind::Manicure,
                false
            ),
        ]
    );
}

#[test]
fn the_seeded_name_keys_match_the_ones_rust_computes() {
    let conn = migrated();

    for resource in list_resources(&conn, INCLUDING_INACTIVE).unwrap() {
        assert_eq!(
            stored_key(&conn, resource.id),
            name_key(&resource.name),
            "{}",
            resource.name
        );
    }
}

#[test]
fn seeded_rows_are_not_stamped_with_a_user() {
    let conn = migrated();

    assert_eq!(audit_stamp(&conn, 1), (None, None));
    assert_eq!(audit_stamp(&conn, 3), (None, None));
}

#[test]
fn insert_resource_stores_the_input_as_an_active_resource_stamped_with_the_actor() {
    let conn = migrated();
    let actor_id = actor(&conn);
    let manicure = ResourceInput {
        name: "Puesto B".to_string(),
        kind: ResourceKind::Manicure,
    };

    let id = insert_resource(&conn, &manicure, actor_id).unwrap();
    let stored = find_resource(&conn, id).unwrap().unwrap();

    assert_eq!(stored.id, id);
    assert_eq!(stored.name, "Puesto B");
    assert_eq!(stored.kind, ResourceKind::Manicure);
    assert!(stored.active);
    assert_eq!(stored.created_at.len(), 16);
    assert_eq!(audit_stamp(&conn, id), (Some(actor_id), Some(actor_id)));
}

#[test]
fn find_resource_misses_unknown_ids() {
    let conn = migrated();

    assert_eq!(find_resource(&conn, 999).unwrap(), None);
}

#[test]
fn list_resources_hides_inactive_unless_requested() {
    let conn = migrated();

    let visible = names(list_resources(&conn, ONLY_ACTIVE).unwrap());
    let everything = names(list_resources(&conn, INCLUDING_INACTIVE).unwrap());

    assert_eq!(visible, vec!["Cabina 1", "Cabina 2"]);
    assert_eq!(everything, vec!["Cabina 1", "Cabina 2", "Manicure (Rosa)"]);
}

#[test]
fn list_resources_orders_by_name_ignoring_case_regardless_of_insertion_order() {
    let conn = migrated();
    clear_seeded(&conn);
    let actor_id = actor(&conn);
    for name in ["sala", "Patio", "azotea", "Balcon"] {
        seed(&conn, actor_id, name);
    }

    let listed = names(list_resources(&conn, INCLUDING_INACTIVE).unwrap());

    assert_eq!(listed, vec!["azotea", "Balcon", "Patio", "sala"]);
}

#[test]
fn list_resources_on_an_empty_table_is_empty() {
    let conn = migrated();
    clear_seeded(&conn);

    assert!(list_resources(&conn, INCLUDING_INACTIVE)
        .unwrap()
        .is_empty());
}

#[test]
fn resource_name_taken_is_nocase_and_can_exclude_one_resource() {
    let conn = migrated();
    let actor_id = actor(&conn);
    let id = seed(&conn, actor_id, "Sala");

    assert!(resource_name_taken(&conn, "sala", None).unwrap());
    assert!(resource_name_taken(&conn, "SALA", None).unwrap());
    assert!(!resource_name_taken(&conn, "sala", Some(id)).unwrap());
    assert!(!resource_name_taken(&conn, "Patio", None).unwrap());
}

#[test]
fn resource_name_taken_sees_the_seeded_names() {
    let conn = migrated();

    assert!(resource_name_taken(&conn, "CABINA 1", None).unwrap());
    assert!(resource_name_taken(&conn, "manicure (rosa)", None).unwrap());
    assert!(!resource_name_taken(&conn, "Cabina 1", Some(1)).unwrap());
}

#[test]
fn resource_name_taken_folds_non_ascii_letters() {
    let conn = migrated();
    let actor_id = actor(&conn);
    seed(&conn, actor_id, "Ñandú Sala");

    assert!(resource_name_taken(&conn, "ñandú sala", None).unwrap());
}

#[test]
fn apply_resource_update_replaces_the_editable_fields_and_stamps_the_updater() {
    let conn = migrated();
    let creator = actor(&conn);
    let id = seed(&conn, creator, "Sala");
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
    let update = ResourceInput {
        name: "Puesto".to_string(),
        kind: ResourceKind::Manicure,
    };

    apply_resource_update(&conn, id, &update, updater).unwrap();

    let stored = find_resource(&conn, id).unwrap().unwrap();
    assert_eq!(stored.name, "Puesto");
    assert_eq!(stored.kind, ResourceKind::Manicure);
    assert!(stored.active);
    assert_eq!(audit_stamp(&conn, id), (Some(creator), Some(updater)));
}

#[test]
fn set_resource_active_flips_only_the_flag() {
    let conn = migrated();
    let actor_id = actor(&conn);
    let id = seed(&conn, actor_id, "Sala");

    set_resource_active(&conn, id, false, actor_id).unwrap();
    let retired = find_resource(&conn, id).unwrap().unwrap();
    set_resource_active(&conn, id, true, actor_id).unwrap();
    let restored = find_resource(&conn, id).unwrap().unwrap();

    assert!(!retired.active);
    assert_eq!(
        (retired.name.as_str(), retired.kind),
        ("Sala", ResourceKind::Cabin)
    );
    assert!(restored.active);
}

#[test]
fn name_key_unifies_case_width_and_normalization_forms() {
    assert_eq!(name_key("Cabina"), name_key("CABINA"));
    assert_eq!(name_key("\u{FF23}abina"), name_key("Cabina"));
    assert_eq!(name_key("Cafe\u{301}"), name_key("CAF\u{c9}"));
    assert_eq!(name_key("\u{FB01}nal"), name_key("FINAL"));
    assert_ne!(name_key("Cabina"), name_key("Cabinas"));
}

#[test]
fn insert_and_update_persist_the_name_key_of_the_name() {
    let conn = migrated();
    let actor_id = actor(&conn);

    let id = seed(&conn, actor_id, "\u{FF33}ala");
    let after_insert = stored_key(&conn, id);
    apply_resource_update(&conn, id, &input("CAFE\u{301}"), actor_id).unwrap();

    assert_eq!(after_insert, name_key("Sala"));
    assert_eq!(stored_key(&conn, id), name_key("CAF\u{e9}"));
}

#[test]
fn resource_name_taken_matches_full_width_letters() {
    let conn = migrated();
    let actor_id = actor(&conn);
    seed(&conn, actor_id, "Sala");

    assert!(resource_name_taken(&conn, "\u{FF33}ala", None).unwrap());
}

#[test]
fn resource_name_taken_matches_a_stored_decomposed_name_against_a_composed_one() {
    let conn = migrated();
    seed_with_key(&conn, "Cafe\u{301}", "caf\u{e9}");

    assert!(resource_name_taken(&conn, "CAF\u{c9}", None).unwrap());
    assert!(resource_name_taken(&conn, "CAFE\u{301}", None).unwrap());
}

#[test]
fn resource_name_taken_frees_the_old_name_after_a_rename() {
    let conn = migrated();
    let actor_id = actor(&conn);
    let id = seed(&conn, actor_id, "Sala");

    apply_resource_update(&conn, id, &input("Patio"), actor_id).unwrap();

    assert!(!resource_name_taken(&conn, "Sala", None).unwrap());
    assert!(resource_name_taken(&conn, "PATIO", None).unwrap());
}

#[test]
fn inserting_two_resources_with_colliding_keys_fails_in_the_database() {
    let conn = migrated();
    let actor_id = actor(&conn);
    seed(&conn, actor_id, "Sala");

    let collision = insert_resource(&conn, &input("SALA"), actor_id);

    assert!(collision.is_err());
}
