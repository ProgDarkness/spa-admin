use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use rusqlite::config::DbConfig;
use rusqlite::Connection;

use super::crypto::{open, BackupPassphrase};
use super::errors::BackupError;
use super::format::{require_acceptable_size, MAX_BACKUP_BYTES};
use super::leftovers::{discard_with_sidecars, path_for, report_cleanup, stamp_now, Leftover};
use crate::db::migrations::supported_version;
use crate::db::snapshot::create_private;
use crate::db::{migrate, open_encrypted, DbError, DbKey};

const DB_KEY_BYTES: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileFingerprint {
    length: u64,
    modified: SystemTime,
}

fn fingerprint_of(path: &Path) -> std::io::Result<FileFingerprint> {
    let metadata = fs::metadata(path)?;
    Ok(FileFingerprint {
        length: metadata.len(),
        modified: metadata.modified()?,
    })
}

pub struct StagedRestore {
    pub(crate) restoring_path: PathBuf,
    pub(crate) key: DbKey,
    pub(crate) source_schema_version: u32,
    fingerprint: FileFingerprint,
}

impl StagedRestore {
    pub(crate) fn require_unchanged(&self) -> Result<(), BackupError> {
        match fingerprint_of(&self.restoring_path) {
            Ok(current) if current == self.fingerprint => Ok(()),
            _ => Err(BackupError::Unreadable),
        }
    }
}

pub(super) fn open_for_verification(path: &Path, key: &DbKey) -> Result<Connection, DbError> {
    let conn = open_encrypted(path, key)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_TRUSTED_SCHEMA, false)?;
    Ok(conn)
}

pub fn stage_restore(
    database_path: &Path,
    backup_path: &Path,
    passphrase: &BackupPassphrase,
) -> Result<StagedRestore, BackupError> {
    stage_restore_within(database_path, backup_path, passphrase, MAX_BACKUP_BYTES)
}

fn stage_restore_within(
    database_path: &Path,
    backup_path: &Path,
    passphrase: &BackupPassphrase,
    size_limit: u64,
) -> Result<StagedRestore, BackupError> {
    require_acceptable_size(fs::metadata(backup_path)?.len())?;
    let opened = {
        let contents = read_bounded(fs::File::open(backup_path)?, size_limit)?;
        open(passphrase, &contents)?
    };
    let (key_bytes, database_bytes) = opened
        .plaintext
        .split_at_checked(DB_KEY_BYTES)
        .ok_or(BackupError::Unreadable)?;
    let key = DbKey::from_hex(hex::encode(key_bytes))?;
    let restoring_path = path_for(database_path, &stamp_now()?, Leftover::Restoring);
    write_private(&restoring_path, database_bytes)?;
    let checked = verify_and_migrate(&restoring_path, &key, opened.header.schema_version);
    if let Err(failure) = checked {
        report_cleanup("staged restore", discard_with_sidecars(&restoring_path));
        return Err(failure);
    }
    let fingerprint = fingerprint_of(&restoring_path)?;
    Ok(StagedRestore {
        restoring_path,
        key,
        source_schema_version: opened.header.schema_version,
        fingerprint,
    })
}

pub(crate) fn read_bounded(reader: impl Read, limit: u64) -> Result<Vec<u8>, BackupError> {
    let mut bytes = Vec::new();
    reader
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(BackupError::NotRecognized);
    }
    Ok(bytes)
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), BackupError> {
    let mut file = create_private(path)?;
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    if let Err(failure) = written {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(failure.into());
    }
    Ok(())
}

fn verify_and_migrate(path: &Path, key: &DbKey, header_version: u32) -> Result<(), BackupError> {
    let mut conn = open_for_verification(path, key).map_err(|_| BackupError::Unreadable)?;
    require_intact(&conn)?;
    require_coherent_version(&conn, header_version)?;
    migrate(&mut conn)?;
    conn.close()
        .map_err(|(_, failure)| crate::db::DbError::from(failure))?;
    Ok(())
}

fn require_intact(conn: &Connection) -> Result<(), BackupError> {
    let verdicts = integrity_verdicts(conn).map_err(|_| BackupError::Unreadable)?;
    let cipher_is_clean = cipher_integrity_is_clean(conn).map_err(|_| BackupError::Unreadable)?;
    if verdicts == ["ok"] && cipher_is_clean {
        Ok(())
    } else {
        Err(BackupError::Unreadable)
    }
}

fn integrity_verdicts(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    conn.prepare("PRAGMA integrity_check")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect()
}

fn cipher_integrity_is_clean(conn: &Connection) -> rusqlite::Result<bool> {
    let mut statement = conn.prepare("PRAGMA cipher_integrity_check")?;
    let mut rows = statement.query([])?;
    Ok(rows.next()?.is_none())
}

fn require_coherent_version(conn: &Connection, header_version: u32) -> Result<(), BackupError> {
    let stored: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| BackupError::Unreadable)?;
    if stored > i64::from(supported_version()) {
        return Err(BackupError::FromNewerApp);
    }
    if stored < 1 || stored != i64::from(header_version) {
        return Err(BackupError::Unreadable);
    }
    Ok(())
}

#[cfg(test)]
#[path = "restore_test.rs"]
mod tests;
