use std::sync::Arc;
use std::time::Instant;

use tauri::State;
use zeroize::Zeroizing;

use super::events;
use super::model::{
    LoginCredentials, OwnerSetup, OwnerSetupResult, SessionUser, SessionView, SetupStatus,
    UnlockCredentials,
};
use super::owner_setup;
use super::password::PasswordPolicy;
use super::repository::{
    clear_persisted_failures, find_credentials_by_id, find_credentials_by_username,
    permissions_of_role_for_user, record_persisted_failure, UserCredentialRow,
};
use super::service::{self, AuthError, Beat, SessionState};
use super::throttle::{AttemptFailure, LoginThrottle};
use crate::db::Database;
use crate::errors::AppError;
use crate::features::audit::ClockRollbackNotice;

fn take_password(password: &mut String) -> Zeroizing<String> {
    Zeroizing::new(std::mem::take(password))
}

async fn verify_off_the_database_lock(
    passwords: Arc<PasswordPolicy>,
    stored: Option<UserCredentialRow>,
    password: Zeroizing<String>,
) -> Result<UserCredentialRow, AuthError> {
    tauri::async_runtime::spawn_blocking(move || {
        service::verify_credentials(&passwords, stored, &password)
    })
    .await
    .map_err(|_| AuthError::Hash)?
}

async fn reject_after_verification(
    passwords: Arc<PasswordPolicy>,
    stored: Option<UserCredentialRow>,
    password: Zeroizing<String>,
) -> AuthError {
    let _ = verify_off_the_database_lock(passwords, stored, password).await;
    AuthError::InvalidCredentials
}

fn sign_in_audited(
    database: &Database,
    session: &SessionState,
    verified: UserCredentialRow,
) -> Result<SessionUser, AuthError> {
    let previous_user_id = session.current_user_id()?;
    database.with_tx(|tx| {
        let permissions = permissions_of_role_for_user(tx, verified.id)?;
        clear_persisted_failures(tx, verified.id)?;
        if let Some(previous_user_id) = previous_user_id {
            events::logout(tx, previous_user_id)?;
        }
        events::login_succeeded(tx, verified.id)?;
        Ok(service::session_user_from(verified, permissions))
    })
}

fn reject_login(
    database: &Database,
    known_user_id: Option<i64>,
) -> Result<SessionUser, AttemptFailure> {
    if let Some(user_id) = known_user_id {
        database
            .with_tx(|tx| -> Result<(), AuthError> {
                let failure = record_persisted_failure(tx, user_id)?;
                events::login_failed(tx, user_id, failure.locked_now)
            })
            .map_err(AttemptFailure::spent)?;
    }
    Err(AuthError::InvalidCredentials.into())
}

async fn attempt_login(
    database: &Database,
    passwords: Arc<PasswordPolicy>,
    session: &SessionState,
    mut credentials: LoginCredentials,
    stored: Option<UserCredentialRow>,
) -> Result<SessionUser, AttemptFailure> {
    let known_user_id = stored.as_ref().map(|row| row.id);
    match verify_off_the_database_lock(passwords, stored, take_password(&mut credentials.password))
        .await
    {
        Ok(verified) => Ok(sign_in_audited(database, session, verified)?),
        Err(AuthError::InvalidCredentials) => reject_login(database, known_user_id),
        Err(other) => Err(other.into()),
    }
}

async fn authenticate(
    database: &Database,
    passwords: Arc<PasswordPolicy>,
    throttle: &LoginThrottle,
    session: &SessionState,
    mut credentials: LoginCredentials,
) -> Result<SessionUser, AuthError> {
    let username = service::validated_username(&credentials)?;
    let stored = database.with_conn(|conn| find_credentials_by_username(conn, &username))?;
    let denied = stored.as_ref().is_some_and(|row| row.is_locked_out)
        || !throttle
            .reserve_attempt(&username, Instant::now())
            .is_granted();
    if denied {
        let password = take_password(&mut credentials.password);
        return Err(reject_after_verification(passwords, stored, password).await);
    }
    let outcome = attempt_login(database, passwords, session, credentials, stored).await;
    throttle.settle(&username, outcome)
}

#[tauri::command]
#[specta::specta]
pub async fn login(
    credentials: LoginCredentials,
    db: State<'_, Database>,
    passwords: State<'_, Arc<PasswordPolicy>>,
    session: State<'_, SessionState>,
    throttle: State<'_, LoginThrottle>,
) -> Result<SessionUser, AppError> {
    let user = authenticate(
        &db,
        Arc::clone(&passwords),
        &throttle,
        &session,
        credentials,
    )
    .await?;
    session.start(user.clone(), Beat::now())?;
    Ok(user)
}

