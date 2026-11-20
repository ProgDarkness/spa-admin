use rusqlite::{Connection, OptionalExtension};

use super::model::PermissionKey;
use crate::db::{require_valid_instant, DbError};

pub struct UserCredentialRow {
    pub id: i64,
    pub username: String,
    pub password_hash: String,
    pub role_name: String,
    pub is_active: bool,
    pub recovery_code_hash: Option<String>,
    pub is_locked_out: bool,
}

#[cfg(debug_assertions)]
pub struct NewUser {
    pub username: String,
    pub password_hash: String,
    pub role_id: i64,
}

macro_rules! utc_at {
    ($now:literal) => {
        concat!("strftime('%Y-%m-%dT%H:%M:%fZ',", $now, ")")
    };
    ($now:literal, $offset:literal) => {
        concat!("strftime('%Y-%m-%dT%H:%M:%fZ',", $now, ",'", $offset, "')")
    };
}

const FIND_CREDENTIALS_BY_USERNAME_SQL: &str = concat!(
    "SELECT u.id, u.username, u.password_hash, r.name, u.active, u.recovery_code_hash, \
     COALESCE(t.locked_until_utc > ",
    utc_at!("?2"),
    ", 0) \
     FROM users u JOIN roles r ON r.id = u.role_id \
     LEFT JOIN login_throttle t ON t.user_id = u.id \
     WHERE u.username = ?1 COLLATE NOCASE"
);

const FIND_CREDENTIALS_BY_ID_SQL: &str = concat!(
    "SELECT u.id, u.username, u.password_hash, r.name, u.active, u.recovery_code_hash, \
     COALESCE(t.locked_until_utc > ",
    utc_at!("?2"),
    ", 0) \
     FROM users u JOIN roles r ON r.id = u.role_id \
     LEFT JOIN login_throttle t ON t.user_id = u.id \
     WHERE u.id = ?1"
);

const READ_THROTTLE_SQL: &str = concat!(
    "SELECT failures, COALESCE(locked_until_utc > ",
    utc_at!("?2"),
    ", 0), COALESCE(locked_until_utc <= ",
    utc_at!("?2"),
    ", 0) OR last_failure_at_utc <= ",
    utc_at!("?2", "-300 seconds"),
    " FROM login_throttle WHERE user_id = ?1"
);

const WRITE_THROTTLE_SQL: &str = concat!(
    "INSERT INTO login_throttle (user_id, failures, last_failure_at_utc, locked_until_utc) \
     VALUES (?1, ?2, ",
    utc_at!("?3"),
    ", CASE WHEN ?2 >= ?4 THEN ",
    utc_at!("?3", "+300 seconds"),
    " END) ON CONFLICT(user_id) DO UPDATE SET failures = excluded.failures, \
     last_failure_at_utc = excluded.last_failure_at_utc, \
     locked_until_utc = excluded.locked_until_utc"
);
const SQLITE_NOW: &str = "now";
const MAX_PERSISTED_FAILURES: u32 = 5;

pub struct ActiveUserRow {
    pub id: i64,
    pub username: String,
    pub role_name: String,
}

impl From<UserCredentialRow> for ActiveUserRow {
    fn from(row: UserCredentialRow) -> Self {
        Self {
            id: row.id,
            username: row.username,
            role_name: row.role_name,
        }
    }
}

const FIND_ACTIVE_USER_SQL: &str = "SELECT u.id, u.username, r.name \
     FROM users u JOIN roles r ON r.id = u.role_id \
     WHERE u.id = ?1 AND u.active = 1";

const PERMISSIONS_OF_USER_SQL: &str = "SELECT rp.permission_key \
     FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id \
     WHERE u.id = ?1";

fn credential_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<UserCredentialRow> {
    Ok(UserCredentialRow {
        id: row.get(0)?,
        username: row.get(1)?,
        password_hash: row.get(2)?,
        role_name: row.get(3)?,
        is_active: row.get(4)?,
        recovery_code_hash: row.get(5)?,
        is_locked_out: row.get(6)?,
    })
}

pub fn find_credentials_by_username(
    conn: &Connection,
    username: &str,
) -> Result<Option<UserCredentialRow>, DbError> {
    find_credentials_by_username_at(conn, username, SQLITE_NOW)
}

