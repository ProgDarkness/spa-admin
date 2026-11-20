use std::sync::Arc;

use rusqlite::Connection;
use tauri::State;
use zeroize::Zeroizing;

use super::model::{
    NewRole, NewUserInput, PasswordReset, RolePermissionsUpdate, RoleSummary, UserSummary,
    UserUpdate, UsersError,
};
use super::repository::{self, NewUserRow};
use super::service;
use crate::db::Database;
use crate::errors::AppError;
use crate::features::auth::model::{PermissionKey, SessionUser};
use crate::features::auth::password::PasswordPolicy;
use crate::features::auth::service::{require_permission, AuthError, Beat, SessionState};

fn authorize_on(conn: &Connection, session: &SessionState) -> Result<SessionUser, UsersError> {
    Ok(require_permission(
        conn,
        session,
        PermissionKey::UsersManage,
        Beat::now(),
    )?)
}

fn authorize(database: &Database, session: &SessionState) -> Result<SessionUser, UsersError> {
    database.with_conn_mapped(|conn| authorize_on(conn, session))
}

async fn hash_off_the_database_lock(
    passwords: Arc<PasswordPolicy>,
    password: Zeroizing<String>,
) -> Result<String, UsersError> {
    let hashed = tauri::async_runtime::spawn_blocking(move || passwords.hash(&password))
        .await
        .map_err(|_| AuthError::Hash)?;
    Ok(hashed?)
}

#[tauri::command]
#[specta::specta]
pub fn list_users(
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<Vec<UserSummary>, AppError> {
    authorize(&db, &session)?;
    Ok(db
        .with_conn(repository::list_users)
        .map_err(UsersError::from)?)
}

#[tauri::command]
#[specta::specta]
pub async fn create_user(
    mut input: NewUserInput,
    db: State<'_, Database>,
    passwords: State<'_, Arc<PasswordPolicy>>,
    session: State<'_, SessionState>,
) -> Result<UserSummary, AppError> {
    authorize(&db, &session)?;
    let validated = service::validated_new_user(&mut input)?;
    let password_hash =
        hash_off_the_database_lock(Arc::clone(&passwords), validated.password).await?;
    let row = NewUserRow {
        username: validated.username,
        password_hash,
        role_id: validated.role_id,
    };
    Ok(db.with_tx(|tx| -> Result<UserSummary, UsersError> {
        let actor = authorize_on(tx, &session)?;
        service::create_user(tx, actor.id, &row)
    })?)
}

#[tauri::command]
#[specta::specta]
pub fn update_user(
    update: UserUpdate,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<UserSummary, AppError> {
    let actor = authorize(&db, &session)?;
    Ok(db.with_tx(|tx| service::update_user(tx, actor.id, &update))?)
}

#[tauri::command]
#[specta::specta]
pub async fn reset_user_password(
    mut reset: PasswordReset,
    db: State<'_, Database>,
    passwords: State<'_, Arc<PasswordPolicy>>,
    session: State<'_, SessionState>,
) -> Result<(), AppError> {
    authorize(&db, &session)?;
    let (target_id, password) = service::validated_reset(&mut reset)?;
    let password_hash = hash_off_the_database_lock(Arc::clone(&passwords), password).await?;
    db.with_tx(|tx| -> Result<(), UsersError> {
        let actor = authorize_on(tx, &session)?;
        service::reset_password(tx, actor.id, target_id, &password_hash)
    })?;
    session.end_if_user(target_id).map_err(UsersError::from)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn list_roles(
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<Vec<RoleSummary>, AppError> {
    authorize(&db, &session)?;
    Ok(db
        .with_conn(repository::list_roles)
        .map_err(UsersError::from)?)
}

#[tauri::command]
#[specta::specta]
pub fn create_role(
    role: NewRole,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<RoleSummary, AppError> {
    let actor = authorize(&db, &session)?;
    Ok(db.with_tx(|tx| service::create_role(tx, actor.id, &role))?)
}

#[tauri::command]
#[specta::specta]
pub fn set_role_permissions(
    update: RolePermissionsUpdate,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<RoleSummary, AppError> {
    let actor = authorize(&db, &session)?;
    Ok(db.with_tx(|tx| service::set_role_permissions(tx, actor.id, &update))?)
}

#[cfg(test)]
#[path = "commands_test.rs"]
mod tests;

#[cfg(test)]
#[path = "commands_flow_test.rs"]
mod flow_tests;

#[cfg(test)]
#[path = "commands_reauth_test.rs"]
mod reauth_tests;
