use std::ffi::OsStr;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use thiserror::Error;

use super::migrations::supported_version;
use super::DbError;

pub const SNAPSHOT_RETENTION: usize = 3;

#[cfg(unix)]
pub const SNAPSHOT_MODE: u32 = 0o600;

const SNAPSHOT_EXTENSION: &str = ".bak";
const STAMP_DIGITS: usize = 16;

#[derive(Debug, Error)]
pub enum SnapshotError {
    #[error("snapshot failed")]
    Io(#[from] io::Error),
}

pub fn pending_from(conn: &Connection) -> Result<Option<i64>, DbError> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let is_pending = current >= 1 && current < i64::from(supported_version());
    Ok(is_pending.then_some(current))
}

pub fn snapshot_before_migrate(
    database_path: &Path,
    from_version: i64,
) -> Result<PathBuf, SnapshotError> {
    let epoch_millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_millis();
    snapshot_at(database_path, from_version, epoch_millis)
}

fn snapshot_at(
    database_path: &Path,
    from_version: i64,
    epoch_millis: u128,
) -> Result<PathBuf, SnapshotError> {
    let file_name = file_name_of(database_path)?;
    let target = database_path.with_file_name(format!(
        "{file_name}.{epoch_millis:0width$}.v{from_version}{SNAPSHOT_EXTENSION}",
        width = STAMP_DIGITS
    ));
    copy_exclusive(database_path, &target)?;
    prune_old_snapshots(&target, &file_name);
    Ok(target)
}

fn file_name_of(path: &Path) -> io::Result<String> {
    path.file_name()
        .and_then(OsStr::to_str)
        .map(str::to_owned)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid database path"))
}

fn copy_exclusive(source: &Path, target: &Path) -> io::Result<()> {
    let mut destination = create_private(target)?;
    let outcome = copy_and_sync(source, &mut destination);
    if outcome.is_err() {
        drop(destination);
        let _ = fs::remove_file(target);
    }
    outcome
}

fn copy_and_sync(source: &Path, destination: &mut File) -> io::Result<()> {
    let mut input = File::open(source)?;
    io::copy(&mut input, destination)?;
    destination.sync_all()
}

#[cfg(unix)]
fn create_private(path: &Path) -> io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(SNAPSHOT_MODE)
        .open(path)
}

#[cfg(not(unix))]
fn create_private(path: &Path) -> io::Result<File> {
    OpenOptions::new().write(true).create_new(true).open(path)
}

fn prune_old_snapshots(newest: &Path, database_file_name: &str) {
    let directory = newest.parent().unwrap_or_else(|| Path::new("."));
    match stale_snapshots(directory, database_file_name, newest) {
        Ok(stale) => stale.iter().for_each(|path| {
            if let Err(failure) = fs::remove_file(path) {
                eprintln!("snapshot prune failed: {}", failure.kind());
            }
        }),
        Err(failure) => eprintln!("snapshot prune failed: {}", failure.kind()),
    }
}

fn stale_snapshots(
    directory: &Path,
    database_file_name: &str,
    newest: &Path,
) -> io::Result<Vec<PathBuf>> {
    let prefix = format!("{database_file_name}.");
    let mut snapshots = fs::read_dir(directory)?
        .map(|entry| entry.map(|found| found.path()))
        .collect::<io::Result<Vec<PathBuf>>>()?
        .into_iter()
        .filter(|path| path != newest && is_snapshot_name(path, &prefix))
        .collect::<Vec<PathBuf>>();
    snapshots.sort();
    let stale_count = snapshots
        .len()
        .saturating_sub(SNAPSHOT_RETENTION.saturating_sub(1));
    snapshots.truncate(stale_count);
    Ok(snapshots)
}

fn is_snapshot_name(path: &Path, prefix: &str) -> bool {
    path.file_name()
        .and_then(OsStr::to_str)
        .and_then(|name| name.strip_prefix(prefix))
        .and_then(|rest| rest.strip_suffix(SNAPSHOT_EXTENSION))
        .is_some_and(is_stamp_and_version)
}

fn is_stamp_and_version(rest: &str) -> bool {
    let Some((stamp, version)) = rest.split_once(".v") else {
        return false;
    };
    stamp.len() == STAMP_DIGITS
        && stamp.bytes().all(|byte| byte.is_ascii_digit())
        && !version.is_empty()
        && version.bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg(test)]
#[path = "snapshot_test.rs"]
mod tests;
