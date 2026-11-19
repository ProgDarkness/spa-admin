use std::sync::Arc;
use std::time::Instant;

use tauri::State;

use super::model::{LoginCredentials, SessionUser};
use super::password::PasswordPolicy;
use super::repository::{find_credentials_by_username, permissions_of_role_for_user};
use super::service::{self, AuthError, SessionState};
use super::throttle::LoginThrottle;
use crate::db::Database;
use crate::errors::AppError;

async fn verify_off_the_database_lock(
    database: &Database,
    passwords: Arc<PasswordPolicy>,
    credentials: LoginCredentials,
    username: &str,
) -> Result<SessionUser, AuthError> {
    let stored = database.with_conn(|conn| find_credentials_by_username(conn, username))?;
    let verified = tauri::async_runtime::spawn_blocking(move || {
        service::verify_credentials(&passwords, stored, &credentials.password)
    })
    .await
    .map_err(|_| AuthError::Hash)??;
    let permissions = database.with_conn(|conn| permissions_of_role_for_user(conn, verified.id))?;
    Ok(service::session_user_from(verified, permissions))
}

async fn authenticate(
    database: &Database,
    passwords: Arc<PasswordPolicy>,
    throttle: &LoginThrottle,
    credentials: LoginCredentials,
) -> Result<SessionUser, AuthError> {
    let username = service::validated_username(&credentials)?;
    if !throttle.reserve_attempt(&username, Instant::now()) {
        return Err(AuthError::InvalidCredentials);
    }
    let outcome = verify_off_the_database_lock(database, passwords, credentials, &username).await;
    match &outcome {
        Ok(_) => throttle.record_success(&username),
        Err(AuthError::InvalidCredentials) => {}
        Err(_) => throttle.release_attempt(&username),
    }
    outcome
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
    let user = authenticate(&db, Arc::clone(&passwords), &throttle, credentials).await?;
    session.start(user.clone(), Instant::now())?;
    Ok(user)
}

#[tauri::command]
#[specta::specta]
pub fn logout(session: State<'_, SessionState>) -> Result<(), AppError> {
    Ok(session.end()?)
}

#[tauri::command]
#[specta::specta]
pub fn current_session(
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<Option<SessionUser>, AppError> {
    let outcome = db
        .with_conn(|conn| Ok(service::active_user(conn, &session, Instant::now())))
        .map_err(AuthError::from)?;
    match outcome {
        Ok(user) => Ok(Some(user)),
        Err(AuthError::Unauthenticated) => Ok(None),
        Err(other) => Err(other.into()),
    }
}

#[cfg(test)]
#[path = "commands_test.rs"]
mod tests;
