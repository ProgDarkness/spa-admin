use std::error::Error;
use std::fs;
use std::path::Path;
use std::sync::Arc;

use tauri::Manager;
use thiserror::Error;

use crate::db::{migrate, open_encrypted, Database, DbError};
use crate::features::auth::password::PasswordPolicy;
use crate::features::auth::service::{AuthError, SessionState};
use crate::features::auth::throttle::LoginThrottle;
use crate::keystore::{init_native_store, load_or_create, KeyStore, KeyStoreError};

pub const DATABASE_FILE_NAME: &str = "spa.db";

#[derive(Debug, Error)]
pub enum SetupError {
    #[error("data directory unavailable")]
    Io(#[from] std::io::Error),
    #[error("key store unavailable")]
    KeyStore(#[from] KeyStoreError),
    #[error("database unavailable")]
    Db(#[from] DbError),
    #[error("password policy unavailable")]
    Auth(#[from] AuthError),
    #[error("seed password too short")]
    SeedPasswordTooShort,
}

const DIRECTORY_MODE: u32 = 0o700;
const DATABASE_MODE: u32 = 0o600;

#[cfg(unix)]
fn restrict_to_owner(path: &Path, mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn restrict_to_owner(_: &Path, _: u32) -> std::io::Result<()> {
    Ok(())
}

pub struct Bootstrap {
    pub database: Database,
    pub passwords: PasswordPolicy,
}

#[cfg(debug_assertions)]
fn seed_for_development(database: &Database, passwords: &PasswordPolicy) -> Result<(), SetupError> {
    let read_env = |name: &str| std::env::var(name).ok();
    database.with_conn(|conn| Ok(crate::dev_seed::seed_if_empty(conn, passwords, &read_env)))?
}

#[cfg(not(debug_assertions))]
fn seed_for_development(_: &Database, _: &PasswordPolicy) -> Result<(), SetupError> {
    Ok(())
}

pub fn bootstrap(data_dir: &Path, store: &KeyStore) -> Result<Bootstrap, SetupError> {
    fs::create_dir_all(data_dir)?;
    restrict_to_owner(data_dir, DIRECTORY_MODE)?;
    let database_path = data_dir.join(DATABASE_FILE_NAME);
    let key = load_or_create(store, database_path.exists())?;
    let mut conn = open_encrypted(&database_path, &key)?;
    restrict_to_owner(&database_path, DATABASE_MODE)?;
    migrate(&mut conn)?;
    let passwords = PasswordPolicy::new()?;
    let database = Database::new(conn);
    seed_for_development(&database, &passwords)?;
    Ok(Bootstrap {
        database,
        passwords,
    })
}

pub fn init(app: &mut tauri::App) -> Result<(), Box<dyn Error>> {
    let data_dir = app.path().app_data_dir()?;
    let store = KeyStore::new(app.config().identifier.clone());
    init_native_store()?;
    let Bootstrap {
        database,
        passwords,
    } = bootstrap(&data_dir, &store)?;
    app.manage(database);
    app.manage(Arc::new(passwords));
    app.manage(LoginThrottle::default());
    app.manage(SessionState::default());
    Ok(())
}

#[cfg(test)]
#[path = "setup_test.rs"]
mod tests;
