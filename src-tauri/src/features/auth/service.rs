use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;

use super::model::{LoginCredentials, PermissionKey, SessionUser};
use super::password::PasswordPolicy;
use super::repository::{
    find_active_user_by_id, find_credentials_by_username, permissions_of_role_for_user,
    UserCredentialRow,
};
use crate::db::DbError;
use crate::errors::AppError;

const MAX_USERNAME_BYTES: usize = 64;
const MAX_PASSWORD_BYTES: usize = 1024;
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("invalid credentials")]
    InvalidCredentials,
    #[error("password hashing failure")]
    Hash,
    #[error("database failure")]
    Db(#[from] DbError),
    #[error("session unavailable")]
    SessionUnavailable,
    #[error("unauthenticated")]
    Unauthenticated,
    #[error("forbidden")]
    Forbidden,
}

pub fn validated_username(credentials: &LoginCredentials) -> Result<String, AuthError> {
    let username: String = credentials.username.trim().nfc().collect();
    let acceptable = (1..=MAX_USERNAME_BYTES).contains(&username.len())
        && (1..=MAX_PASSWORD_BYTES).contains(&credentials.password.len());
    if acceptable {
        Ok(username)
    } else {
        Err(AuthError::InvalidCredentials)
    }
}

pub fn verify_credentials(
    policy: &PasswordPolicy,
    stored: Option<UserCredentialRow>,
    password: &str,
) -> Result<UserCredentialRow, AuthError> {
    let stored_hash = stored.as_ref().map(|row| row.password_hash.as_str());
    let password_matches = policy.verify(password, stored_hash)?;
    match stored {
        Some(row) if password_matches && row.is_active => Ok(row),
        _ => Err(AuthError::InvalidCredentials),
    }
}

pub fn session_user_from(row: UserCredentialRow, permissions: Vec<PermissionKey>) -> SessionUser {
    SessionUser {
        id: row.id,
        username: row.username,
        role_name: row.role_name,
        permissions,
    }
}

pub fn login(
    conn: &Connection,
    policy: &PasswordPolicy,
    credentials: &LoginCredentials,
) -> Result<SessionUser, AuthError> {
    let username = validated_username(credentials)?;
    let stored = find_credentials_by_username(conn, &username)?;
    let row = verify_credentials(policy, stored, &credentials.password)?;
    let permissions = permissions_of_role_for_user(conn, row.id)?;
    Ok(session_user_from(row, permissions))
}

struct ActiveSession {
    user: SessionUser,
    last_activity: Instant,
}

#[derive(Default)]
pub struct SessionState(Mutex<Option<ActiveSession>>);

impl SessionState {
    fn lock(&self) -> Result<MutexGuard<'_, Option<ActiveSession>>, AuthError> {
        self.0.lock().map_err(|_| AuthError::SessionUnavailable)
    }

    pub fn start(&self, user: SessionUser, now: Instant) -> Result<(), AuthError> {
        *self.lock()? = Some(ActiveSession {
            user,
            last_activity: now,
        });
        Ok(())
    }

    pub fn end(&self) -> Result<(), AuthError> {
        *self.lock()? = None;
        Ok(())
    }

    pub fn current(&self, now: Instant) -> Result<Option<SessionUser>, AuthError> {
        let mut slot = self.lock()?;
        let expired = slot.as_ref().is_some_and(|session| {
            now.saturating_duration_since(session.last_activity) >= IDLE_TIMEOUT
        });
        if expired {
            *slot = None;
        }
        Ok(slot.as_mut().map(|session| {
            session.last_activity = now;
            session.user.clone()
        }))
    }

    fn refresh(&self, user: SessionUser) -> Result<(), AuthError> {
        if let Some(session) = self.lock()?.as_mut() {
            session.user = user;
        }
        Ok(())
    }
}

pub fn active_user(
    conn: &Connection,
    session: &SessionState,
    now: Instant,
) -> Result<SessionUser, AuthError> {
    let cached = session.current(now)?.ok_or(AuthError::Unauthenticated)?;
    let Some(row) = find_active_user_by_id(conn, cached.id)? else {
        session.end()?;
        return Err(AuthError::Unauthenticated);
    };
    let fresh = SessionUser {
        id: row.id,
        username: row.username,
        role_name: row.role_name,
        permissions: permissions_of_role_for_user(conn, row.id)?,
    };
    session.refresh(fresh.clone())?;
    Ok(fresh)
}

pub fn require_permission(
    conn: &Connection,
    session: &SessionState,
    permission: PermissionKey,
    now: Instant,
) -> Result<SessionUser, AuthError> {
    let user = active_user(conn, session, now)?;
    if user.permissions.contains(&permission) {
        Ok(user)
    } else {
        Err(AuthError::Forbidden)
    }
}

impl From<AuthError> for AppError {
    fn from(error: AuthError) -> Self {
        match error {
            AuthError::InvalidCredentials => AppError::invalid_credentials(),
            AuthError::Unauthenticated => AppError::unauthenticated(),
            AuthError::Forbidden => AppError::forbidden(),
            other => {
                eprintln!("auth: {other}");
                AppError::internal()
            }
        }
    }
}

#[cfg(test)]
#[path = "service_test.rs"]
mod tests;
