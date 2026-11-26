use std::fs;
use std::io;
use std::path::PathBuf;

use super::*;
use crate::db::{open_encrypted, DbError, DbKey};
use crate::features::backup::crypto::BackupPassphrase;
use crate::features::backup::fixture_test::{
    add_user, backup_fixture, current_backup_file, database_bytes, execute,
    hot_journal_truncating_to_one_page, sidecar_path, sign_in_as, source_with_marker,
    stored_key_bytes, BackupFixture, MARKER_USER, OWNER, PASSPHRASE,
};
use crate::features::backup::leftovers::{find, path_for, Leftover};
use crate::features::backup::restore::stage_restore;
use crate::features::backup::swap::{swap_in, SwapStep};
use crate::keystore::PENDING_KEY_ACCOUNT;
use crate::test_support::isolated_store;

const STAMP: &str = "0000000000000007";

fn interrupted_at(failing: &'static [SwapStep]) -> (BackupFixture, BackupFixture, Vec<u8>) {
    let source = source_with_marker();
    let target = backup_fixture();
    sign_in_as(&target, OWNER);
    let file = current_backup_file(&source, "respaldo.spabak");
    let original_database = database_bytes(&target);
    let staged = stage_restore(
        &target.source.database_path,
        &file,
        &BackupPassphrase::new(PASSPHRASE.to_string()).unwrap(),
    )
    .unwrap();
    let outcome = swap_in(
        &target.database,
        &target.session,
        &target.source,
        staged,
        &|step| {
            if failing.contains(&step) {
                Err(io::Error::other("corte"))
            } else {
                Ok(())
            }
        },
    );
    assert!(outcome.is_err());
    (source, target, original_database)
}

fn recover(target: &BackupFixture) -> Result<(), BackupError> {
    recover_interrupted_restore(&target.source.database_path, &target.source.key_store)
}

fn write_malformed_pending(target: &BackupFixture) {
    keyring_core::Entry::new(target.source.key_store.service_name(), PENDING_KEY_ACCOUNT)
        .unwrap()
        .set_password("not-a-key")
        .unwrap();
}

fn main_key(target: &BackupFixture) -> DbKey {
    DbKey::from_hex(hex::encode(stored_key_bytes(target))).unwrap()
}

fn user_named(target: &BackupFixture, username: &str) -> i64 {
    let conn = open_encrypted(&target.source.database_path, &main_key(target)).unwrap();
    conn.query_row(
        "SELECT count(*) FROM users WHERE username = ?1",
        [username],
        |row| row.get(0),
    )
    .unwrap()
}

fn backup_audit_rows_on_disk(target: &BackupFixture) -> Vec<String> {
    let conn = open_encrypted(&target.source.database_path, &main_key(target)).unwrap();
    let mut statement = conn
        .prepare("SELECT action FROM audit_log WHERE action = 'backup_restored'")
        .unwrap();
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    rows
}

