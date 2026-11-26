use std::ffi::OsString;
use std::io;
use std::path::PathBuf;

use rusqlite::Connection;

use super::errors::BackupError;
use crate::db::DbError;

pub const BACKUP_EXTENSION: &str = "spabak";
pub const BACKUP_FILTER_NAME: &str = "Respaldo Spa";
const DEFAULT_NAME_PREFIX: &str = "spa-respaldo-";
const LOCAL_STAMP_SQL: &str = "SELECT strftime('%Y-%m-%d-%H%M', 'now', 'localtime')";

pub fn default_file_name_at(local_stamp: &str) -> String {
    format!("{DEFAULT_NAME_PREFIX}{local_stamp}.{BACKUP_EXTENSION}")
}

pub fn local_stamp_now(conn: &Connection) -> Result<String, DbError> {
    Ok(conn.query_row(LOCAL_STAMP_SQL, [], |row| row.get(0))?)
}

pub fn with_backup_extension(path: PathBuf) -> Result<PathBuf, BackupError> {
    let has_extension = path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case(BACKUP_EXTENSION));
    if has_extension {
        return Ok(path);
    }
    let mut name: OsString = path
        .file_name()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?
        .to_owned();
    name.push(format!(".{BACKUP_EXTENSION}"));
    Ok(path.with_file_name(name))
}

#[cfg(test)]
#[path = "naming_test.rs"]
mod tests;
