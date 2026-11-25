use rusqlite::Connection;

use super::*;
use crate::db::migrate;
use crate::features::users::repository::{insert_user, NewUserRow};

const OWNER_ROLE: i64 = 1;
const ACTOR: i64 = 1;
const EDITOR: i64 = 2;
const EVERYONE: fn() -> ClientFilter = || filter("", true);

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    let row = NewUserRow {
        username: "duena".to_string(),
        password_hash: "hash-opaco".to_string(),
        role_id: OWNER_ROLE,
    };
    assert_eq!(insert_user(&conn, &row, None).unwrap(), ACTOR);
    let editor = NewUserRow {
        username: "editora".to_string(),
        ..row
    };
    assert_eq!(insert_user(&conn, &editor, None).unwrap(), EDITOR);
    conn
}

fn input(first_name: &str, last_name: &str, national_id: &str, phone: &str) -> ClientInput {
    ClientInput {
        first_name: first_name.to_string(),
        last_name: last_name.to_string(),
        national_id: national_id.to_string(),
        phone: phone.to_string(),
    }
}

fn maria() -> ClientInput {
    input("María", "González", "V-12345678", "0414-123 4567")
}

fn filter(query: &str, include_deleted: bool) -> ClientFilter {
    ClientFilter {
        query: query.to_string(),
        include_deleted,
    }
}

fn ids(clients: Vec<ClientSummary>) -> Vec<i64> {
    clients.into_iter().map(|client| client.id).collect()
}

fn stored_search_key(conn: &Connection, id: i64) -> String {
    conn.query_row(
        "SELECT search_key FROM clients WHERE id = ?1",
        [id],
        |row| row.get(0),
    )
    .unwrap()
}

