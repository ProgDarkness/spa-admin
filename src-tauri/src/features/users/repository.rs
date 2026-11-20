use rusqlite::{params, Connection, OptionalExtension, Row};

use super::model::{RoleSummary, UserSummary, UserUpdate};
use crate::db::DbError;
use crate::features::auth::model::PermissionKey;
use crate::features::auth::username::unicode_casefold;

pub struct NewUserRow {
    pub username: String,
    pub password_hash: String,
    pub role_id: i64,
}

const USER_SUMMARY_SQL: &str = "SELECT u.id, u.username, u.role_id, r.name, u.active, \
     u.created_at, u.updated_at \
     FROM users u JOIN roles r ON r.id = u.role_id";

const LOCAL_MINUTE: &str = "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')";

const COUNT_ACTIVE_ADMINS_SQL: &str = "SELECT count(*) FROM users u \
     WHERE u.active = 1 AND EXISTS (\
        SELECT 1 FROM role_permissions rp \
        WHERE rp.role_id = u.role_id AND rp.permission_key = 'users.manage')";

fn user_summary(row: &Row<'_>) -> rusqlite::Result<UserSummary> {
    Ok(UserSummary {
        id: row.get(0)?,
        username: row.get(1)?,
        role_id: row.get(2)?,
        role_name: row.get(3)?,
        active: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

pub fn list_users(conn: &Connection) -> Result<Vec<UserSummary>, DbError> {
    let mut statement = conn.prepare(&format!("{USER_SUMMARY_SQL} ORDER BY u.id"))?;
    let users = statement
        .query_map([], user_summary)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(users)
}

pub fn find_user(conn: &Connection, user_id: i64) -> Result<Option<UserSummary>, DbError> {
    let user = conn
        .query_row(
            &format!("{USER_SUMMARY_SQL} WHERE u.id = ?1"),
            [user_id],
            user_summary,
        )
        .optional()?;
    Ok(user)
}

pub fn username_taken(
    conn: &Connection,
    username: &str,
    except_user_id: Option<i64>,
) -> Result<bool, DbError> {
    let taken_ascii_insensitive = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM users \
         WHERE username = ?1 COLLATE NOCASE AND id IS NOT ?2)",
        params![username, except_user_id],
        |row| row.get(0),
    )?;
    Ok(taken_ascii_insensitive || folded_username_taken(conn, username, except_user_id)?)
}

fn folded_username_taken(
    conn: &Connection,
    username: &str,
    except_user_id: Option<i64>,
) -> Result<bool, DbError> {
    let wanted = unicode_casefold(username);
    let mut statement = conn.prepare("SELECT username FROM users WHERE id IS NOT ?1")?;
    let names = statement.query_map([except_user_id], |row| row.get::<_, String>(0))?;
    for name in names {
        if unicode_casefold(&name?) == wanted {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn role_exists(conn: &Connection, role_id: i64) -> Result<bool, DbError> {
    let exists = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM roles WHERE id = ?1)",
        [role_id],
        |row| row.get(0),
    )?;
    Ok(exists)
}

pub fn insert_user(
    conn: &Connection,
    user: &NewUserRow,
    actor_id: Option<i64>,
) -> Result<i64, DbError> {
    conn.execute(
        "INSERT INTO users (username, password_hash, role_id, created_by, updated_by) \
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![user.username, user.password_hash, user.role_id, actor_id],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn apply_user_update(
    conn: &Connection,
    update: &UserUpdate,
    actor_id: i64,
) -> Result<(), DbError> {
    conn.execute(
        &format!(
            "UPDATE users SET username = COALESCE(?2, username), \
             role_id = COALESCE(?3, role_id), active = COALESCE(?4, active), \
             updated_at = {LOCAL_MINUTE}, updated_by = ?5 WHERE id = ?1"
        ),
        params![
            update.id,
            update.username,
            update.role_id,
            update.active,
            actor_id
        ],
    )?;
    Ok(())
}

pub fn set_password_hash(
    conn: &Connection,
    user_id: i64,
    password_hash: &str,
    actor_id: i64,
) -> Result<(), DbError> {
    conn.execute(
        &format!(
            "UPDATE users SET password_hash = ?2, updated_at = {LOCAL_MINUTE}, updated_by = ?3 \
             WHERE id = ?1"
        ),
        params![user_id, password_hash, actor_id],
    )?;
    Ok(())
}

pub fn count_active_admins(conn: &Connection) -> Result<i64, DbError> {
    let total = conn.query_row(COUNT_ACTIVE_ADMINS_SQL, [], |row| row.get(0))?;
    Ok(total)
}

fn permissions_of_role(conn: &Connection, role_id: i64) -> Result<Vec<PermissionKey>, DbError> {
    let mut statement =
        conn.prepare("SELECT permission_key FROM role_permissions WHERE role_id = ?1")?;
    let stored: Vec<String> = statement
        .query_map([role_id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let granted = stored
        .iter()
        .map(|key| PermissionKey::parse(key).ok_or(DbError::UnknownPermission))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(PermissionKey::ALL
        .into_iter()
        .filter(|key| granted.contains(key))
        .collect())
}

fn role_summary(conn: &Connection, row: &Row<'_>) -> Result<RoleSummary, DbError> {
    let id: i64 = row.get(0)?;
    Ok(RoleSummary {
        id,
        name: row.get(1)?,
        permissions: permissions_of_role(conn, id)?,
        user_count: row.get(2)?,
    })
}

const ROLE_SUMMARY_SQL: &str = "SELECT r.id, r.name, \
     (SELECT count(*) FROM users u WHERE u.role_id = r.id) FROM roles r";

pub fn list_roles(conn: &Connection) -> Result<Vec<RoleSummary>, DbError> {
    let mut statement = conn.prepare(&format!("{ROLE_SUMMARY_SQL} ORDER BY r.id"))?;
    let mut rows = statement.query([])?;
    let mut roles = Vec::new();
    while let Some(row) = rows.next()? {
        roles.push(role_summary(conn, row)?);
    }
    Ok(roles)
}

pub fn find_role(conn: &Connection, role_id: i64) -> Result<Option<RoleSummary>, DbError> {
    let mut statement = conn.prepare(&format!("{ROLE_SUMMARY_SQL} WHERE r.id = ?1"))?;
    let mut rows = statement.query([role_id])?;
    rows.next()?.map(|row| role_summary(conn, row)).transpose()
}

pub fn role_name_taken(conn: &Connection, name: &str) -> Result<bool, DbError> {
    let wanted = name.to_lowercase();
    let mut statement = conn.prepare("SELECT name FROM roles")?;
    let names: Vec<String> = statement
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(names.iter().any(|stored| stored.to_lowercase() == wanted))
}

pub fn insert_role(conn: &Connection, name: &str) -> Result<i64, DbError> {
    conn.execute("INSERT INTO roles (name) VALUES (?1)", [name])?;
    Ok(conn.last_insert_rowid())
}

pub fn replace_role_permissions(
    conn: &Connection,
    role_id: i64,
    permissions: &[PermissionKey],
) -> Result<(), DbError> {
    conn.execute("DELETE FROM role_permissions WHERE role_id = ?1", [role_id])?;
    for permission in permissions {
        conn.execute(
            "INSERT INTO role_permissions (role_id, permission_key) VALUES (?1, ?2)",
            params![role_id, permission.as_str()],
        )?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "repository_test.rs"]
mod tests;