pub(crate) fn find_credentials_by_username_at(
    conn: &Connection,
    username: &str,
    now: &str,
) -> Result<Option<UserCredentialRow>, DbError> {
    require_valid_instant(conn, now)?;
    let row = conn
        .query_row(
            FIND_CREDENTIALS_BY_USERNAME_SQL,
            rusqlite::params![username, now],
            credential_row,
        )
        .optional()?;
    Ok(row)
}

pub fn find_credentials_by_id(
    conn: &Connection,
    user_id: i64,
) -> Result<Option<UserCredentialRow>, DbError> {
    find_credentials_by_id_at(conn, user_id, SQLITE_NOW)
}

pub(crate) fn find_credentials_by_id_at(
    conn: &Connection,
    user_id: i64,
    now: &str,
) -> Result<Option<UserCredentialRow>, DbError> {
    require_valid_instant(conn, now)?;
    let row = conn
        .query_row(
            FIND_CREDENTIALS_BY_ID_SQL,
            rusqlite::params![user_id, now],
            credential_row,
        )
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PersistedFailure {
    pub failures: u32,
    pub locked_now: bool,
}

struct ThrottleState {
    failures: u32,
    lock_active: bool,
    is_stale: bool,
}

fn read_throttle_state(
    conn: &Connection,
    user_id: i64,
    now: &str,
) -> Result<Option<ThrottleState>, DbError> {
    let state = conn
        .query_row(READ_THROTTLE_SQL, rusqlite::params![user_id, now], |row| {
            Ok(ThrottleState {
                failures: row.get(0)?,
                lock_active: row.get(1)?,
                is_stale: row.get(2)?,
            })
        })
        .optional()?;
    Ok(state)
}

fn next_failure_count(state: Option<&ThrottleState>) -> u32 {
    match state {
        Some(state) if !state.is_stale => state.failures + 1,
        _ => 1,
    }
}

pub fn record_persisted_failure(
    conn: &Connection,
    user_id: i64,
) -> Result<PersistedFailure, DbError> {
    record_persisted_failure_at(conn, user_id, SQLITE_NOW)
}

pub(crate) fn record_persisted_failure_at(
    conn: &Connection,
    user_id: i64,
    now: &str,
) -> Result<PersistedFailure, DbError> {
    require_valid_instant(conn, now)?;
    let state = read_throttle_state(conn, user_id, now)?;
    if let Some(state) = state.as_ref().filter(|state| state.lock_active) {
        return Ok(PersistedFailure {
            failures: state.failures,
            locked_now: false,
        });
    }
    let failures = next_failure_count(state.as_ref());
    conn.execute(
        WRITE_THROTTLE_SQL,
        rusqlite::params![user_id, failures, now, MAX_PERSISTED_FAILURES],
    )?;
    Ok(PersistedFailure {
        failures,
        locked_now: failures >= MAX_PERSISTED_FAILURES,
    })
}

pub fn clear_persisted_failures(conn: &Connection, user_id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM login_throttle WHERE user_id = ?1", [user_id])?;
    Ok(())
}

pub fn count_users(conn: &Connection) -> Result<i64, DbError> {
    let total = conn.query_row("SELECT count(*) FROM users", [], |row| row.get(0))?;
    Ok(total)
}

pub struct NewOwner {
    pub username: String,
    pub password_hash: String,
    pub recovery_code_hash: String,
}

pub const OWNER_ROLE_ID: i64 = 1;

pub fn insert_owner(conn: &Connection, owner: &NewOwner) -> Result<i64, DbError> {
    conn.execute(
        "INSERT INTO users (username, password_hash, role_id, recovery_code_hash) \
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![
            owner.username,
            owner.password_hash,
            OWNER_ROLE_ID,
            owner.recovery_code_hash
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn rotate_credentials(
    conn: &Connection,
    user_id: i64,
    expected_recovery_hash: &str,
    password_hash: &str,
    recovery_code_hash: &str,
) -> Result<bool, DbError> {
    let changed = conn.execute(
        "UPDATE users SET password_hash = ?1, recovery_code_hash = ?2 \
         WHERE id = ?3 AND recovery_code_hash = ?4",
        rusqlite::params![
            password_hash,
            recovery_code_hash,
            user_id,
            expected_recovery_hash
        ],
    )?;
    Ok(changed == 1)
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

#[cfg(test)]
#[path = "repository_throttle_test.rs"]
mod throttle_tests;

#[cfg(test)]
#[path = "repository_throttle_dst_test.rs"]
mod throttle_dst_tests;
