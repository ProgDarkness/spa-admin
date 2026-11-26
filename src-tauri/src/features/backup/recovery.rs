use std::fs;
use std::path::{Path, PathBuf};

use super::errors::BackupError;
use super::leftovers::{
    discard_with_sidecars, find, find_sidecars, path_for, report_cleanup, stamp_now, Leftover,
};
use crate::db::{open_encrypted, DbError, DbKey};
use crate::keystore::{KeyStore, KeyStoreError};

pub fn recover_interrupted_restore(
    database_path: &Path,
    store: &KeyStore,
) -> Result<(), BackupError> {
    let mut previous = find(database_path, Leftover::Prev)?.pop();
    if !database_path.exists() {
        let Some(copy) = previous.take() else {
            return Ok(());
        };
        fs::rename(copy, database_path)?;
    }
    let main = store.read()?;
    if opens_with(database_path, main.as_ref())? {
        return clean_up(database_path, store);
    }
    let pending = read_pending_or_discard(store)?;
    if opens_with(database_path, pending.as_ref())? {
        store.promote_pending()?;
        return clean_up(database_path, store);
    }
    match previous {
        Some(copy) => roll_back_to(database_path, &copy, main.as_ref(), store),
        None => Ok(()),
    }
}

fn read_pending_or_discard(store: &KeyStore) -> Result<Option<DbKey>, BackupError> {
    match store.read_pending() {
        Err(KeyStoreError::Malformed) => {
            store.delete_pending()?;
            Ok(None)
        }
        other => Ok(other?),
    }
}

fn opens_with(database_path: &Path, key: Option<&DbKey>) -> Result<bool, BackupError> {
    let Some(candidate) = key else {
        return Ok(false);
    };
    match open_encrypted(database_path, candidate) {
        Ok(_) => Ok(true),
        Err(DbError::NotADatabase) => Ok(false),
        Err(other) => Err(other.into()),
    }
}

fn roll_back_to(
    database_path: &Path,
    previous: &PathBuf,
    main: Option<&DbKey>,
    store: &KeyStore,
) -> Result<(), BackupError> {
    if !opens_with(previous, main)? {
        return Err(DbError::NotADatabase.into());
    }
    let failed = path_for(database_path, &stamp_now()?, Leftover::Failed);
    fs::rename(database_path, failed)?;
    fs::rename(previous, database_path)?;
    store.delete_pending()?;
    clean_up(database_path, store)
}

fn clean_up(database_path: &Path, store: &KeyStore) -> Result<(), BackupError> {
    store.delete_pending()?;
    for kind in [Leftover::Prev, Leftover::Restoring] {
        for path in find(database_path, kind)? {
            report_cleanup("restore leftover", discard_with_sidecars(&path));
        }
        for path in find_sidecars(database_path, kind)? {
            report_cleanup("restore leftover", fs::remove_file(path));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "recovery_test.rs"]
mod tests;
