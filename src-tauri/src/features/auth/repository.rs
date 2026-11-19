use rusqlite::{Connection, OptionalExtension};

use super::model::PermissionKey;
use crate::db::DbError;

pub struct UserCredentialRow {
    pub id: i64,
    pub username: String,
    pub password_hash: String,
    pub role_name: String,
    pub is_active: bool,
}

#[cfg(debug_assertions)]
pub struct NewUser {
    pub username: String,
    pub password_hash: String,
    pub role_id: i64,
}

const FIND_CREDENTIALS_SQL: &str = "SELECT u.id, u.username, u.password_hash, r.name, u.active \
     FROM users u JOIN roles r ON r.id = u.role_id \
     WHERE u.username = ?1 COLLATE NOCASE";

pub struct ActiveUserRow {
    pub id: i64,
    pub username: String,
    pub role_name: String,
}

const FIND_ACTIVE_USER_SQL: &str = "SELECT u.id, u.username, r.name \
     FROM users u JOIN roles r ON r.id = u.role_id \
     WHERE u.id = ?1 AND u.active = 1";

const PERMISSIONS_OF_USER_SQL: &str = "SELECT rp.permission_key \
     FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id \
     WHERE u.id = ?1";

pub fn find_credentials_by_username(
    conn: &Connection,
    username: &str,
) -> Result<Option<UserCredentialRow>, DbError> {
    let row = conn
        .query_row(FIND_CREDENTIALS_SQL, [username], |row| {
            Ok(UserCredentialRow {
                id: row.get(0)?,
                username: row.get(1)?,
                password_hash: row.get(2)?,
                role_name: row.get(3)?,
                is_active: row.get(4)?,
            })
        })
        .optional()?;
    Ok(row)
}

pub fn find_active_user_by_id(
    conn: &Connection,
    user_id: i64,
) -> Result<Option<ActiveUserRow>, DbError> {
    let row = conn
        .query_row(FIND_ACTIVE_USER_SQL, [user_id], |row| {
            Ok(ActiveUserRow {
                id: row.get(0)?,
                username: row.get(1)?,
                role_name: row.get(2)?,
            })
        })
        .optional()?;
    Ok(row)
}

pub fn permissions_of_role_for_user(
    conn: &Connection,
    user_id: i64,
) -> Result<Vec<PermissionKey>, DbError> {
    let mut statement = conn.prepare(PERMISSIONS_OF_USER_SQL)?;
    let stored: Vec<String> = statement
        .query_map([user_id], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    let mut permissions = stored
        .iter()
        .map(|key| PermissionKey::parse(key).ok_or(DbError::UnknownPermission))
        .collect::<Result<Vec<_>, _>>()?;
    permissions.sort_by_key(|permission| position_in_all(*permission));
    Ok(permissions)
}

fn position_in_all(permission: PermissionKey) -> usize {
    PermissionKey::ALL
        .iter()
        .position(|candidate| *candidate == permission)
        .unwrap_or(usize::MAX)
}

pub fn count_users(conn: &Connection) -> Result<i64, DbError> {
    let total = conn.query_row("SELECT count(*) FROM users", [], |row| row.get(0))?;
    Ok(total)
}

#[cfg(debug_assertions)]
pub fn insert_user(conn: &Connection, user: &NewUser) -> Result<i64, DbError> {
    conn.execute(
        "INSERT INTO users (username, password_hash, role_id) VALUES (?1, ?2, ?3)",
        rusqlite::params![user.username, user.password_hash, user.role_id],
    )?;
    Ok(conn.last_insert_rowid())
}

#[cfg(test)]
#[path = "repository_test.rs"]
mod tests;
