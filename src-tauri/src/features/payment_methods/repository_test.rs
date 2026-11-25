use rusqlite::Connection;

use super::*;
use crate::db::migrate;
use crate::features::users::repository::{insert_user, NewUserRow};

const OWNER_ROLE: i64 = 1;
const SEEDED_NAMES: [&str; 5] = [
    "Efectivo",
    "Pago móvil",
    "Punto de venta",
    "Transferencia",
    "Zelle",
];
const INCLUDING_INACTIVE: PaymentMethodFilter = PaymentMethodFilter {
    include_inactive: true,
};
const ONLY_ACTIVE: PaymentMethodFilter = PaymentMethodFilter {
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

fn input(name: &str) -> PaymentMethodInput {
    PaymentMethodInput {
        name: name.to_string(),
    }
}

fn seed(conn: &Connection, actor_id: i64, name: &str) -> i64 {
    insert_payment_method(conn, &input(name), actor_id).unwrap()
}

fn names(methods: Vec<PaymentMethodSummary>) -> Vec<String> {
    methods.into_iter().map(|method| method.name).collect()
}

fn clear_seeded(conn: &Connection) {
    conn.execute("DELETE FROM payment_methods", []).unwrap();
}

fn audit_stamp(conn: &Connection, id: i64) -> (Option<i64>, Option<i64>) {
    conn.query_row(
        "SELECT created_by, updated_by FROM payment_methods WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap()
}

fn stored_key(conn: &Connection, id: i64) -> String {
    conn.query_row(
        "SELECT name_key FROM payment_methods WHERE id = ?1",
        [id],
        |row| row.get(0),
    )
    .unwrap()
}

fn seed_with_key(conn: &Connection, name: &str, name_key: &str) -> i64 {
    conn.execute(
        "INSERT INTO payment_methods (name, name_key) VALUES (?1, ?2)",
        [name, name_key],
    )
    .unwrap();
    conn.last_insert_rowid()
}

#[test]
fn the_seeded_methods_are_found_with_the_mock_ids_and_names() {
    let conn = migrated();

    let found: Vec<(i64, String, bool)> = (1..=5)
        .map(|id| {
            let method = find_payment_method(&conn, id).unwrap().unwrap();
            (method.id, method.name, method.active)
        })
        .collect();

    assert_eq!(
        found,
        vec![
            (1, "Efectivo".to_string(), true),
            (2, "Pago móvil".to_string(), true),
            (3, "Zelle".to_string(), true),
            (4, "Transferencia".to_string(), true),
            (5, "Punto de venta".to_string(), true),
        ]
    );
}

#[test]
fn the_seeded_name_keys_match_the_ones_rust_computes() {
    let conn = migrated();

    for method in list_payment_methods(&conn, INCLUDING_INACTIVE).unwrap() {
        assert_eq!(
            stored_key(&conn, method.id),
            name_key(&method.name),
            "{}",
            method.name
        );
    }
}

#[test]
fn seeded_rows_are_not_stamped_with_a_user() {
    let conn = migrated();

    assert_eq!(audit_stamp(&conn, 1), (None, None));
    assert_eq!(audit_stamp(&conn, 5), (None, None));
}

#[test]
fn insert_payment_method_stores_an_active_method_stamped_with_the_actor() {
    let conn = migrated();
    let actor_id = actor(&conn);

    let id = seed(&conn, actor_id, "Cheque");
    let stored = find_payment_method(&conn, id).unwrap().unwrap();

    assert_eq!(stored.id, id);
    assert_eq!(stored.name, "Cheque");
    assert!(stored.active);
    assert_eq!(stored.created_at.len(), 16);
    assert_eq!(audit_stamp(&conn, id), (Some(actor_id), Some(actor_id)));
}

#[test]
fn find_payment_method_misses_unknown_ids() {
    let conn = migrated();

    assert_eq!(find_payment_method(&conn, 999).unwrap(), None);
}

#[test]
fn list_payment_methods_hides_inactive_unless_requested() {
    let conn = migrated();
    let actor_id = actor(&conn);
    set_payment_method_active(&conn, 3, false, actor_id).unwrap();

    let visible = names(list_payment_methods(&conn, ONLY_ACTIVE).unwrap());
    let everything = names(list_payment_methods(&conn, INCLUDING_INACTIVE).unwrap());

    assert_eq!(
        visible,
        vec!["Efectivo", "Pago móvil", "Punto de venta", "Transferencia"]
    );
    assert_eq!(everything, SEEDED_NAMES);
}

#[test]
fn list_payment_methods_orders_by_name_ignoring_case_regardless_of_insertion_order() {
    let conn = migrated();
    clear_seeded(&conn);
    let actor_id = actor(&conn);
    for name in ["sala", "Patio", "azotea", "Balcon"] {
        seed(&conn, actor_id, name);
    }

    let listed = names(list_payment_methods(&conn, INCLUDING_INACTIVE).unwrap());

    assert_eq!(listed, vec!["azotea", "Balcon", "Patio", "sala"]);
}

#[test]
fn list_payment_methods_on_an_empty_table_is_empty() {
    let conn = migrated();
    clear_seeded(&conn);

    assert!(list_payment_methods(&conn, INCLUDING_INACTIVE)
        .unwrap()
        .is_empty());
}

#[test]
fn payment_method_name_taken_is_nocase_and_can_exclude_one_method() {
    let conn = migrated();
    let actor_id = actor(&conn);
    let id = seed(&conn, actor_id, "Cheque");

    assert!(payment_method_name_taken(&conn, "cheque", None).unwrap());
    assert!(payment_method_name_taken(&conn, "CHEQUE", None).unwrap());
    assert!(!payment_method_name_taken(&conn, "cheque", Some(id)).unwrap());
    assert!(!payment_method_name_taken(&conn, "Cripto", None).unwrap());
}

#[test]
fn payment_method_name_taken_sees_the_seeded_names() {
    let conn = migrated();

    assert!(payment_method_name_taken(&conn, "ZELLE", None).unwrap());
    assert!(payment_method_name_taken(&conn, "pago móvil", None).unwrap());
    assert!(!payment_method_name_taken(&conn, "Zelle", Some(3)).unwrap());
}

#[test]
fn payment_method_name_taken_folds_non_ascii_letters() {
    let conn = migrated();
    let actor_id = actor(&conn);
    seed(&conn, actor_id, "Ñandú Pay");

    assert!(payment_method_name_taken(&conn, "ñandú pay", None).unwrap());
}

#[test]
fn apply_payment_method_update_replaces_the_name_and_stamps_the_updater() {
    let conn = migrated();
    let creator = actor(&conn);
    let id = seed(&conn, creator, "Cheque");
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

    apply_payment_method_update(&conn, id, &input("Cripto"), updater).unwrap();

    let stored = find_payment_method(&conn, id).unwrap().unwrap();
    assert_eq!(stored.name, "Cripto");
    assert!(stored.active);
    assert_eq!(audit_stamp(&conn, id), (Some(creator), Some(updater)));
}

#[test]
fn set_payment_method_active_flips_only_the_flag() {
    let conn = migrated();
    let actor_id = actor(&conn);
    let id = seed(&conn, actor_id, "Cheque");

    set_payment_method_active(&conn, id, false, actor_id).unwrap();
    let retired = find_payment_method(&conn, id).unwrap().unwrap();
    set_payment_method_active(&conn, id, true, actor_id).unwrap();
    let restored = find_payment_method(&conn, id).unwrap().unwrap();

    assert!(!retired.active);
    assert_eq!(retired.name, "Cheque");
    assert!(restored.active);
}

#[test]
fn insert_and_update_persist_the_name_key_of_the_name() {
    let conn = migrated();
    let actor_id = actor(&conn);

    let id = seed(&conn, actor_id, "\u{FF33}ala");
    let after_insert = stored_key(&conn, id);
    apply_payment_method_update(&conn, id, &input("CAFE\u{301}"), actor_id).unwrap();

    assert_eq!(after_insert, name_key("Sala"));
    assert_eq!(stored_key(&conn, id), name_key("CAF\u{e9}"));
}

#[test]
fn payment_method_name_taken_matches_full_width_letters() {
    let conn = migrated();

    assert!(payment_method_name_taken(&conn, "\u{FF3A}elle", None).unwrap());
}

#[test]
fn payment_method_name_taken_matches_a_stored_decomposed_name_against_a_composed_one() {
    let conn = migrated();
    seed_with_key(&conn, "Cafe\u{301}", "caf\u{e9}");

    assert!(payment_method_name_taken(&conn, "CAF\u{c9}", None).unwrap());
    assert!(payment_method_name_taken(&conn, "CAFE\u{301}", None).unwrap());
}

#[test]
fn payment_method_name_taken_frees_the_old_name_after_a_rename() {
    let conn = migrated();
    let actor_id = actor(&conn);
    let id = seed(&conn, actor_id, "Cheque");

    apply_payment_method_update(&conn, id, &input("Cripto"), actor_id).unwrap();

    assert!(!payment_method_name_taken(&conn, "Cheque", None).unwrap());
    assert!(payment_method_name_taken(&conn, "CRIPTO", None).unwrap());
}

#[test]
fn inserting_two_methods_with_colliding_keys_fails_in_the_database() {
    let conn = migrated();
    let actor_id = actor(&conn);
    seed(&conn, actor_id, "Cheque");

    let collision = insert_payment_method(&conn, &input("CHEQUE"), actor_id);

    assert!(collision.is_err());
}
