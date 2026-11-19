use rusqlite::Connection;

use super::*;
use crate::db::migrate;

const OWNER_ROLE: i64 = 1;
const RECEPTION_ROLE: i64 = 2;
const READ_ONLY_ROLE: i64 = 3;

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn new_row(username: &str, role_id: i64) -> NewUserRow {
    NewUserRow {
        username: username.to_string(),
        password_hash: "hash-opaco".to_string(),
        role_id,
    }
}

fn seed(conn: &Connection, username: &str, role_id: i64) -> i64 {
    insert_user(conn, &new_row(username, role_id), None).unwrap()
}

#[test]
fn count_active_admins_counts_only_active_users_whose_role_manages_users() {
    let conn = migrated();
    assert_eq!(count_active_admins(&conn).unwrap(), 0);
    let owner = seed(&conn, "duena", OWNER_ROLE);
    seed(&conn, "recepcion", RECEPTION_ROLE);
    assert_eq!(count_active_admins(&conn).unwrap(), 1);

    let second = seed(&conn, "segunda", OWNER_ROLE);
    assert_eq!(count_active_admins(&conn).unwrap(), 2);

    conn.execute("UPDATE users SET active = 0 WHERE id = ?1", [second])
        .unwrap();
    assert_eq!(count_active_admins(&conn).unwrap(), 1);

    conn.execute(
        "DELETE FROM role_permissions WHERE role_id = 1 AND permission_key = 'users.manage'",
        [],
    )
    .unwrap();
    assert_eq!(count_active_admins(&conn).unwrap(), 0);
    assert!(find_user(&conn, owner).unwrap().is_some());
}

#[test]
fn username_taken_is_nocase_and_can_exclude_one_user() {
    let conn = migrated();
    let id = seed(&conn, "Recepcion", RECEPTION_ROLE);

    assert!(username_taken(&conn, "recepcion", None).unwrap());
    assert!(username_taken(&conn, "RECEPCION", None).unwrap());
    assert!(!username_taken(&conn, "recepcion", Some(id)).unwrap());
    assert!(!username_taken(&conn, "otra", None).unwrap());
}

#[test]
fn insert_user_records_creator_and_returns_summary_with_role_name() {
    let conn = migrated();
    let actor = seed(&conn, "duena", OWNER_ROLE);

    let id = insert_user(&conn, &new_row("ana", READ_ONLY_ROLE), Some(actor)).unwrap();
    let summary = find_user(&conn, id).unwrap().unwrap();
    let created_by: i64 = conn
        .query_row("SELECT created_by FROM users WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .unwrap();

    assert_eq!(summary.username, "ana");
    assert_eq!(summary.role_name, "Solo lectura");
    assert!(summary.active);
    assert_eq!(summary.created_at.len(), 16);
    assert_eq!(created_by, actor);
}

#[test]
fn apply_user_update_changes_only_given_fields_and_stamps_updater() {
    let conn = migrated();
    let actor = seed(&conn, "duena", OWNER_ROLE);
    let id = seed(&conn, "ana", RECEPTION_ROLE);
    let update = UserUpdate {
        id,
        username: None,
        role_id: Some(READ_ONLY_ROLE),
        active: Some(false),
    };

    apply_user_update(&conn, &update, actor).unwrap();

    let summary = find_user(&conn, id).unwrap().unwrap();
    let updated_by: i64 = conn
        .query_row("SELECT updated_by FROM users WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(summary.username, "ana");
    assert_eq!(summary.role_id, READ_ONLY_ROLE);
    assert!(!summary.active);
    assert_eq!(updated_by, actor);
}

#[test]
fn set_password_hash_replaces_only_the_hash() {
    let conn = migrated();
    let actor = seed(&conn, "duena", OWNER_ROLE);
    let id = seed(&conn, "ana", RECEPTION_ROLE);

    set_password_hash(&conn, id, "hash-nuevo", actor).unwrap();

    let stored: String = conn
        .query_row("SELECT password_hash FROM users WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(stored, "hash-nuevo");
}

#[test]
fn list_users_is_ordered_by_id_and_find_user_misses_unknown_ids() {
    let conn = migrated();
    seed(&conn, "b", RECEPTION_ROLE);
    seed(&conn, "a", RECEPTION_ROLE);

    let names: Vec<String> = list_users(&conn)
        .unwrap()
        .into_iter()
        .map(|user| user.username)
        .collect();

    assert_eq!(names, vec!["b", "a"]);
    assert_eq!(find_user(&conn, 999).unwrap(), None);
}

#[test]
fn list_roles_returns_permissions_in_catalog_order_and_user_counts() {
    let conn = migrated();
    seed(&conn, "a", RECEPTION_ROLE);
    seed(&conn, "b", RECEPTION_ROLE);
    seed(&conn, "c", OWNER_ROLE);

    let roles = list_roles(&conn).unwrap();

    assert_eq!(roles.len(), 3);
    assert_eq!(roles[0].name, "Propietaria");
    assert_eq!(roles[0].user_count, 1);
    assert_eq!(roles[0].permissions, PermissionKey::ALL.to_vec());
    assert_eq!(roles[1].user_count, 2);
    assert_eq!(roles[2].user_count, 0);
    assert!(roles[1].permissions.contains(&PermissionKey::RatesManage));
}

#[test]
fn insert_role_and_replace_permissions_roundtrip() {
    let conn = migrated();
    assert!(!role_name_taken(&conn, "Caja").unwrap());

    let id = insert_role(&conn, "Caja").unwrap();
    replace_role_permissions(
        &conn,
        id,
        &[PermissionKey::PaymentsRead, PermissionKey::ClientsRead],
    )
    .unwrap();
    replace_role_permissions(&conn, id, &[PermissionKey::PaymentsRead]).unwrap();

    let role = find_role(&conn, id).unwrap().unwrap();
    assert_eq!(role.permissions, vec![PermissionKey::PaymentsRead]);
    assert!(role_name_taken(&conn, "caja").unwrap());
    assert!(role_exists(&conn, id).unwrap());
    assert!(!role_exists(&conn, 999).unwrap());
    assert_eq!(find_role(&conn, 999).unwrap(), None);
}

#[test]
fn username_taken_folds_unicode_case_and_normalization() {
    let conn = migrated();
    let id = seed(&conn, "\u{00F3}scar", RECEPTION_ROLE);

    assert!(username_taken(&conn, "\u{00D3}SCAR", None).unwrap());
    assert!(username_taken(&conn, "o\u{0301}scar", None).unwrap());
    assert!(username_taken(&conn, "O\u{0301}SCAR", None).unwrap());
    assert!(!username_taken(&conn, "\u{00D3}SCAR", Some(id)).unwrap());
    assert!(!username_taken(&conn, "oscar", None).unwrap());
}