fn data_dir_names(target: &BackupFixture) -> Vec<String> {
    let directory = target.source.database_path.parent().unwrap();
    let mut names: Vec<String> = fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn case_a_a_missing_database_with_a_previous_copy_gets_the_previous_copy_back() {
    let (_source, target, original) =
        interrupted_at(&[SwapStep::InstallRestored, SwapStep::Rollback]);
    assert!(!target.source.database_path.exists());

    recover(&target).unwrap();

    assert_eq!(database_bytes(&target), original);
    assert_eq!(user_named(&target, OWNER), 1);
    assert_eq!(user_named(&target, MARKER_USER), 0);
    assert_eq!(data_dir_names(&target), ["spa.db"]);
    assert!(target.source.key_store.read_pending().unwrap().is_none());
}

#[test]
fn case_b_a_database_that_only_opens_with_the_pending_key_promotes_it() {
    let (source, target, _) = interrupted_at(&[SwapStep::PromoteKey, SwapStep::Rollback]);
    let old_key = stored_key_bytes(&target);
    assert_ne!(old_key, stored_key_bytes(&source));

    recover(&target).unwrap();

    assert_eq!(stored_key_bytes(&target), stored_key_bytes(&source));
    assert!(target.source.key_store.read_pending().unwrap().is_none());
    assert_eq!(user_named(&target, MARKER_USER), 1);
    assert_eq!(data_dir_names(&target), ["spa.db"]);
    assert!(find(&target.source.database_path, Leftover::Failed)
        .unwrap()
        .is_empty());
}

#[test]
fn case_c_a_database_that_opens_with_no_key_is_replaced_by_the_previous_copy() {
    let (_source, target, original) =
        interrupted_at(&[SwapStep::VerifyAndAudit, SwapStep::Rollback]);
    fs::write(&target.source.database_path, b"basura que no abre").unwrap();

    recover(&target).unwrap();

    assert_eq!(database_bytes(&target), original);
    assert_eq!(user_named(&target, MARKER_USER), 0);
    assert!(target.source.key_store.read_pending().unwrap().is_none());
    let failed = find(&target.source.database_path, Leftover::Failed).unwrap();
    assert_eq!(failed.len(), 1);
    assert_eq!(fs::read(&failed[0]).unwrap(), b"basura que no abre");
    assert!(find(&target.source.database_path, Leftover::Prev)
        .unwrap()
        .is_empty());
}

#[test]
fn case_d_a_healthy_database_drops_every_leftover_and_the_stale_pending_key() {
    let target = backup_fixture();
    let before = database_bytes(&target);
    let database = &target.source.database_path;
    target
        .source
        .key_store
        .write_pending(&DbKey::generate().unwrap())
        .unwrap();
    fs::write(path_for(database, STAMP, Leftover::Prev), b"viejo").unwrap();
    fs::write(path_for(database, STAMP, Leftover::Restoring), b"temporal").unwrap();

    recover(&target).unwrap();

    assert_eq!(data_dir_names(&target), ["spa.db"]);
    assert!(target.source.key_store.read_pending().unwrap().is_none());
    assert_eq!(database_bytes(&target), before);
}

#[test]
fn case_d_keeps_a_failed_copy_for_the_user() {
    let target = backup_fixture();
    let database = &target.source.database_path;
    let failed: PathBuf = path_for(database, STAMP, Leftover::Failed);
    fs::write(&failed, b"evidencia").unwrap();

    recover(&target).unwrap();

    assert_eq!(fs::read(&failed).unwrap(), b"evidencia");
}

#[test]
fn a_clean_data_directory_is_left_exactly_as_it_was() {
    let target = backup_fixture();
    let names_before = data_dir_names(&target);
    let before = database_bytes(&target);
    let key_before = stored_key_bytes(&target);

    recover(&target).unwrap();

    assert_eq!(data_dir_names(&target), names_before);
    assert_eq!(database_bytes(&target), before);
    assert_eq!(stored_key_bytes(&target), key_before);
}

#[test]
fn a_first_install_with_no_database_and_no_keys_creates_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let store = isolated_store();

    recover_interrupted_restore(&dir.path().join("spa.db"), &store).unwrap();

    assert!(fs::read_dir(dir.path()).unwrap().next().is_none());
    assert!(store.read().unwrap().is_none());
    assert!(store.read_pending().unwrap().is_none());
}

#[test]
fn an_unreadable_database_without_a_previous_copy_is_left_for_the_normal_startup_to_report() {
    let target = backup_fixture();
    fs::write(&target.source.database_path, b"basura").unwrap();

    recover(&target).unwrap();

    assert_eq!(database_bytes(&target), b"basura");
    assert!(find(&target.source.database_path, Leftover::Failed)
        .unwrap()
        .is_empty());
}

#[test]
fn the_newest_previous_copy_wins_when_there_are_several() {
    let target = backup_fixture();
    let database = target.source.database_path.clone();
    let original = database_bytes(&target);
    fs::rename(
        &database,
        path_for(&database, "0000000000000009", Leftover::Prev),
    )
    .unwrap();
    fs::write(
        path_for(&database, "0000000000000001", Leftover::Prev),
        b"mas viejo",
    )
    .unwrap();

    recover(&target).unwrap();

    assert_eq!(database_bytes(&target), original);
    assert_eq!(data_dir_names(&target), ["spa.db"]);
}

#[test]
fn a_malformed_pending_key_does_not_block_recovery_of_a_healthy_database() {
    let target = backup_fixture();
    write_malformed_pending(&target);
    let before = database_bytes(&target);

    recover(&target).unwrap();

    assert_eq!(database_bytes(&target), before);
    assert!(target.source.key_store.read_pending().unwrap().is_none());
}

#[test]
fn a_malformed_pending_key_counts_as_absent_when_the_database_needs_a_rollback() {
    let (_source, target, original) =
        interrupted_at(&[SwapStep::VerifyAndAudit, SwapStep::Rollback]);
    fs::write(&target.source.database_path, b"basura que no abre").unwrap();
    write_malformed_pending(&target);

    recover(&target).unwrap();

    assert_eq!(database_bytes(&target), original);
    assert!(target.source.key_store.read_pending().unwrap().is_none());
}

#[test]
fn a_database_that_cannot_be_opened_for_a_reason_other_than_the_key_is_never_moved() {
    let (_source, target, _) = interrupted_at(&[SwapStep::InstallRestored, SwapStep::Rollback]);
    let database = target.source.database_path.clone();
    fs::create_dir(&database).unwrap();

    let outcome = recover(&target);

    assert!(matches!(outcome, Err(BackupError::Db(DbError::Sqlite(_)))));
    assert!(database.is_dir());
    assert_eq!(find(&database, Leftover::Prev).unwrap().len(), 1);
    assert!(find(&database, Leftover::Failed).unwrap().is_empty());
    assert!(target.source.key_store.read_pending().unwrap().is_some());
}

