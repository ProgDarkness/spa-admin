use std::fmt;
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::State;
use zeroize::{Zeroize, Zeroizing};

use super::events;
use super::password::{validate_new_password, PasswordPolicy};
use super::recovery::RecoveryCode;
use super::repository::{
    clear_persisted_failures, find_credentials_by_username, record_persisted_failure,
    rotate_credentials, UserCredentialRow,
};
use super::service::{normalized_username, validated_password, AuthError, SessionState};
use super::throttle::{AttemptFailure, LoginThrottle};
use crate::db::Database;
use crate::errors::AppError;

#[derive(Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryRequest {
    pub username: String,
    pub recovery_code: String,
    pub new_password: String,
}

impl RecoveryRequest {
    fn take_recovery_code(&mut self) -> Zeroizing<String> {
        Zeroizing::new(std::mem::take(&mut self.recovery_code))
    }

    fn take_new_password(&mut self) -> Zeroizing<String> {
        Zeroizing::new(std::mem::take(&mut self.new_password))
    }
}

impl Drop for RecoveryRequest {
    fn drop(&mut self) {
        self.recovery_code.zeroize();
        self.new_password.zeroize();
    }
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryResult {
    pub recovery_code: String,
}

impl fmt::Debug for RecoveryResult {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RecoveryResult")
            .field("recovery_code", &"***")
            .finish()
    }
}

struct Rotation {
    password_hash: String,
    recovery_code: RecoveryCode,
    recovery_code_hash: String,
}

fn check_code_against_stored_hash(
    passwords: &PasswordPolicy,
    stored: Option<&UserCredentialRow>,
    submitted: &str,
) -> Result<bool, AuthError> {
    let parsed = RecoveryCode::parse(submitted);
    let candidate = parsed.as_ref().map_or(submitted, RecoveryCode::canonical);
    let stored_hash = stored.and_then(|row| row.recovery_code_hash.as_deref());
    let hash_matches = passwords.verify(candidate, stored_hash)?;
    Ok(hash_matches && parsed.is_some())
}

async fn verify_stored_code(
    passwords: Arc<PasswordPolicy>,
    stored: Option<UserCredentialRow>,
    submitted: Zeroizing<String>,
) -> Result<UserCredentialRow, AuthError> {
    tauri::async_runtime::spawn_blocking(move || {
        let code_matches = check_code_against_stored_hash(&passwords, stored.as_ref(), &submitted)?;
        match stored {
            Some(row) if code_matches && row.is_active => Ok(row),
            _ => Err(AuthError::InvalidCredentials),
        }
    })
    .await
    .map_err(|_| AuthError::Hash)?
}

async fn prepare_rotation(
    passwords: Arc<PasswordPolicy>,
    new_password: Zeroizing<String>,
) -> Result<Rotation, AuthError> {
    tauri::async_runtime::spawn_blocking(move || {
        let recovery_code = RecoveryCode::generate()?;
        let password_hash = passwords.hash(&new_password)?;
        let recovery_code_hash = passwords.hash(recovery_code.canonical())?;
        Ok(Rotation {
            password_hash,
            recovery_code,
            recovery_code_hash,
        })
    })
    .await
    .map_err(|_| AuthError::Hash)?
}

fn commit_rotation(
    database: &Database,
    verified: &UserCredentialRow,
    rotation: &Rotation,
) -> Result<(), AuthError> {
    let expected = verified
        .recovery_code_hash
        .as_deref()
        .ok_or(AuthError::InvalidCredentials)?;
    database.with_tx(|tx| {
        let swapped = rotate_credentials(
            tx,
            verified.id,
            expected,
            &rotation.password_hash,
            &rotation.recovery_code_hash,
        )?;
        if !swapped {
            return Err(AuthError::InvalidCredentials);
        }
        clear_persisted_failures(tx, verified.id)?;
        events::recovery_used(tx, verified.id)
    })
}

async fn rotate_after_verification(
    database: &Database,
    passwords: Arc<PasswordPolicy>,
    session: &SessionState,
    verified: UserCredentialRow,
    new_password: Zeroizing<String>,
) -> Result<RecoveryResult, AuthError> {
    let rotation = prepare_rotation(passwords, new_password).await?;
    commit_rotation(database, &verified, &rotation)?;
    session.end_if_user(verified.id)?;
    Ok(RecoveryResult {
        recovery_code: rotation.recovery_code.formatted().to_string(),
    })
}

fn reject_recovery(
    database: &Database,
    known_user_id: Option<i64>,
) -> Result<RecoveryResult, AttemptFailure> {
    if let Some(user_id) = known_user_id {
        database
            .with_tx(|tx| -> Result<(), AuthError> {
                let failure = record_persisted_failure(tx, user_id)?;
                events::recovery_failed(tx, user_id, failure.locked_now)
            })
            .map_err(AttemptFailure::spent)?;
    }
    Err(AuthError::InvalidCredentials.into())
}

async fn attempt_recovery(
    database: &Database,
    passwords: Arc<PasswordPolicy>,
    session: &SessionState,
    stored: Option<UserCredentialRow>,
    submitted: Zeroizing<String>,
    new_password: Zeroizing<String>,
) -> Result<RecoveryResult, AttemptFailure> {
    let known_user_id = stored.as_ref().map(|row| row.id);
    match verify_stored_code(Arc::clone(&passwords), stored, submitted).await {
        Ok(verified) => {
            Ok(
                rotate_after_verification(database, passwords, session, verified, new_password)
                    .await?,
            )
        }
        Err(AuthError::InvalidCredentials) => reject_recovery(database, known_user_id),
        Err(other) => Err(other.into()),
    }
}

pub async fn recover_with(
    database: &Database,
    passwords: Arc<PasswordPolicy>,
    session: &SessionState,
    throttle: &LoginThrottle,
    mut input: RecoveryRequest,
) -> Result<RecoveryResult, AuthError> {
    let new_password = input.take_new_password();
    let submitted = input.take_recovery_code();
    validate_new_password(&new_password)?;
    validated_password(&submitted)?;
    let username = normalized_username(&input.username).ok_or(AuthError::InvalidCredentials)?;
    let stored = database.with_conn(|conn| find_credentials_by_username(conn, &username))?;
    let denied = stored.as_ref().is_some_and(|row| row.is_locked_out)
        || !throttle
            .reserve_attempt(&username, Instant::now())
            .is_granted();
    if denied {
        let _ = verify_stored_code(passwords, stored, submitted).await;
        return Err(AuthError::InvalidCredentials);
    }
    let outcome = attempt_recovery(
        database,
        passwords,
        session,
        stored,
        submitted,
        new_password,
    )
    .await;
    throttle.settle(&username, outcome)
}

#[tauri::command]
#[specta::specta]
pub async fn recover_password(
    input: RecoveryRequest,
    db: State<'_, Database>,
    passwords: State<'_, Arc<PasswordPolicy>>,
    session: State<'_, SessionState>,
    throttle: State<'_, LoginThrottle>,
) -> Result<RecoveryResult, AppError> {
    let result = recover_with(&db, Arc::clone(&passwords), &session, &throttle, input).await?;
    Ok(result)
}

#[cfg(test)]
#[path = "recover_test.rs"]
mod tests;
