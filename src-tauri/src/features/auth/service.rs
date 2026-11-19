use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime};

use rusqlite::Connection;
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;

use super::events;
use super::heartbeat::resumed_between;
use super::model::{LoginCredentials, PermissionKey, SessionStatus, SessionUser, SessionView};
use super::password::PasswordPolicy;
use super::repository::{
    find_active_user_by_id, find_credentials_by_username, permissions_of_role_for_user,
    ActiveUserRow, UserCredentialRow,
};
use super::username::is_allowed_username_character;
use crate::db::DbError;
use crate::errors::AppError;

const MAX_USERNAME_BYTES: usize = 64;
const MAX_PASSWORD_BYTES: usize = 1024;
const PASSWORD_FIELD: &str = "password";
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
    #[error("session locked")]
    Locked,
    #[error("validation failed")]
    Validation(&'static str),
    #[error("initial setup already completed")]
    SetupClosed,
}

pub fn normalized_username(raw: &str) -> Option<String> {
    let username: String = raw.trim().nfc().collect();
    let within_limit = (1..=MAX_USERNAME_BYTES).contains(&username.len());
    (within_limit && username.chars().all(is_allowed_username_character)).then_some(username)
}

pub fn validated_password(password: &str) -> Result<(), AuthError> {
    if (1..=MAX_PASSWORD_BYTES).contains(&password.len()) {
        Ok(())
    } else {
        Err(AuthError::InvalidCredentials)
    }
}

