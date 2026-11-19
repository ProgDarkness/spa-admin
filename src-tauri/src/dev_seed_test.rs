use super::*;
use crate::db::migrate;
use crate::features::auth::model::LoginCredentials;
use crate::features::auth::repository::count_users;
use crate::features::auth::service::login;
use rusqlite::Connection;

const SEED_PASSWORD: &str = "clave-de-desarrollo-1";

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn env_with_password(name: &str) -> Option<String> {
    (name == SEED_PASSWORD_VAR).then(|| SEED_PASSWORD.to_string())
}

fn env_empty_password(name: &str) -> Option<String> {
    (name == SEED_PASSWORD_VAR).then(String::new)
}

fn env_without_variables(_: &str) -> Option<String> {
    None
}

fn credentials(username: &str) -> LoginCredentials {
    LoginCredentials {
        username: username.to_string(),
        password: SEED_PASSWORD.to_string(),
    }
}

#[test]
fn seeds_three_users_when_empty_and_env_set() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();

    seed_if_empty(&conn, &policy, &env_with_password).unwrap();

    assert_eq!(count_users(&conn).unwrap(), 3);
    let roles: Vec<String> = ["propietaria", "recepcion", "lectura"]
        .iter()
        .map(|name| login(&conn, &policy, &credentials(name)).unwrap().role_name)
        .collect();
    assert_eq!(roles, ["Propietaria", "Recepción", "Solo lectura"]);
}

#[test]
fn does_nothing_without_env() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    seed_if_empty(&conn, &policy, &env_without_variables).unwrap();
    assert_eq!(count_users(&conn).unwrap(), 0);
}

#[test]
fn does_nothing_with_empty_password_env() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    seed_if_empty(&conn, &policy, &env_empty_password).unwrap();
    assert_eq!(count_users(&conn).unwrap(), 0);
}

#[test]
fn does_nothing_when_users_exist() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    seed_if_empty(&conn, &policy, &env_with_password).unwrap();
    conn.execute("DELETE FROM users WHERE username <> 'lectura'", [])
        .unwrap();

    seed_if_empty(&conn, &policy, &env_with_password).unwrap();

    assert_eq!(count_users(&conn).unwrap(), 1);
}

#[test]
fn seeded_users_can_login() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    seed_if_empty(&conn, &policy, &env_with_password).unwrap();

    let user = login(&conn, &policy, &credentials("propietaria")).unwrap();

    assert_eq!(user.permissions.len(), 15);
}

#[test]
fn rejects_passwords_shorter_than_twelve_characters_without_seeding() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let env_short = |name: &str| (name == SEED_PASSWORD_VAR).then(|| "a".repeat(11));

    let result = seed_if_empty(&conn, &policy, &env_short);

    assert!(matches!(result, Err(SetupError::SeedPasswordTooShort)));
    assert_eq!(count_users(&conn).unwrap(), 0);
}

#[test]
fn accepts_a_password_of_exactly_twelve_characters() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let env_exact = |name: &str| (name == SEED_PASSWORD_VAR).then(|| "ñ".repeat(12));

    seed_if_empty(&conn, &policy, &env_exact).unwrap();

    assert_eq!(count_users(&conn).unwrap(), 3);
}
