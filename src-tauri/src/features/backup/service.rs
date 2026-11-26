use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, Transaction};
use serde_json::json;
use zeroize::Zeroizing;

use super::crypto::{seal, BackupPassphrase};
use super::errors::BackupError;
use super::format::{KdfParams, HEADER_LEN, MAX_BACKUP_BYTES};
use super::leftovers::report_cleanup;
use super::model::{BackupExported, BackupSource};
use crate::db::migrations::supported_version;
use crate::db::snapshot::create_private;
use crate::db::{Database, DbError};
use crate::features::audit::repository::find_by_id;
use crate::features::audit::{self, AuditAction, AuditEntity, Diff, NewAuditEntry};
use crate::features::auth::model::{PermissionKey, SessionUser};
use crate::features::auth::service::{require_permission, Beat, SessionState};
use crate::keystore::KeyStoreError;

const DB_KEY_BYTES: usize = 32;
const AEAD_TAG_BYTES: u64 = 16;
const SIBLING_SUFFIX_BYTES: usize = 8;
const PARTIAL_TAG: &str = "partial";
const REPLACED_TAG: &str = "replaced";
const NAME_MAX_BYTES: usize = 255;
const SCHEMA_VERSION_FIELD: &str = "schemaVersion";
const FILE_NAME_FIELD: &str = "fileName";

pub struct ExportSnapshot {
    pub schema_version: u32,
    pub plaintext: Zeroizing<Vec<u8>>,
}

pub(super) fn authorize(
    conn: &Connection,
    session: &SessionState,
) -> Result<SessionUser, BackupError> {
    Ok(require_permission(
        conn,
        session,
        PermissionKey::BackupManage,
        Beat::now(),
    )?)
}

fn current_schema_version(conn: &Connection) -> Result<u32, BackupError> {
    let stored: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(DbError::from)?;
    u32::try_from(stored)
        .ok()
        .filter(|version| (1..=supported_version()).contains(version))
        .ok_or(BackupError::Db(DbError::SchemaNewerThanApp {
            found: stored,
            supported: supported_version(),
        }))
}

fn require_fits_in_a_backup(database_bytes: u64) -> Result<(), BackupError> {
    let total = HEADER_LEN as u64 + DB_KEY_BYTES as u64 + database_bytes + AEAD_TAG_BYTES;
    if total > MAX_BACKUP_BYTES {
        Err(BackupError::TooLarge)
    } else {
        Ok(())
    }
}

fn database_key_bytes(source: &BackupSource) -> Result<Zeroizing<Vec<u8>>, BackupError> {
    let key = source
        .key_store
        .read()?
        .ok_or(KeyStoreError::MissingForExistingDb)?;
    Ok(Zeroizing::new(
        hex::decode(key.as_hex()).map_err(|_| KeyStoreError::Malformed)?,
    ))
}

fn plaintext_of(source: &BackupSource) -> Result<Zeroizing<Vec<u8>>, BackupError> {
    let key = database_key_bytes(source)?;
    require_fits_in_a_backup(fs::metadata(&source.database_path)?.len())?;
    let database_bytes = fs::read(&source.database_path)?;
    let mut plaintext = Zeroizing::new(Vec::with_capacity(key.len() + database_bytes.len()));
    plaintext.extend_from_slice(&key);
    plaintext.extend_from_slice(&database_bytes);
    Ok(plaintext)
}

pub fn read_export_snapshot(
    db: &Database,
    session: &SessionState,
    source: &BackupSource,
) -> Result<ExportSnapshot, BackupError> {
    db.with_conn_mapped(|conn| {
        authorize(conn, session)?;
        Ok(ExportSnapshot {
            schema_version: current_schema_version(conn)?,
            plaintext: plaintext_of(source)?,
        })
    })
}

fn sibling_path_for(destination: &Path, tag: &str) -> Result<PathBuf, BackupError> {
    let mut suffix = [0u8; SIBLING_SUFFIX_BYTES];
    getrandom::fill(&mut suffix).map_err(|_| BackupError::Crypto)?;
    let tail = format!(".{tag}-{}", hex::encode(suffix));
    let name = destination
        .file_name()
        .ok_or_else(|| std::io::Error::from(std::io::ErrorKind::InvalidInput))?
        .to_string_lossy();
    let base = truncated_on_char_boundary(&name, NAME_MAX_BYTES.saturating_sub(tail.len()));
    Ok(destination.with_file_name(format!("{base}{tail}")))
}

