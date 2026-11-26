use std::io;

use tauri::State;
use zeroize::Zeroizing;

use super::crypto::{seal, BackupPassphrase};
use super::dialogs::BackupDialogs;
use super::errors::BackupError;
use super::format::KdfParams;
use super::model::{BackupExported, BackupSource, BackupStatus, RestoreResult};
use super::naming::{default_file_name_at, local_stamp_now, with_backup_extension};
use super::restore::stage_restore;
use super::service::{authorize, read_export_snapshot, write_export};
use super::status;
use super::swap::{authorize_restore, swap_in};
use crate::db::Database;
use crate::errors::AppError;
use crate::features::auth::service::SessionState;

fn background_failure(failure: tauri::Error) -> BackupError {
    BackupError::Io(io::Error::other(failure.to_string()))
}

async fn seal_in_background(
    passphrase: BackupPassphrase,
    kdf: KdfParams,
    schema_version: u32,
    plaintext: Zeroizing<Vec<u8>>,
) -> Result<Vec<u8>, BackupError> {
    tauri::async_runtime::spawn_blocking(move || seal(&passphrase, kdf, schema_version, &plaintext))
        .await
        .map_err(background_failure)?
}

pub(crate) async fn export_flow(
    db: &Database,
    session: &SessionState,
    source: &BackupSource,
    dialogs: &BackupDialogs,
    kdf: KdfParams,
    passphrase: String,
) -> Result<Option<BackupExported>, BackupError> {
    db.with_conn_mapped(|conn| authorize(conn, session).map(|_| ()))?;
    let passphrase = BackupPassphrase::new(passphrase)?;
    let suggested = default_file_name_at(&db.with_conn(local_stamp_now)?);
    let Some(chosen) = dialogs.pick_save(suggested).await? else {
        return Ok(None);
    };
    let destination = with_backup_extension(chosen)?;
    let snapshot = read_export_snapshot(db, session, source)?;
    let sealed =
        seal_in_background(passphrase, kdf, snapshot.schema_version, snapshot.plaintext).await?;
    write_export(db, session, &destination, snapshot.schema_version, &sealed).map(Some)
}

pub(crate) async fn restore_flow(
    db: &Database,
    session: &SessionState,
    source: &BackupSource,
    dialogs: &BackupDialogs,
    passphrase: String,
) -> Result<Option<RestoreResult>, BackupError> {
    db.with_conn_mapped(|conn| authorize_restore(conn, session).map(|_| ()))?;
    let passphrase = BackupPassphrase::new(passphrase)?;
    let Some(chosen) = dialogs.pick_open().await? else {
        return Ok(None);
    };
    let database_path = source.database_path.clone();
    let staged = tauri::async_runtime::spawn_blocking(move || {
        stage_restore(&database_path, &chosen, &passphrase)
    })
    .await
    .map_err(background_failure)??;
    swap_in(db, session, source, staged, &|_| Ok(())).map(Some)
}

#[tauri::command]
#[specta::specta]
pub async fn export_backup(
    passphrase: String,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
    source: State<'_, BackupSource>,
    dialogs: State<'_, BackupDialogs>,
) -> Result<Option<BackupExported>, AppError> {
    Ok(export_flow(
        &db,
        &session,
        &source,
        &dialogs,
        KdfParams::EXPORT,
        passphrase,
    )
    .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn restore_backup(
    passphrase: String,
    db: State<'_, Database>,
    session: State<'_, SessionState>,
    source: State<'_, BackupSource>,
    dialogs: State<'_, BackupDialogs>,
) -> Result<Option<RestoreResult>, AppError> {
    Ok(restore_flow(&db, &session, &source, &dialogs, passphrase).await?)
}

#[tauri::command]
#[specta::specta]
pub fn get_backup_status(
    db: State<'_, Database>,
    session: State<'_, SessionState>,
) -> Result<BackupStatus, AppError> {
    Ok(status::get_backup_status(&db, &session)?)
}

#[cfg(test)]
#[path = "commands_test.rs"]
mod tests;
