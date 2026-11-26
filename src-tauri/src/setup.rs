use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{Manager, Runtime};
use thiserror::Error;

use crate::db::snapshot::{pending_from, snapshot_before_migrate, SnapshotError};
use crate::db::{migrate, open_encrypted, Database, DbError};
use crate::features::audit::{record_clock_rollback, ClockRollback, ClockRollbackNotice};
use crate::features::auth::heartbeat::spawn_heartbeat;
use crate::features::auth::password::PasswordPolicy;
use crate::features::auth::service::{AuthError, SessionState};
use crate::features::auth::throttle::LoginThrottle;
use crate::features::backup::dialogs::BackupDialogs;
use crate::features::backup::errors::BackupError;
use crate::features::backup::model::BackupSource;
use crate::features::backup::recovery::recover_interrupted_restore;
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
    #[error("database snapshot unavailable")]
    Snapshot(#[from] SnapshotError),
    #[error("backup recovery unavailable")]
    Backup(#[from] BackupError),
    #[error("password policy unavailable")]
    Auth(#[from] AuthError),
    #[error("seed password too short")]
    SeedPasswordTooShort,
    #[error("seed catalog rejected")]
    SeedCatalogRejected,
    #[error("seed appointment rejected")]
    SeedAppointmentRejected(#[source] crate::features::appointments::model::AppointmentError),
    #[error("seed payment rejected")]
    SeedPaymentRejected(#[source] crate::features::payments::model::PaymentError),
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
    pub clock_rollback: Option<ClockRollback>,
}

#[cfg(debug_assertions)]
fn seed_for_development(
    database: &Database,
    passwords: &PasswordPolicy,
    read_env: &dyn Fn(&str) -> Option<String>,
) -> Result<(), SetupError> {
    database.with_conn(|conn| {
        Ok(crate::dev_seed::seed_if_empty(conn, passwords, read_env)
            .and_then(|()| crate::dev_seed_catalog::seed_catalog_if_empty(conn, read_env))
            .and_then(|()| crate::dev_seed_clients::seed_clients_if_empty(conn, read_env))
            .and_then(|()| crate::dev_seed_appointments::seed_appointments_if_empty(conn, read_env))
            .and_then(|()| crate::dev_seed_payments::seed_payments_if_empty(conn, read_env)))
    })?
}

#[cfg(not(debug_assertions))]
fn seed_for_development(
    _: &Database,
    _: &PasswordPolicy,
    _: &dyn Fn(&str) -> Option<String>,
) -> Result<(), SetupError> {
    Ok(())
}

pub fn bootstrap(data_dir: &Path, store: &KeyStore) -> Result<Bootstrap, SetupError> {
    let read_env = |name: &str| std::env::var(name).ok();
    bootstrap_with(data_dir, store, snapshot_before_migrate, &read_env)
}

fn bootstrap_with(
    data_dir: &Path,
    store: &KeyStore,
    snapshot: impl FnOnce(&Path, i64) -> Result<PathBuf, SnapshotError>,
    read_env: &dyn Fn(&str) -> Option<String>,
) -> Result<Bootstrap, SetupError> {
    fs::create_dir_all(data_dir)?;
    restrict_to_owner(data_dir, DIRECTORY_MODE)?;
    let database_path = data_dir.join(DATABASE_FILE_NAME);
    recover_interrupted_restore(&database_path, store)?;
    let key = load_or_create(store, database_path.exists())?;
    let mut conn = open_encrypted(&database_path, &key)?;
    restrict_to_owner(&database_path, DATABASE_MODE)?;
    if let Some(version) = pending_from(&conn)? {
        snapshot(&database_path, version)?;
    }
    migrate(&mut conn)?;
    let passwords = PasswordPolicy::new()?;
    let database = Database::new(conn);
    let clock_rollback = database.with_tx(|tx| record_clock_rollback(tx))?;
    seed_for_development(&database, &passwords, read_env)?;
    Ok(Bootstrap {
        database,
        passwords,
        clock_rollback,
    })
}

pub fn init<R: Runtime>(app: &mut tauri::App<R>) -> Result<(), Box<dyn Error>> {
    let data_dir = app.path().app_data_dir()?;
    let store = KeyStore::new(app.config().identifier.clone());
    init_native_store()?;
    install(app, &data_dir, &store)
}

fn install<R: Runtime>(
    app: &mut tauri::App<R>,
    data_dir: &Path,
    store: &KeyStore,
) -> Result<(), Box<dyn Error>> {
    let Bootstrap {
        database,
        passwords,
        clock_rollback,
    } = bootstrap(data_dir, store)?;
    app.manage(database);
    app.manage(BackupSource {
        database_path: data_dir.join(DATABASE_FILE_NAME),
        key_store: store.clone(),
    });
    app.manage(BackupDialogs::native(app.handle().clone()));
    app.manage(ClockRollbackNotice(clock_rollback));
    app.manage(Arc::new(passwords));
    app.manage(LoginThrottle::default());
    app.manage(SessionState::default());
    spawn_heartbeat(app.handle().clone());
    Ok(())
}

#[cfg(test)]
#[path = "setup_test.rs"]
mod tests;