fn truncated_on_char_boundary(text: &str, max_bytes: usize) -> &str {
    let mut end = max_bytes.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

fn partial_path_for(destination: &Path) -> Result<PathBuf, BackupError> {
    sibling_path_for(destination, PARTIAL_TAG)
}

fn write_partial(destination: &Path, sealed: &[u8]) -> Result<PathBuf, BackupError> {
    let partial = partial_path_for(destination)?;
    let mut file = create_private(&partial)?;
    let written = file.write_all(sealed).and_then(|()| file.sync_all());
    if let Err(failure) = written {
        drop(file);
        let _ = fs::remove_file(&partial);
        return Err(failure.into());
    }
    Ok(partial)
}

fn file_name_of(destination: &Path) -> String {
    destination
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn audit_export(
    tx: &Transaction<'_>,
    actor: &SessionUser,
    schema_version: u32,
    file_name: &str,
) -> Result<BackupExported, BackupError> {
    let entry = NewAuditEntry {
        actor_user_id: Some(actor.id),
        action: AuditAction::BackupCreated,
        entity: AuditEntity::System,
        entity_id: None,
        diff: Diff::created(&json!({
            SCHEMA_VERSION_FIELD: schema_version,
            FILE_NAME_FIELD: file_name,
        })),
    };
    let audit_id = audit::record(tx, &entry)?;
    let recorded =
        find_by_id(tx, audit_id)?.ok_or(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))?;
    Ok(BackupExported {
        file_name: file_name.to_string(),
        created_at: recorded.occurred_at,
    })
}

#[derive(Default)]
struct Placement {
    displaced: Option<PathBuf>,
    moved_into_place: bool,
}

fn displace_existing(destination: &Path) -> Result<Option<PathBuf>, BackupError> {
    if fs::symlink_metadata(destination).is_err() {
        return Ok(None);
    }
    let displaced = sibling_path_for(destination, REPLACED_TAG)?;
    fs::rename(destination, &displaced)?;
    Ok(Some(displaced))
}

fn settle_placement(placement: Placement, destination: &Path, partial: &Path, committed: bool) {
    if committed {
        if let Some(displaced) = placement.displaced {
            report_cleanup("replaced backup", fs::remove_file(displaced));
        }
        return;
    }
    if !placement.moved_into_place {
        report_cleanup("partial backup", fs::remove_file(partial));
    }
    match placement.displaced {
        Some(displaced) => report_cleanup("previous backup", fs::rename(displaced, destination)),
        None if placement.moved_into_place => {
            report_cleanup("unconfirmed backup", fs::remove_file(destination))
        }
        None => {}
    }
}

pub fn write_export(
    db: &Database,
    session: &SessionState,
    destination: &Path,
    schema_version: u32,
    sealed: &[u8],
) -> Result<BackupExported, BackupError> {
    let partial = write_partial(destination, sealed)?;
    let file_name = file_name_of(destination);
    let mut placement = Placement::default();
    let outcome = db.with_tx(|tx| {
        let actor = authorize(tx, session)?;
        let exported = audit_export(tx, &actor, schema_version, &file_name)?;
        placement.displaced = displace_existing(destination)?;
        fs::rename(&partial, destination)?;
        placement.moved_into_place = true;
        Ok(exported)
    });
    settle_placement(placement, destination, &partial, outcome.is_ok());
    outcome
}

pub fn export_to(
    db: &Database,
    session: &SessionState,
    source: &BackupSource,
    passphrase: &BackupPassphrase,
    destination: &Path,
) -> Result<BackupExported, BackupError> {
    export_with_kdf(
        db,
        session,
        source,
        passphrase,
        destination,
        KdfParams::EXPORT,
    )
}

fn export_with_kdf(
    db: &Database,
    session: &SessionState,
    source: &BackupSource,
    passphrase: &BackupPassphrase,
    destination: &Path,
    kdf: KdfParams,
) -> Result<BackupExported, BackupError> {
    let snapshot = read_export_snapshot(db, session, source)?;
    let sealed = seal(
        passphrase,
        kdf,
        snapshot.schema_version,
        &snapshot.plaintext,
    )?;
    write_export(db, session, destination, snapshot.schema_version, &sealed)
}

#[cfg(test)]
#[path = "service_test.rs"]
mod tests;
