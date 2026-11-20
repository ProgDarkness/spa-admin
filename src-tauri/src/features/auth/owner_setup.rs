use std::sync::Arc;

use rusqlite::Connection;
use zeroize::Zeroizing;

use super::events;
use super::model::{OwnerSetup, OwnerSetupResult, SessionUser, SetupStatus};
use super::password::{validate_new_password, PasswordPolicy};
use super::recovery::RecoveryCode;
use super::repository::{
    count_users, find_active_user_by_id, insert_owner, permissions_of_role_for_user, NewOwner,
    OWNER_ROLE_ID,
};
use super::service::{normalized_username, session_user_from, AuthError, Beat, SessionState};
use crate::db::{Database, DbError};
use crate::features::audit::ClockRollbackNotice;

const USERNAME_FIELD: &str = "username";

struct OwnerCredentials {
    password_hash: String,
    recovery_code: RecoveryCode,
    recovery_code_hash: String,
}

pub fn needs_owner(conn: &Connection) -> Result<bool, DbError> {
    Ok(count_users(conn)? == 0)
}

pub fn setup_status_of(
    conn: &Connection,
    notice: &ClockRollbackNotice,
) -> Result<SetupStatus, DbError> {
    Ok(SetupStatus {
        needs_owner: needs_owner(conn)?,
        clock_rollback: notice.0.clone(),
    })
}

fn ensure_setup_open(database: &Database) -> Result<(), AuthError> {
    if database.with_conn(needs_owner)? {
        Ok(())
    } else {
        Err(AuthError::SetupClosed)
    }
}

async fn prepare_credentials(
    passwords: Arc<PasswordPolicy>,
    password: Zeroizing<String>,
) -> Result<OwnerCredentials, AuthError> {
    tauri::async_runtime::spawn_blocking(move || {
        let recovery_code = RecoveryCode::generate()?;
        let password_hash = passwords.hash(&password)?;
        let recovery_code_hash = passwords.hash(recovery_code.canonical())?;
        Ok(OwnerCredentials {
            password_hash,
            recovery_code,
            recovery_code_hash,
        })
    })
    .await
    .map_err(|_| AuthError::Hash)?
}

fn register_owner(
    database: &Database,
    username: &str,
    credentials: &OwnerCredentials,
) -> Result<SessionUser, AuthError> {
    database.with_tx(|tx| {
        if count_users(tx)? != 0 {
            return Err(AuthError::SetupClosed);
        }
        let owner = NewOwner {
            username: username.to_string(),
            password_hash: credentials.password_hash.clone(),
            recovery_code_hash: credentials.recovery_code_hash.clone(),
        };
        let id = insert_owner(tx, &owner)?;
        events::owner_created(tx, id, username, OWNER_ROLE_ID)?;
        let stored = find_active_user_by_id(tx, id)?.ok_or(AuthError::Unauthenticated)?;
        Ok(session_user_from(
            stored,
            permissions_of_role_for_user(tx, id)?,
        ))
    })
}

pub async fn create_owner(
    database: &Database,
    passwords: Arc<PasswordPolicy>,
    session: &SessionState,
    mut input: OwnerSetup,
) -> Result<OwnerSetupResult, AuthError> {
    let username =
        normalized_username(&input.username).ok_or(AuthError::Validation(USERNAME_FIELD))?;
    let password = input.take_password();
    validate_new_password(&password)?;
    ensure_setup_open(database)?;
    let credentials = prepare_credentials(passwords, password).await?;
    let user = register_owner(database, &username, &credentials)?;
    session.start(user.clone(), Beat::now())?;
    Ok(OwnerSetupResult {
        user,
        recovery_code: credentials.recovery_code.formatted().to_string(),
    })
}

#[cfg(test)]
#[path = "owner_setup_test.rs"]
mod tests;