pub fn validated_username(credentials: &LoginCredentials) -> Result<String, AuthError> {
    validated_password(&credentials.password)?;
    normalized_username(&credentials.username).ok_or(AuthError::InvalidCredentials)
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

pub fn session_user_from(
    row: impl Into<ActiveUserRow>,
    permissions: Vec<PermissionKey>,
) -> SessionUser {
    let row = row.into();
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Beat {
    pub mono: Instant,
    pub wall: SystemTime,
}

impl Beat {
    pub fn now() -> Self {
        Self {
            mono: Instant::now(),
            wall: SystemTime::now(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LockReason {
    Idle,
    Resume,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Observation {
    pub view: SessionView,
    pub locked_now: Option<LockReason>,
    pub user_id: i64,
}

struct ActiveSession {
    user: SessionUser,
    last_activity: Instant,
    last_beat: Beat,
    locked: bool,
    audit_pending: Option<LockReason>,
}

impl ActiveSession {
    fn view(&self) -> SessionView {
        if self.locked {
            SessionView::locked()
        } else {
            SessionView::active(self.user.clone())
        }
    }

    fn lock_if_idle(&mut self, beat: Beat) -> Option<LockReason> {
        let idle = beat.mono.saturating_duration_since(self.last_activity) >= IDLE_TIMEOUT;
        if self.locked || !idle {
            return None;
        }
        self.locked = true;
        Some(LockReason::Idle)
    }

    fn lock_if_resumed(&mut self, beat: Beat) -> Option<LockReason> {
        if self.locked || !resumed_between(self.last_beat, beat) {
            return None;
        }
        self.locked = true;
        Some(LockReason::Resume)
    }

    fn observe(&mut self, beat: Beat) -> Observation {
        let locked_now = self
            .lock_if_resumed(beat)
            .or_else(|| self.lock_if_idle(beat))
            .or_else(|| self.audit_pending.take());
        self.last_beat = beat;
        Observation {
            view: self.view(),
            locked_now,
            user_id: self.user.id,
        }
    }

    fn unlocked(user: SessionUser, beat: Beat) -> Self {
        Self {
            user,
            last_activity: beat.mono,
            last_beat: beat,
            locked: false,
            audit_pending: None,
        }
    }
}

#[derive(Default)]
pub struct SessionState(Mutex<Option<ActiveSession>>);

impl SessionState {
    fn lock(&self) -> MutexGuard<'_, Option<ActiveSession>> {
        self.0.lock().unwrap_or_else(|poisoned| {
            let mut guard = poisoned.into_inner();
            *guard = None;
            self.0.clear_poison();
            guard
        })
    }

    pub fn start(&self, user: SessionUser, beat: Beat) -> Result<(), AuthError> {
        *self.lock() = Some(ActiveSession::unlocked(user, beat));
        Ok(())
    }

    pub(super) fn restore_audit_pending(&self, user_id: i64, reason: LockReason) {
        if let Some(session) = self.lock().as_mut() {
            if session.user.id == user_id && session.locked {
                session.audit_pending = Some(reason);
            }
        }
    }

    pub fn end(&self) -> Result<Option<i64>, AuthError> {
        Ok(self.lock().take().map(|session| session.user.id))
    }

    pub fn current_user_id(&self) -> Result<Option<i64>, AuthError> {
        Ok(self.lock().as_ref().map(|session| session.user.id))
    }

    pub fn end_if_user(&self, user_id: i64) -> Result<bool, AuthError> {
        let mut slot = self.lock();
        let matches = slot
            .as_ref()
            .is_some_and(|session| session.user.id == user_id);
        if matches {
            *slot = None;
        }
        Ok(matches)
    }

    pub fn observe(&self, beat: Beat) -> Result<Option<Observation>, AuthError> {
        Ok(self.lock().as_mut().map(|session| session.observe(beat)))
    }

    pub fn record_activity(&self, beat: Beat) -> Result<Option<Observation>, AuthError> {
        Ok(self.lock().as_mut().map(|session| {
            let observation = session.observe(beat);
            if observation.view.status == SessionStatus::Active {
                session.last_activity = beat.mono;
            }
            observation
        }))
    }

    pub fn last_beat(&self) -> Result<Option<Beat>, AuthError> {
        Ok(self.lock().as_ref().map(|session| session.last_beat))
    }

    pub fn locked_user_id(&self) -> Result<Option<i64>, AuthError> {
        Ok(self
            .lock()
            .as_ref()
            .filter(|session| session.locked)
            .map(|session| session.user.id))
    }

    pub fn unlock(&self, user: SessionUser, beat: Beat) -> Result<(), AuthError> {
        let mut slot = self.lock();
        let session = slot.as_mut().ok_or(AuthError::Unauthenticated)?;
        if session.user.id != user.id {
            return Err(AuthError::Unauthenticated);
        }
        if !session.locked {
            return Err(AuthError::Validation(PASSWORD_FIELD));
        }
        *session = ActiveSession::unlocked(user, beat);
        Ok(())
    }

    fn refresh(&self, user: SessionUser) -> Result<(), AuthError> {
        if let Some(session) = self.lock().as_mut() {
            session.user = user;
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn poison_for_test(&self) {
        let poisoning = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = self.0.lock().unwrap();
            panic!("poison");
        }));
        assert!(poisoning.is_err());
    }

    #[cfg(test)]
    pub(crate) fn lock_with_pending_audit_for_test(&self, reason: LockReason) {
        if let Some(session) = self.lock().as_mut() {
            session.locked = true;
            session.audit_pending = Some(reason);
        }
    }

    #[cfg(test)]
    pub(crate) fn force_lock(&self) -> Result<(), AuthError> {
        if let Some(session) = self.lock().as_mut() {
            session.locked = true;
        }
        Ok(())
    }
}

pub fn active_user(
    conn: &Connection,
    session: &SessionState,
    beat: Beat,
) -> Result<SessionUser, AuthError> {
    let observation = session.observe(beat)?.ok_or(AuthError::Unauthenticated)?;
    events::session_locked_if_new(conn, session, &observation)?;
    let Some(cached) = observation.view.user else {
        return Err(AuthError::Locked);
    };
    let Some(row) = find_active_user_by_id(conn, cached.id)? else {
        session.end_if_user(cached.id)?;
        return Err(AuthError::Unauthenticated);
    };
    let fresh = session_user_from(row, permissions_of_role_for_user(conn, cached.id)?);
    session.refresh(fresh.clone())?;
    Ok(fresh)
}

pub fn require_permission(
    conn: &Connection,
    session: &SessionState,
    permission: PermissionKey,
    beat: Beat,
) -> Result<SessionUser, AuthError> {
    let user = active_user(conn, session, beat)?;
    if user.permissions.contains(&permission) {
        Ok(user)
    } else {
        Err(AuthError::Forbidden)
    }
}

fn view_from(outcome: Result<SessionUser, AuthError>) -> Result<Option<SessionView>, AuthError> {
    match outcome {
        Ok(user) => Ok(Some(SessionView::active(user))),
        Err(AuthError::Locked) => Ok(Some(SessionView::locked())),
        Err(AuthError::Unauthenticated) => Ok(None),
        Err(other) => Err(other),
    }
}

pub fn current_view(
    conn: &Connection,
    session: &SessionState,
    beat: Beat,
) -> Result<Option<SessionView>, AuthError> {
    view_from(active_user(conn, session, beat))
}

pub fn record_activity_view(
    conn: &Connection,
    session: &SessionState,
    beat: Beat,
) -> Result<Option<SessionView>, AuthError> {
    let Some(observation) = session.record_activity(beat)? else {
        return Ok(None);
    };
    events::session_locked_if_new(conn, session, &observation)?;
    view_from(active_user(conn, session, beat))
}

pub fn locked_user_for_unlock(
    conn: &Connection,
    session: &SessionState,
    beat: Beat,
) -> Result<i64, AuthError> {
    let observation = session.observe(beat)?.ok_or(AuthError::Unauthenticated)?;
    events::session_locked_if_new(conn, session, &observation)?;
    if observation.view.status == SessionStatus::Active {
        return Err(AuthError::Validation(PASSWORD_FIELD));
    }
    session.locked_user_id()?.ok_or(AuthError::Unauthenticated)
}

impl From<AuthError> for AppError {
    fn from(error: AuthError) -> Self {
        match error {
            AuthError::InvalidCredentials => AppError::invalid_credentials(),
            AuthError::Unauthenticated => AppError::unauthenticated(),
            AuthError::Forbidden | AuthError::SetupClosed => AppError::forbidden(),
            AuthError::Locked => AppError::session_locked(),
            AuthError::Validation(field) => AppError::validation(field),
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

#[cfg(test)]
#[path = "service_login_test.rs"]
mod login_tests;

#[cfg(test)]
#[path = "service_session_test.rs"]
mod session_tests;

#[cfg(test)]
#[path = "service_username_test.rs"]
mod username_tests;
