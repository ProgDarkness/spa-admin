use super::*;
use crate::db::{migrate, DbError};
use crate::dev_seed::{seed_if_empty, SEED_PASSWORD_VAR};
use crate::features::audit::{AuditAction, AuditEntity};
use crate::features::auth::password::PasswordPolicy;
use crate::features::auth::service::AuthError;
use crate::features::clients::normalization::{normalize_national_id, valid_phone};
use rusqlite::Connection;

type StoredClient = (i64, String, String, String, String, bool);

const EXPECTED_CLIENTS: [(i64, &str, &str, &str, &str, bool); 9] = [
    (1, "María", "González", "V-12345678", "0414-1234567", false),
    (2, "José", "Rodríguez", "V-14567890", "0424-2345678", false),
    (3, "Ana", "Pérez", "V-16789012", "0412-3456789", false),
    (4, "Luis", "Martínez", "V-18901234", "0416-4567890", false),
    (5, "Carla", "Hernández", "V-20123456", "0426-5678901", false),
    (6, "Pedro", "Díaz", "V-22345678", "0414-6789012", false),
    (7, "Gabriela", "Torres", "E-81234567", "0424-7890123", false),
    (8, "Sofía", "Ramírez", "V-24567890", "0412-8901234", false),
    (9, "Carlos", "Mendoza", "V-26789012", "0416-9012345", true),
];

fn env_with_password(name: &str) -> Option<String> {
    (name == SEED_PASSWORD_VAR).then(|| "clave-de-desarrollo-1".to_string())
}

fn env_empty_password(name: &str) -> Option<String> {
    (name == SEED_PASSWORD_VAR).then(String::new)
}

fn env_without_variables(_: &str) -> Option<String> {
    None
}

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn with_users() -> Connection {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    seed_if_empty(&conn, &policy, &env_with_password).unwrap();
    conn
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap()
}

fn stored_clients(conn: &Connection) -> Vec<StoredClient> {
    let mut statement = conn
        .prepare(
            "SELECT id, first_name, last_name, national_id, phone, deleted_at IS NOT NULL \
             FROM clients ORDER BY id",
        )
        .unwrap();
    statement
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn owner_id(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT id FROM users WHERE username = 'propietaria'",
        [],
        |row| row.get(0),
    )
    .unwrap()
}

fn audited(conn: &Connection, action: AuditAction, actor: i64) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM audit_log WHERE action = ?1 AND entity = ?2 AND actor_user_id = ?3",
        rusqlite::params![action.as_str(), AuditEntity::Client.as_str(), actor],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn seeds_the_nine_mock_clients_with_ids_one_to_nine_and_the_last_one_deleted() {
    let conn = with_users();

    seed_clients_if_empty(&conn, &env_with_password).unwrap();

    let expected: Vec<StoredClient> = EXPECTED_CLIENTS
        .iter()
        .map(|(id, first, last, national_id, phone, deleted)| {
            (
                *id,
                first.to_string(),
                last.to_string(),
                national_id.to_string(),
                phone.to_string(),
                *deleted,
            )
        })
        .collect();
    assert_eq!(stored_clients(&conn), expected);
}

#[test]
fn every_seeded_national_id_and_phone_is_already_canonical() {
    for (_, _, _, national_id, phone, _) in EXPECTED_CLIENTS {
        assert_eq!(
            normalize_national_id(national_id).as_deref(),
            Some(national_id)
        );
        assert_eq!(valid_phone(phone).as_deref(), Some(phone));
    }
}

#[test]
fn seeded_clients_are_searchable_by_accent_free_text() {
    let conn = with_users();
    seed_clients_if_empty(&conn, &env_with_password).unwrap();

    let found: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM clients WHERE search_key LIKE '%sofia ramirez%'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(found, 1);
}

#[test]
fn seeded_rows_are_attributed_to_the_owner_and_audited() {
    let conn = with_users();
    seed_clients_if_empty(&conn, &env_with_password).unwrap();
    let owner = owner_id(&conn);

    let attributed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM clients WHERE created_by = ?1 AND updated_by = ?1",
            [owner],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(attributed, 9);
    assert_eq!(audited(&conn, AuditAction::Create, owner), 9);
    assert_eq!(audited(&conn, AuditAction::SoftDelete, owner), 1);
}

#[test]
fn second_run_changes_nothing() {
    let conn = with_users();
    seed_clients_if_empty(&conn, &env_with_password).unwrap();
    let clients = stored_clients(&conn);
    let audit_rows = count(&conn, "audit_log");

    seed_clients_if_empty(&conn, &env_with_password).unwrap();

    assert_eq!(stored_clients(&conn), clients);
    assert_eq!(count(&conn, "audit_log"), audit_rows);
}

#[test]
fn seeds_nothing_when_a_single_client_exists_even_if_deleted() {
    let conn = with_users();
    conn.execute(
        "INSERT INTO clients (first_name, last_name, national_id, phone, search_key, deleted_at) \
         VALUES ('Propio', 'Cliente', 'V-99999999', '04141234567', 'k', '2026-11-12T10:00')",
        [],
    )
    .unwrap();

    seed_clients_if_empty(&conn, &env_with_password).unwrap();

    assert_eq!(count(&conn, "clients"), 1);
    assert_eq!(count(&conn, "audit_log"), 0);
}

#[test]
fn does_nothing_without_the_seed_variable_or_with_an_empty_one() {
    let conn = with_users();

    seed_clients_if_empty(&conn, &env_without_variables).unwrap();
    seed_clients_if_empty(&conn, &env_empty_password).unwrap();

    assert_eq!(count(&conn, "clients"), 0);
}

#[test]
fn does_nothing_when_there_is_no_seeded_owner_to_act() {
    let conn = migrated();

    seed_clients_if_empty(&conn, &env_with_password).unwrap();

    assert_eq!(count(&conn, "clients"), 0);
    assert_eq!(count(&conn, "audit_log"), 0);
}

#[test]
fn client_errors_map_to_setup_errors() {
    let db = SetupError::from(ClientError::Db(DbError::NotADatabase));
    let auth = SetupError::from(ClientError::Auth(AuthError::SetupClosed));
    let validation = SetupError::from(ClientError::Validation { field: "phone" });
    let not_found = SetupError::from(ClientError::NotFound);
    let taken = SetupError::from(ClientError::NationalIdTaken);
    let deleted = SetupError::from(ClientError::DeletedHolder { client_id: 1 });

    assert!(matches!(db, SetupError::Db(_)));
    assert!(matches!(auth, SetupError::Auth(_)));
    for rejected in [validation, not_found, taken, deleted] {
        assert!(matches!(rejected, SetupError::SeedCatalogRejected));
    }
}

#[test]
fn a_failure_while_seeding_rolls_back_every_client_and_audit_row() {
    let conn = with_users();
    conn.execute_batch(
        "CREATE TRIGGER block_deletion BEFORE UPDATE OF deleted_at ON clients \
         BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
    )
    .unwrap();

    let result = seed_clients_if_empty(&conn, &env_with_password);

    assert!(matches!(result, Err(SetupError::Db(_))));
    assert_eq!(count(&conn, "clients"), 0);
    assert_eq!(count(&conn, "audit_log"), 0);
}