fn audit_columns(conn: &Connection, id: i64) -> (Option<i64>, Option<i64>) {
    conn.query_row(
        "SELECT created_by, updated_by FROM clients WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap()
}

fn deleted_clients(conn: &Connection) -> (i64, i64, i64) {
    let ana = insert_client(
        conn,
        &input("Ana", "Pérez", "V-16789012", "0412-3456789"),
        ACTOR,
    )
    .unwrap();
    let luis = insert_client(
        conn,
        &input("Luis", "Martínez", "V-18901234", "0416-4567890"),
        ACTOR,
    )
    .unwrap();
    let carlos = insert_client(
        conn,
        &input("Carlos", "Mendoza", "V-26789012", "0416-9012345"),
        ACTOR,
    )
    .unwrap();
    set_client_deleted(conn, carlos, true, ACTOR).unwrap();
    (ana, luis, carlos)
}

#[test]
fn insert_returns_the_new_id_and_the_stored_summary_is_active() {
    let conn = migrated();

    let id = insert_client(&conn, &maria(), ACTOR).unwrap();

    assert_eq!(
        find_client(&conn, id).unwrap(),
        Some(ClientSummary {
            id,
            first_name: "María".into(),
            last_name: "González".into(),
            national_id: "V-12345678".into(),
            phone: "0414-123 4567".into(),
            deleted_at: None,
        })
    );
}

#[test]
fn insert_computes_the_search_key_in_rust() {
    let conn = migrated();

    let id = insert_client(&conn, &maria(), ACTOR).unwrap();

    assert_eq!(
        stored_search_key(&conn, id),
        "maria gonzalez v-12345678 v12345678 0414-123 4567 04141234567"
    );
}

#[test]
fn insert_records_the_actor_as_creator_and_updater() {
    let conn = migrated();

    let id = insert_client(&conn, &maria(), ACTOR).unwrap();

    assert_eq!(audit_columns(&conn, id), (Some(ACTOR), Some(ACTOR)));
}

#[test]
fn insert_of_a_repeated_national_id_fails_with_a_constraint_error() {
    let conn = migrated();
    insert_client(&conn, &maria(), ACTOR).unwrap();

    let repeated = insert_client(&conn, &maria(), ACTOR);

    assert!(repeated.is_err());
}

#[test]
fn find_returns_none_for_an_unknown_id() {
    assert_eq!(find_client(&migrated(), 99).unwrap(), None);
}

#[test]
fn find_by_national_id_returns_active_and_deleted_holders() {
    let conn = migrated();
    let (ana, _, carlos) = deleted_clients(&conn);

    let active = find_client_by_national_id(&conn, "V-16789012")
        .unwrap()
        .unwrap();
    let deleted = find_client_by_national_id(&conn, "V-26789012")
        .unwrap()
        .unwrap();

    assert_eq!(active.id, ana);
    assert_eq!(deleted.id, carlos);
    assert!(deleted.deleted_at.is_some());
    assert_eq!(
        find_client_by_national_id(&conn, "V-99999999").unwrap(),
        None
    );
}

#[test]
fn list_hides_deleted_clients_unless_asked_and_orders_by_id() {
    let conn = migrated();
    let (ana, luis, carlos) = deleted_clients(&conn);

    let visible = ids(list_clients(&conn, &filter("", false)).unwrap());
    let everyone = ids(list_clients(&conn, &EVERYONE()).unwrap());

    assert_eq!(visible, vec![ana, luis]);
    assert_eq!(everyone, vec![ana, luis, carlos]);
}

#[test]
fn list_searches_ignoring_accents_and_case() {
    let conn = migrated();
    let (ana, luis, _) = deleted_clients(&conn);

    assert_eq!(
        ids(list_clients(&conn, &filter("PEREZ", false)).unwrap()),
        vec![ana]
    );
    assert_eq!(
        ids(list_clients(&conn, &filter("martínez", false)).unwrap()),
        vec![luis]
    );
    assert_eq!(
        ids(list_clients(&conn, &filter("  ana  ", false)).unwrap()),
        vec![ana]
    );
}

#[test]
fn list_searches_across_name_and_surname_together() {
    let conn = migrated();
    let (ana, ..) = deleted_clients(&conn);

    let found = list_clients(&conn, &filter("ana perez", false)).unwrap();

    assert_eq!(ids(found), vec![ana]);
}

#[test]
fn list_searches_by_national_id_with_or_without_the_prefix() {
    let conn = migrated();
    let (_, luis, _) = deleted_clients(&conn);

    assert_eq!(
        ids(list_clients(&conn, &filter("v-18901234", false)).unwrap()),
        vec![luis]
    );
    assert_eq!(
        ids(list_clients(&conn, &filter("8901234", false)).unwrap()),
        vec![luis]
    );
}

#[test]
fn list_searches_by_phone_as_written_or_by_digits_only() {
    let conn = migrated();
    let id = insert_client(&conn, &maria(), ACTOR).unwrap();

    assert_eq!(
        ids(list_clients(&conn, &filter("0414-123", false)).unwrap()),
        vec![id]
    );
    assert_eq!(
        ids(list_clients(&conn, &filter("04141234567", false)).unwrap()),
        vec![id]
    );
    assert_eq!(
        ids(list_clients(&conn, &filter("1234567", false)).unwrap()),
        vec![id]
    );
}

#[test]
fn list_finds_the_client_by_every_form_the_national_id_and_phone_are_accepted_in() {
    let conn = migrated();
    let id = insert_client(&conn, &maria(), ACTOR).unwrap();

    for query in [
        "V12345678",
        "V 12345678",
        "12.345.678",
        "v-12345678",
        "V-12.345.678",
        "0414 1234567",
        "04141234567",
        "0414-123 4567",
        "María González",
    ] {
        assert_eq!(
            ids(list_clients(&conn, &filter(query, false)).unwrap()),
            vec![id],
            "{query:?}"
        );
    }
}

#[test]
fn list_search_with_an_oversized_query_still_runs_on_its_first_hundred_characters() {
    let conn = migrated();
    let id = insert_client(&conn, &maria(), ACTOR).unwrap();
    let query = format!("maria{}", " ".repeat(500));

    assert_eq!(
        ids(list_clients(&conn, &filter(&query, false)).unwrap()),
        vec![id]
    );
    assert!(list_clients(&conn, &filter(&"x".repeat(5000), false))
        .unwrap()
        .is_empty());
}

#[test]
fn list_search_respects_the_deleted_filter() {
    let conn = migrated();
    let (_, _, carlos) = deleted_clients(&conn);

    assert!(list_clients(&conn, &filter("mendoza", false))
        .unwrap()
        .is_empty());
    assert_eq!(
        ids(list_clients(&conn, &filter("mendoza", true)).unwrap()),
        vec![carlos]
    );
}

#[test]
fn list_treats_like_wildcards_in_the_query_as_literal_text() {
    let conn = migrated();
    deleted_clients(&conn);

    assert!(list_clients(&conn, &filter("%", true)).unwrap().is_empty());
    assert!(list_clients(&conn, &filter("_", true)).unwrap().is_empty());
    assert!(list_clients(&conn, &filter("\\", true)).unwrap().is_empty());
}

#[test]
fn list_with_no_match_is_empty_and_with_a_blank_query_returns_everyone() {
    let conn = migrated();
    deleted_clients(&conn);

    assert!(list_clients(&conn, &filter("zzz", true))
        .unwrap()
        .is_empty());
    assert_eq!(list_clients(&conn, &filter("   ", false)).unwrap().len(), 2);
}

#[test]
fn list_is_safe_against_sql_metacharacters_in_the_query() {
    let conn = migrated();
    deleted_clients(&conn);

    let hostile = list_clients(&conn, &filter("'; DROP TABLE clients; --", true)).unwrap();

    assert!(hostile.is_empty());
    assert_eq!(list_clients(&conn, &EVERYONE()).unwrap().len(), 3);
}

#[test]
fn list_handles_ten_thousand_clients() {
    let conn = migrated();
    let transaction = conn.unchecked_transaction().unwrap();
    for number in 0..10_000 {
        let national_id = format!("V-{:08}", number + 1);
        insert_client(
            &transaction,
            &input("Ana", "Perez", &national_id, "04141234567"),
            ACTOR,
        )
        .unwrap();
    }
    transaction.commit().unwrap();

    assert_eq!(
        list_clients(&conn, &filter("", false)).unwrap().len(),
        10_000
    );
    assert_eq!(
        list_clients(&conn, &filter("v-00009999", false))
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn apply_update_rewrites_the_fields_and_the_search_key() {
    let conn = migrated();
    let id = insert_client(&conn, &maria(), ACTOR).unwrap();

    apply_client_update(
        &conn,
        id,
        &input("Sofía", "Ramírez", "E-81234567", "0424 7890123"),
        EDITOR,
    )
    .unwrap();

    let updated = find_client(&conn, id).unwrap().unwrap();
    assert_eq!(updated.first_name, "Sofía");
    assert_eq!(updated.national_id, "E-81234567");
    assert_eq!(updated.phone, "0424 7890123");
    assert_eq!(
        stored_search_key(&conn, id),
        "sofia ramirez e-81234567 e81234567 0424 7890123 04247890123"
    );
    assert_eq!(audit_columns(&conn, id), (Some(ACTOR), Some(EDITOR)));
}

#[test]
fn apply_update_does_not_touch_the_deletion_state_or_other_rows() {
    let conn = migrated();
    let (ana, luis, carlos) = deleted_clients(&conn);

    apply_client_update(
        &conn,
        carlos,
        &input("Carlos", "Mendoza", "V-26789012", "0416 000 0000"),
        ACTOR,
    )
    .unwrap();

    assert!(find_client(&conn, carlos)
        .unwrap()
        .unwrap()
        .deleted_at
        .is_some());
    assert_eq!(find_client(&conn, ana).unwrap().unwrap().first_name, "Ana");
    assert_eq!(
        find_client(&conn, luis).unwrap().unwrap().phone,
        "0416-4567890"
    );
}

#[test]
fn apply_update_to_another_clients_national_id_fails_with_a_constraint_error() {
    let conn = migrated();
    let (ana, ..) = deleted_clients(&conn);

    let collision = apply_client_update(
        &conn,
        ana,
        &input("Ana", "Pérez", "V-18901234", "0412-3456789"),
        ACTOR,
    );

    assert!(collision.is_err());
}

#[test]
fn set_deleted_marks_a_minute_precision_local_timestamp_and_reactivation_clears_it() {
    let conn = migrated();
    let id = insert_client(&conn, &maria(), ACTOR).unwrap();

    set_client_deleted(&conn, id, true, EDITOR).unwrap();
    let deleted = find_client(&conn, id).unwrap().unwrap();
    set_client_deleted(&conn, id, false, EDITOR).unwrap();
    let reactivated = find_client(&conn, id).unwrap().unwrap();

    let stamp = deleted.deleted_at.unwrap();
    assert_eq!(stamp.len(), 16, "{stamp}");
    assert_eq!(&stamp[10..11], "T");
    assert_eq!(reactivated.deleted_at, None);
    assert_eq!(audit_columns(&conn, id), (Some(ACTOR), Some(EDITOR)));
}

#[test]
fn set_deleted_on_an_unknown_id_changes_nothing() {
    let conn = migrated();

    set_client_deleted(&conn, 99, true, ACTOR).unwrap();

    assert!(list_clients(&conn, &EVERYONE()).unwrap().is_empty());
}
