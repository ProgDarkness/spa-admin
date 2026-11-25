use rusqlite::Connection;

use super::*;
use crate::db::{migrate, Database};
use crate::features::audit::repository::list_all;
use crate::features::audit::AuditEntry;
use crate::features::clients::model::ClientFilter;
use crate::features::clients::repository;
use crate::features::users::repository::{insert_user, NewUserRow};

const OWNER_ROLE: i64 = 1;
const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";
const EVERYONE: ClientFilter = ClientFilter {
    query: String::new(),
    include_deleted: true,
};

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
    operation: impl FnOnce(&Connection) -> Result<T, ClientError>,
) -> Result<T, ClientError> {
    fixture.database.with_tx(|tx| operation(tx))
}

pub(super) fn audit_rows(fixture: &Fixture) -> Vec<AuditEntry> {
    fixture.database.with_conn(list_all).unwrap()
}

pub(super) fn stored(fixture: &Fixture, id: i64) -> ClientSummary {
    fixture
        .database
        .with_conn(|conn| repository::find_client(conn, id))
        .unwrap()
        .unwrap()
}

pub(super) fn everyone(fixture: &Fixture) -> Vec<ClientSummary> {
    fixture
        .database
        .with_conn(|conn| repository::list_clients(conn, &EVERYONE))
        .unwrap()
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

pub(super) fn diff_of(entry: &AuditEntry) -> serde_json::Value {
    serde_json::from_str(entry.diff.as_ref().unwrap()).unwrap()
}

pub(super) fn input(
    first_name: &str,
    last_name: &str,
    national_id: &str,
    phone: &str,
) -> ClientInput {
    ClientInput {
        first_name: first_name.to_string(),
        last_name: last_name.to_string(),
        national_id: national_id.to_string(),
        phone: phone.to_string(),
    }
}

pub(super) fn maria() -> ClientInput {
    input("María", "González", "V-12345678", "0414-1234567")
}

pub(super) fn update_of(id: i64, client: &ClientInput) -> ClientUpdate {
    ClientUpdate {
        id,
        first_name: client.first_name.clone(),
        last_name: client.last_name.clone(),
        national_id: client.national_id.clone(),
        phone: client.phone.clone(),
    }
}

pub(super) fn try_create(
    fixture: &Fixture,
    client: &ClientInput,
) -> Result<ClientSummary, ClientError> {
    run(fixture, |conn| create_client(conn, fixture.actor, client))
}

pub(super) fn create(fixture: &Fixture, client: &ClientInput) -> ClientSummary {
    try_create(fixture, client).unwrap()
}

pub(super) fn try_update(
    fixture: &Fixture,
    id: i64,
    client: &ClientInput,
) -> Result<ClientSummary, ClientError> {
    run(fixture, |conn| {
        update_client(conn, fixture.actor, &update_of(id, client))
    })
}

pub(super) fn try_set_deleted(
    fixture: &Fixture,
    id: i64,
    deleted: bool,
) -> Result<ClientSummary, ClientError> {
    run(fixture, |conn| {
        set_client_deleted(conn, fixture.actor, &ClientDeletion { id, deleted })
    })
}

fn invalid_field(outcome: Result<ClientSummary, ClientError>) -> &'static str {
    match outcome {
        Err(ClientError::Validation { field }) => field,
        other => panic!("expected a validation error, got {other:?}"),
    }
}

#[test]
fn create_stores_and_returns_the_client_as_active() {
    let fixture = fixture();

    let created = create(&fixture, &maria());

    assert_eq!(created.first_name, "María");
    assert_eq!(created.last_name, "González");
    assert_eq!(created.national_id, "V-12345678");
    assert_eq!(created.phone, "0414-1234567");
    assert_eq!(created.deleted_at, None);
    assert_eq!(stored(&fixture, created.id), created);
}

#[test]
fn create_trims_names_and_canonicalizes_the_national_id() {
    let fixture = fixture();

    let created = create(
        &fixture,
        &input("  Ana  ", "\tPérez ", "v 16.789.012", "  0412-3456789 "),
    );

    assert_eq!(created.first_name, "Ana");
    assert_eq!(created.last_name, "Pérez");
    assert_eq!(created.national_id, "V-16789012");
    assert_eq!(created.phone, "0412-3456789");
}

#[test]
fn create_accepts_names_of_exactly_eighty_characters() {
    let fixture = fixture();
    let eighty = "á".repeat(80);

    let created = create(
        &fixture,
        &input(&eighty, &eighty, "V-12345678", "0414-1234567"),
    );

    assert_eq!(created.first_name.chars().count(), 80);
}

