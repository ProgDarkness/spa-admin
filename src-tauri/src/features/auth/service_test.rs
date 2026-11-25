use std::time::Duration;

use rusqlite::Connection;

use super::*;
use crate::db::migrate;
use crate::features::auth::model::PermissionKey;
use crate::features::auth::repository::{insert_user, NewUser};

pub(super) const OWNER_ROLE_ID: i64 = 1;
pub(super) const RECEPTION_ROLE_ID: i64 = 2;
pub(super) const READ_ONLY_ROLE_ID: i64 = 3;
pub(super) const PASSWORD: &str = "clave-segura-1";

pub(super) fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

pub(super) fn credentials(username: &str, password: &str) -> LoginCredentials {
    LoginCredentials {
        username: username.to_string(),
        password: password.to_string(),
    }
}

pub(super) fn add_user(
    conn: &Connection,
    policy: &PasswordPolicy,
    username: &str,
    password: &str,
    role_id: i64,
) -> i64 {
    let user = NewUser {
        username: username.to_string(),
        password_hash: policy.hash(password).unwrap(),
        role_id,
    };
    insert_user(conn, &user).unwrap()
}

pub(super) fn is_invalid_credentials<T>(result: &Result<T, AuthError>) -> bool {
    matches!(result, Err(AuthError::InvalidCredentials))
}

pub(super) fn session_user() -> SessionUser {
    SessionUser {
        id: 1,
        username: "ana".to_string(),
        role_name: "Recepción".to_string(),
        permissions: vec![PermissionKey::ClientsRead],
    }
}

pub(super) fn origin() -> Beat {
    Beat::now()
}

pub(super) fn later(beat: Beat, by: Duration) -> Beat {
    Beat {
        mono: beat.mono + by,
        wall: beat.wall + by,
    }
}