#[test]
fn a_previous_copy_that_does_not_open_with_the_main_key_is_not_rolled_back_to() {
    let (_source, target, _) = interrupted_at(&[SwapStep::VerifyAndAudit, SwapStep::Rollback]);
    let database = target.source.database_path.clone();
    fs::write(&database, b"basura que no abre").unwrap();
    let previous = find(&database, Leftover::Prev).unwrap().remove(0);
    fs::write(&previous, b"copia ilegible").unwrap();

    let outcome = recover(&target);

    assert!(matches!(
        outcome,
        Err(BackupError::Db(DbError::NotADatabase))
    ));
    assert_eq!(fs::read(&database).unwrap(), b"basura que no abre");
    assert_eq!(fs::read(&previous).unwrap(), b"copia ilegible");
    assert!(find(&database, Leftover::Failed).unwrap().is_empty());
}

#[test]
fn a_malformed_pending_key_is_discarded_even_when_nothing_else_can_be_recovered() {
    let target = backup_fixture();
    fs::write(&target.source.database_path, b"basura").unwrap();
    write_malformed_pending(&target);

    recover(&target).unwrap();

    assert!(target.source.key_store.read_pending().unwrap().is_none());
    assert_eq!(database_bytes(&target), b"basura");
}

#[test]
fn case_d_also_drops_the_journal_and_wal_files_orphaned_by_an_interrupted_restore() {
    let target = backup_fixture();
    let database = &target.source.database_path;
    let restoring = path_for(database, STAMP, Leftover::Restoring);
    let previous = path_for(database, STAMP, Leftover::Prev);
    for sidecar in [
        format!("{}-journal", restoring.display()),
        format!("{}-wal", restoring.display()),
        format!("{}-shm", restoring.display()),
        format!("{}-journal", previous.display()),
    ] {
        fs::write(sidecar, b"huerfano").unwrap();
    }

    recover(&target).unwrap();

    assert_eq!(data_dir_names(&target), ["spa.db"]);
}

#[test]
fn case_d_with_a_restore_cut_after_install_and_an_unchanged_key_keeps_the_restored_data_unaudited()
{
    let target = backup_fixture();
    add_user(&target.database, MARKER_USER, 1);
    sign_in_as(&target, OWNER);
    let file = current_backup_file(&target, "mismo-origen.spabak");
    execute(
        &target,
        &format!("DELETE FROM users WHERE username = '{MARKER_USER}'"),
    );
    let staged = stage_restore(
        &target.source.database_path,
        &file,
        &BackupPassphrase::new(PASSPHRASE.to_string()).unwrap(),
    )
    .unwrap();
    swap_in(
        &target.database,
        &target.session,
        &target.source,
        staged,
        &|step| match step {
            SwapStep::VerifyAndAudit | SwapStep::Rollback => Err(io::Error::other("corte")),
            _ => Ok(()),
        },
    )
    .unwrap_err();
    let key_before = stored_key_bytes(&target);

    recover(&target).unwrap();

    assert_eq!(stored_key_bytes(&target), key_before);
    assert_eq!(user_named(&target, MARKER_USER), 1);
    assert_eq!(data_dir_names(&target), ["spa.db"]);
    assert!(target.source.key_store.read_pending().unwrap().is_none());
    assert!(backup_audit_rows_on_disk(&target).is_empty());
}

#[test]
fn rolling_back_discards_the_hot_journal_of_the_failed_database_before_the_old_one_returns() {
    let (_source, target, original) =
        interrupted_at(&[SwapStep::VerifyAndAudit, SwapStep::Rollback]);
    let database = target.source.database_path.clone();
    fs::write(&database, b"basura que no abre").unwrap();
    let journal = sidecar_path(&database, "-journal");
    fs::write(&journal, hot_journal_truncating_to_one_page()).unwrap();
    let previous = find(&database, Leftover::Prev).unwrap().remove(0);
    let main = target.source.key_store.read().unwrap();

    roll_back_to(
        &database,
        &previous,
        main.as_ref(),
        &target.source.key_store,
    )
    .unwrap();

    assert!(!journal.exists());
    assert!(database_bytes(&target) == original);
    assert_eq!(user_named(&target, OWNER), 1);
    assert_eq!(user_named(&target, MARKER_USER), 0);
}

#[test]
fn case_a_discards_a_hot_journal_orphaned_beside_the_missing_database() {
    let (_source, target, original) =
        interrupted_at(&[SwapStep::InstallRestored, SwapStep::Rollback]);
    let journal = sidecar_path(&target.source.database_path, "-journal");
    fs::write(&journal, hot_journal_truncating_to_one_page()).unwrap();

    recover(&target).unwrap();

    assert!(!journal.exists());
    assert!(database_bytes(&target) == original);
    assert_eq!(user_named(&target, OWNER), 1);
}