#[test]
fn create_rejects_each_invalid_field_with_its_camel_case_name() {
    let fixture = fixture();
    let eighty_one = "a".repeat(81);
    let cases = [
        ("firstName", input("", "G", "V-12345678", "0414-1234567")),
        ("firstName", input("   ", "G", "V-12345678", "0414-1234567")),
        (
            "firstName",
            input(&eighty_one, "G", "V-12345678", "0414-1234567"),
        ),
        (
            "firstName",
            input("An\u{0}a", "G", "V-12345678", "0414-1234567"),
        ),
        ("lastName", input("A", "", "V-12345678", "0414-1234567")),
        (
            "lastName",
            input("A", &eighty_one, "V-12345678", "0414-1234567"),
        ),
        ("nationalId", input("A", "G", "", "0414-1234567")),
        ("nationalId", input("A", "G", "12345678", "0414-1234567")),
        ("nationalId", input("A", "G", "X-12345678", "0414-1234567")),
        ("nationalId", input("A", "G", "V-12345", "0414-1234567")),
        (
            "nationalId",
            input("A", "G", "V-1234567890", "0414-1234567"),
        ),
        ("phone", input("A", "G", "V-12345678", "")),
        ("phone", input("A", "G", "V-12345678", "123456")),
        ("phone", input("A", "G", "V-12345678", "1234567890123456")),
        ("phone", input("A", "G", "V-12345678", "0414-ABCDEFG")),
        ("phone", input("A", "G", "V-12345678", "0414\n1234567")),
        ("phone", input("A", "G", "V-12345678", &"1".repeat(33))),
        (
            "nationalId",
            input("A", "G", "V--12-34-56-78", "0414-1234567"),
        ),
    ];

    for (field, client) in cases {
        assert_eq!(
            invalid_field(try_create(&fixture, &client)),
            field,
            "{client:?}"
        );
    }
    assert!(everyone(&fixture).is_empty());
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn create_reports_the_first_invalid_field_in_form_order() {
    let fixture = fixture();

    let outcome = try_create(&fixture, &input("", "", "", ""));

    assert_eq!(invalid_field(outcome), "firstName");
}

#[test]
fn create_keeps_special_characters_and_emoji_in_names_intact() {
    let fixture = fixture();

    let created = create(
        &fixture,
        &input("O'Brien 🌸", "Ñúñez-Peña", "V-12345678", "0414-1234567"),
    );

    assert_eq!(created.first_name, "O'Brien 🌸");
    assert_eq!(created.last_name, "Ñúñez-Peña");
}

#[test]
fn create_is_safe_against_sql_metacharacters_in_names() {
    let fixture = fixture();

    let created = create(
        &fixture,
        &input(
            "Robert'); DROP TABLE clients;--",
            "X",
            "V-12345678",
            "0414-1234567",
        ),
    );

    assert_eq!(created.first_name, "Robert'); DROP TABLE clients;--");
    assert_eq!(everyone(&fixture).len(), 1);
}

#[test]
fn create_with_the_national_id_of_an_active_client_is_rejected_even_when_spelled_differently() {
    let fixture = fixture();
    create(&fixture, &maria());

    for spelling in ["V-12345678", "v12345678", "V 12.345.678"] {
        let outcome = try_create(
            &fixture,
            &input("Otra", "Persona", spelling, "0414-7654321"),
        );

        assert!(
            matches!(outcome, Err(ClientError::NationalIdTaken)),
            "{spelling}: {outcome:?}"
        );
    }
    assert_eq!(everyone(&fixture).len(), 1);
}

#[test]
fn create_with_the_national_id_of_a_deleted_client_points_at_it_for_reactivation() {
    let fixture = fixture();
    let existing = create(&fixture, &maria());
    try_set_deleted(&fixture, existing.id, true).unwrap();

    let outcome = try_create(
        &fixture,
        &input("Otra", "Persona", "v12345678", "0414-7654321"),
    );

    assert!(matches!(
        outcome,
        Err(ClientError::DeletedHolder { client_id }) if client_id == existing.id
    ));
    assert_eq!(everyone(&fixture).len(), 1);
}

#[test]
fn after_reactivation_the_national_id_is_taken_instead_of_reactivatable() {
    let fixture = fixture();
    let existing = create(&fixture, &maria());
    try_set_deleted(&fixture, existing.id, true).unwrap();
    try_set_deleted(&fixture, existing.id, false).unwrap();

    let outcome = try_create(&fixture, &maria());

    assert!(matches!(outcome, Err(ClientError::NationalIdTaken)));
}

#[test]
fn update_rewrites_the_fields_and_keeps_the_client_active() {
    let fixture = fixture();
    let created = create(&fixture, &maria());

    let updated = try_update(
        &fixture,
        created.id,
        &input("Sofía", "Ramírez", "e 81.234.567", "0424-7890123"),
    )
    .unwrap();

    assert_eq!(updated.id, created.id);
    assert_eq!(updated.first_name, "Sofía");
    assert_eq!(updated.national_id, "E-81234567");
    assert_eq!(updated.deleted_at, None);
    assert_eq!(stored(&fixture, created.id), updated);
}

#[test]
fn update_of_a_deleted_client_keeps_it_deleted() {
    let fixture = fixture();
    let created = create(&fixture, &maria());
    let deleted = try_set_deleted(&fixture, created.id, true).unwrap();

    let updated = try_update(
        &fixture,
        created.id,
        &input("María José", "González", "V-12345678", "0414-1234567"),
    )
    .unwrap();

    assert_eq!(updated.first_name, "María José");
    assert_eq!(updated.deleted_at, deleted.deleted_at);
}

#[test]
fn update_validates_every_field_like_create() {
    let fixture = fixture();
    let created = create(&fixture, &maria());

    let outcome = try_update(
        &fixture,
        created.id,
        &input("A", "G", "bad", "0414-1234567"),
    );

    assert_eq!(invalid_field(outcome), "nationalId");
    assert_eq!(stored(&fixture, created.id), created);
}

#[test]
fn update_to_the_national_id_of_another_client_is_taken_whether_active_or_deleted() {
    let fixture = fixture();
    let first = create(&fixture, &maria());
    let second = create(
        &fixture,
        &input("Ana", "Pérez", "V-16789012", "0412-3456789"),
    );
    let third = create(
        &fixture,
        &input("Luis", "Martínez", "V-18901234", "0416-4567890"),
    );
    try_set_deleted(&fixture, third.id, true).unwrap();

    let onto_active = try_update(
        &fixture,
        second.id,
        &input("Ana", "Pérez", "v12345678", "0412-3456789"),
    );
    let onto_deleted = try_update(
        &fixture,
        first.id,
        &input("María", "González", "V-18901234", "0414-1234567"),
    );

    assert!(matches!(onto_active, Err(ClientError::NationalIdTaken)));
    assert!(matches!(onto_deleted, Err(ClientError::NationalIdTaken)));
    assert_eq!(stored(&fixture, second.id), second);
    assert_eq!(stored(&fixture, first.id), first);
}

#[test]
fn update_may_keep_the_own_national_id_in_another_spelling() {
    let fixture = fixture();
    let created = create(&fixture, &maria());

    let updated = try_update(
        &fixture,
        created.id,
        &input("María", "González", "v 12.345.678", "0414-7654321"),
    )
    .unwrap();

    assert_eq!(updated.national_id, "V-12345678");
    assert_eq!(updated.phone, "0414-7654321");
}

#[test]
fn update_and_deletion_of_an_unknown_client_are_not_found() {
    let fixture = fixture();

    assert!(matches!(
        try_update(&fixture, 99, &maria()),
        Err(ClientError::NotFound)
    ));
    assert!(matches!(
        try_set_deleted(&fixture, 99, true),
        Err(ClientError::NotFound)
    ));
    assert!(matches!(
        run(&fixture, |conn| get_client(conn, 99)),
        Err(ClientError::NotFound)
    ));
}

#[test]
fn get_returns_active_and_deleted_clients() {
    let fixture = fixture();
    let created = create(&fixture, &maria());
    let deleted = try_set_deleted(&fixture, created.id, true).unwrap();

    let found = run(&fixture, |conn| get_client(conn, created.id)).unwrap();

    assert_eq!(found, deleted);
}

#[test]
fn deletion_marks_the_client_and_reactivation_clears_the_mark() {
    let fixture = fixture();
    let created = create(&fixture, &maria());

    let deleted = try_set_deleted(&fixture, created.id, true).unwrap();
    let reactivated = try_set_deleted(&fixture, created.id, false).unwrap();

    assert!(deleted.deleted_at.is_some());
    assert_eq!(reactivated.deleted_at, None);
    assert_eq!(stored(&fixture, created.id), reactivated);
}

#[test]
fn repeating_a_deletion_or_a_reactivation_returns_the_current_state() {
    let fixture = fixture();
    let created = create(&fixture, &maria());
    assert_eq!(
        try_set_deleted(&fixture, created.id, false).unwrap(),
        created
    );
    let deleted = try_set_deleted(&fixture, created.id, true).unwrap();

    let again = try_set_deleted(&fixture, created.id, true).unwrap();

    assert_eq!(again, deleted);
}