#[tauri::command]
#[specta::specta]
pub fn logout(db: State<'_, Database>, session: State<'_, SessionState>) -> Result<(), AppError> {
    if let Some(user_id) = session.end()? {
        db.with_tx(|tx| events::logout(tx, user_id))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn current_session(
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<Option<SessionView>, AppError> {
    let view = db.with_tx(|tx| service::current_view(tx, &session, Beat::now()))?;
    Ok(view)
}

#[tauri::command]
#[specta::specta]
pub fn record_activity(
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<Option<SessionView>, AppError> {
    let view = db.with_tx(|tx| service::record_activity_view(tx, &session, Beat::now()))?;
    Ok(view)
}

fn complete_unlock(
    database: &Database,
    session: &SessionState,
    verified: UserCredentialRow,
) -> Result<SessionUser, AuthError> {
    let user = database.with_tx(|tx| -> Result<SessionUser, AuthError> {
        let permissions = permissions_of_role_for_user(tx, verified.id)?;
        clear_persisted_failures(tx, verified.id)?;
        events::session_unlocked(tx, verified.id)?;
        Ok(service::session_user_from(verified, permissions))
    })?;
    session.unlock(user.clone(), Beat::now())?;
    Ok(user)
}

fn reject_unlock(database: &Database, user_id: i64) -> Result<SessionUser, AttemptFailure> {
    database
        .with_tx(|tx| -> Result<(), AuthError> {
            let failure = record_persisted_failure(tx, user_id)?;
            events::unlock_failed(tx, user_id, failure.locked_now)
        })
        .map_err(AttemptFailure::spent)?;
    Err(AuthError::InvalidCredentials.into())
}

async fn attempt_unlock(
    database: &Database,
    passwords: Arc<PasswordPolicy>,
    session: &SessionState,
    row: UserCredentialRow,
    mut credentials: UnlockCredentials,
) -> Result<SessionUser, AttemptFailure> {
    let user_id = row.id;
    match verify_off_the_database_lock(
        passwords,
        Some(row),
        take_password(&mut credentials.password),
    )
    .await
    {
        Ok(verified) => Ok(complete_unlock(database, session, verified)?),
        Err(AuthError::InvalidCredentials) => reject_unlock(database, user_id),
        Err(other) => Err(other.into()),
    }
}

async fn authenticate_unlock(
    database: &Database,
    passwords: Arc<PasswordPolicy>,
    throttle: &LoginThrottle,
    session: &SessionState,
    user_id: i64,
    mut credentials: UnlockCredentials,
) -> Result<SessionUser, AuthError> {
    let stored = database.with_conn(|conn| find_credentials_by_id(conn, user_id))?;
    let Some(row) = stored else {
        let _ =
            verify_off_the_database_lock(passwords, None, take_password(&mut credentials.password))
                .await;
        session.end_if_user(user_id)?;
        return Err(AuthError::Unauthenticated);
    };
    let username = row.username.clone();
    let is_active = row.is_active;
    let denied = (row.is_locked_out && is_active)
        || !throttle
            .reserve_attempt(&username, Instant::now())
            .is_granted();
    if denied {
        let password = take_password(&mut credentials.password);
        return Err(reject_after_verification(passwords, Some(row), password).await);
    }
    let outcome = attempt_unlock(database, passwords, session, row, credentials)
        .await
        .map_err(|failure| failure.spent_only_if(is_active));
    let settled = throttle.settle(&username, outcome);
    if matches!(settled, Err(AuthError::InvalidCredentials)) && !is_active {
        session.end_if_user(user_id)?;
        return Err(AuthError::Unauthenticated);
    }
    settled
}

#[tauri::command]
#[specta::specta]
pub async fn unlock(
    credentials: UnlockCredentials,
    db: State<'_, Database>,
    passwords: State<'_, Arc<PasswordPolicy>>,
    session: State<'_, SessionState>,
    throttle: State<'_, LoginThrottle>,
) -> Result<SessionUser, AppError> {
    service::validated_password(&credentials.password)?;
    let user_id = db.with_tx(|tx| service::locked_user_for_unlock(tx, &session, Beat::now()))?;
    let user = authenticate_unlock(
        &db,
        Arc::clone(&passwords),
        &throttle,
        &session,
        user_id,
        credentials,
    )
    .await?;
    Ok(user)
}

#[tauri::command]
#[specta::specta]
pub fn setup_status(
    db: State<'_, Database>,
    notice: State<'_, ClockRollbackNotice>,
) -> Result<SetupStatus, AppError> {
    let status = db
        .with_conn(|conn| owner_setup::setup_status_of(conn, &notice))
        .map_err(AuthError::from)?;
    Ok(status)
}

#[tauri::command]
#[specta::specta]
pub async fn setup_owner(
    input: OwnerSetup,
    db: State<'_, Database>,
    passwords: State<'_, Arc<PasswordPolicy>>,
    session: State<'_, SessionState>,
) -> Result<OwnerSetupResult, AppError> {
    let result = owner_setup::create_owner(&db, Arc::clone(&passwords), &session, input).await?;
    Ok(result)
}

#[cfg(test)]
#[path = "commands_test.rs"]
mod tests;

#[cfg(test)]
#[path = "commands_audit_test.rs"]
mod audit_tests;

#[cfg(test)]
#[path = "commands_lockout_test.rs"]
mod lockout_tests;
