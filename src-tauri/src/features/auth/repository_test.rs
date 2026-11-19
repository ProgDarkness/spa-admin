use rusqlite::Connection;

use super::*;
use crate::db::{migrate, DbError};

const OWNER_ROLE_ID: i64 = 1;
const RECEPTION_ROLE_ID: i64 = 2;
const READ_ONLY_ROLE_ID: i64 = 3;

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn new_user(username: &str, role_id: i64) -> NewUser {
    NewUser {
        username: username.to_string(),
        password_hash: format!("hash-de-{username}"),
        role_id,
    }
}

fn deactivate(conn: &Connection, user_id: i64) {
    conn.execute("UPDATE users SET active = 0 WHERE id = ?1", [user_id])
        .unwrap();
}

#[test]
fn find_by_username_joins_role_and_active() {
    let conn = migrated();
    let active_id = insert_user(&conn, &new_user("ana", RECEPTION_ROLE_ID)).unwrap();
    let inactive_id = insert_user(&conn, &new_user("beto", READ_ONLY_ROLE_ID)).unwrap();
    deactivate(&conn, inactive_id);

    let ana = find_credentials_by_username(&conn, "ana").unwrap().unwrap();
    assert_eq!(ana.id, active_id);
    assert_eq!(ana.username, "ana");
    assert_eq!(ana.password_hash, "hash-de-ana");
    assert_eq!(ana.role_name, "Recepción");
    assert!(ana.is_active);

    let beto = find_credentials_by_username(&conn, "beto")
        .unwrap()
        .unwrap();
    assert_eq!(beto.role_name, "Solo lectura");
    assert!(!beto.is_active);
}

#[test]
fn find_unknown_returns_none() {
    let conn = migrated();
    insert_user(&conn, &new_user("ana", OWNER_ROLE_ID)).unwrap();
    assert!(find_credentials_by_username(&conn, "nadie")
        .unwrap()
        .is_none());
}

#[test]
fn find_treats_sql_metacharacters_as_data() {
    let conn = migrated();
    insert_user(&conn, &new_user("ana", OWNER_ROLE_ID)).unwrap();
    assert!(find_credentials_by_username(&conn, "' OR 1=1 --")
        .unwrap()
        .is_none());
    assert!(find_credentials_by_username(&conn, "ana' --")
        .unwrap()
        .is_none());
}

#[test]
fn permissions_follow_role_and_all_order() {
    let conn = migrated();
    let owner = insert_user(&conn, &new_user("dueña", OWNER_ROLE_ID)).unwrap();
    let reader = insert_user(&conn, &new_user("lector", READ_ONLY_ROLE_ID)).unwrap();

    let owner_permissions = permissions_of_role_for_user(&conn, owner).unwrap();
    assert_eq!(owner_permissions, PermissionKey::ALL.to_vec());

    let reader_permissions = permissions_of_role_for_user(&conn, reader).unwrap();
    assert_eq!(
        reader_permissions,
        vec![
            PermissionKey::ClientsRead,
            PermissionKey::CatalogRead,
            PermissionKey::AppointmentsRead,
            PermissionKey::PaymentsRead,
        ]
    );
}

#[test]
fn permissions_of_unknown_user_are_empty() {
    let conn = migrated();
    assert!(permissions_of_role_for_user(&conn, 999).unwrap().is_empty());
}

#[test]
fn unknown_permission_in_db_is_an_error() {
    let conn = migrated();
    let reader = insert_user(&conn, &new_user("lector", READ_ONLY_ROLE_ID)).unwrap();
    conn.execute(
        "INSERT INTO permissions (key) VALUES ('clients.delete')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO role_permissions (role_id, permission_key) VALUES (?1, 'clients.delete')",
        [READ_ONLY_ROLE_ID],
    )
    .unwrap();

    let result = permissions_of_role_for_user(&conn, reader);
    assert!(matches!(result, Err(DbError::UnknownPermission)));
}

#[test]
fn count_users_counts_rows() {
    let conn = migrated();
    assert_eq!(count_users(&conn).unwrap(), 0);
    insert_user(&conn, &new_user("ana", OWNER_ROLE_ID)).unwrap();
    insert_user(&conn, &new_user("beto", RECEPTION_ROLE_ID)).unwrap();
    assert_eq!(count_users(&conn).unwrap(), 2);
}

#[test]
fn insert_user_roundtrip() {
    let conn = migrated();
    let id = insert_user(&conn, &new_user("ana", OWNER_ROLE_ID)).unwrap();
    let row = find_credentials_by_username(&conn, "ana").unwrap().unwrap();
    assert_eq!(row.id, id);
    assert!(row.is_active);
}

#[test]
fn insert_user_rejects_duplicate_username_and_unknown_role() {
    let conn = migrated();
    insert_user(&conn, &new_user("ana", OWNER_ROLE_ID)).unwrap();
    assert!(matches!(
        insert_user(&conn, &new_user("ana", OWNER_ROLE_ID)),
        Err(DbError::Sqlite(_))
    ));
    assert!(matches!(
        insert_user(&conn, &new_user("beto", 99)),
        Err(DbError::Sqlite(_))
    ));
}

#[test]
fn insert_user_rejects_username_differing_only_by_case_with_a_unique_violation() {
    let conn = migrated();
    insert_user(&conn, &new_user("Ana", OWNER_ROLE_ID)).unwrap();
    let error = insert_user(&conn, &new_user("ana", OWNER_ROLE_ID)).unwrap_err();
    let DbError::Sqlite(rusqlite::Error::SqliteFailure(failure, _)) = error else {
        panic!("se esperaba una violación de unicidad");
    };
    assert_eq!(failure.code, rusqlite::ErrorCode::ConstraintViolation);
    assert_eq!(
        failure.extended_code,
        rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
    );
}

#[test]
fn find_by_username_ignores_case() {
    let conn = migrated();
    let id = insert_user(&conn, &new_user("Ana", RECEPTION_ROLE_ID)).unwrap();
    let found = find_credentials_by_username(&conn, "ANA").unwrap().unwrap();
    assert_eq!(found.id, id);
}

#[test]
fn find_active_user_by_id_returns_role_and_skips_inactive() {
    let conn = migrated();
    let active = insert_user(&conn, &new_user("ana", RECEPTION_ROLE_ID)).unwrap();
    let inactive = insert_user(&conn, &new_user("beto", OWNER_ROLE_ID)).unwrap();
    deactivate(&conn, inactive);

    let row = find_active_user_by_id(&conn, active).unwrap().unwrap();
    assert_eq!(
        (row.id, row.username.as_str(), row.role_name.as_str()),
        (active, "ana", "Recepción")
    );
    assert!(find_active_user_by_id(&conn, inactive).unwrap().is_none());
    assert!(find_active_user_by_id(&conn, 999).unwrap().is_none());
}
