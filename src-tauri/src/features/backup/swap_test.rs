use std::fs;
use std::io;

use super::*;
use crate::db::migrations::supported_version;
use crate::db::{open_encrypted, DbError, DbKey};
use crate::features::auth::service::AuthError;
use crate::features::backup::crypto::BackupPassphrase;
use crate::features::backup::fixture_test::{
    assert_untouched, backup_audit_rows, backup_fixture, current_backup_file, execute,
    first_run_fixture, sign_in_as, snapshot_of, source_with_marker, stored_key_bytes,
    BackupFixture, Untouched, MARKER_USER, OWNER, PASSPHRASE, RECEPTION,
};
use crate::features::backup::leftovers::{find, Leftover};
use crate::features::backup::recovery::recover_interrupted_restore;
use crate::features::backup::restore::{stage_restore, StagedRestore};

const SNAPSHOT_NAME: &str = "spa.db.0000000000000001.v2.bak";
const STEPS_BEFORE_ROLLBACK: [SwapStep; 6] = [
    SwapStep::SavePendingKey,
    SwapStep::CloseLiveConnection,
    SwapStep::MoveCurrentAside,
    SwapStep::InstallRestored,
    SwapStep::VerifyAndAudit,
    SwapStep::PromoteKey,
];

fn passphrase() -> BackupPassphrase {
    BackupPassphrase::new(PASSPHRASE.to_string()).unwrap()
}

pub(super) fn no_failure(_: SwapStep) -> io::Result<()> {
    Ok(())
}

pub(super) fn failing_at(steps: &'static [SwapStep]) -> impl Fn(SwapStep) -> io::Result<()> {
    move |step| {
        if steps.contains(&step) {
            Err(io::Error::other("injected"))
        } else {
            Ok(())
        }
    }
}

pub(super) fn restore(
    target: &BackupFixture,
    file: &std::path::Path,
    inject: &dyn Fn(SwapStep) -> io::Result<()>,
) -> Result<RestoreResult, BackupError> {
    let staged = stage_restore(&target.source.database_path, file, &passphrase()).unwrap();
    swap_in(
        &target.database,
        &target.session,
        &target.source,
        staged,
        inject,
    )
}

pub(super) struct Scenario {
    pub(super) source: BackupFixture,
    pub(super) target: BackupFixture,
    pub(super) file: std::path::PathBuf,
    pub(super) before: Untouched,
}

pub(super) fn scenario() -> Scenario {
    let source = source_with_marker();
    let target = backup_fixture();
    sign_in_as(&target, OWNER);
    let file = current_backup_file(&source, "respaldo.spabak");
    let before = snapshot_of(&target);
    Scenario {
        source,
        target,
        file,
        before,
    }
}

fn count_users(target: &BackupFixture, where_clause: &str) -> i64 {
    target
        .database
        .with_conn(|conn| {
            Ok(conn.query_row(
                &format!("SELECT count(*) FROM users WHERE {where_clause}"),
                [],
                |row| row.get(0),
            )?)
        })
        .unwrap()
}

fn marker_count(target: &BackupFixture) -> i64 {
    count_users(target, &format!("username = '{MARKER_USER}'"))
}

pub(super) fn assert_old_state_intact_and_served(target: &BackupFixture, before: &Untouched) {
    assert_untouched(target, before);
    assert!(find(&target.source.database_path, Leftover::Prev)
        .unwrap()
        .is_empty());
    assert_eq!(marker_count(target), 0);
    assert_eq!(count_users(target, "1 = 1"), 2);
    target
        .database
        .with_tx(|tx| {
            Ok::<_, DbError>(
                tx.query_row("SELECT count(*) FROM roles", [], |r| r.get::<_, i64>(0))?,
            )
        })
        .unwrap();
}

fn fails_and_restores_old_state(step: SwapStep) {
    let scenario = scenario();
    let steps: &'static [SwapStep] = Box::leak(Box::new([step]));

    let outcome = restore(&scenario.target, &scenario.file, &failing_at(steps));

    assert!(
        matches!(outcome, Err(BackupError::Io(_))),
        "{step:?}: {outcome:?}"
    );
    assert_old_state_intact_and_served(&scenario.target, &scenario.before);
    assert!(scenario.target.session.current_user_id().unwrap().is_some());
}

#[test]
fn a_failure_saving_the_pending_key_leaves_the_old_state() {
    fails_and_restores_old_state(SwapStep::SavePendingKey);
}

#[test]
fn a_failure_closing_the_live_connection_leaves_the_old_state() {
    fails_and_restores_old_state(SwapStep::CloseLiveConnection);
}

#[test]
fn a_failure_moving_the_current_database_aside_leaves_the_old_state() {
    fails_and_restores_old_state(SwapStep::MoveCurrentAside);
}

#[test]
fn a_failure_installing_the_restored_database_leaves_the_old_state() {
    fails_and_restores_old_state(SwapStep::InstallRestored);
}

#[test]
fn a_failure_verifying_the_restored_database_leaves_the_old_state() {
    fails_and_restores_old_state(SwapStep::VerifyAndAudit);
}

#[test]
fn a_failure_promoting_the_key_leaves_the_old_state() {
    fails_and_restores_old_state(SwapStep::PromoteKey);
}

#[test]
fn a_promotion_that_already_wrote_the_new_key_gets_the_old_key_back() {
    let scenario = scenario();
    let new_key = DbKey::from_hex(hex::encode(stored_key_bytes(&scenario.source))).unwrap();
    let key_store = &scenario.target.source.key_store;
    let partial_promotion = |step: SwapStep| {
        if step == SwapStep::PromoteKey {
            key_store.write(&new_key).unwrap();
            Err(io::Error::other("injected"))
        } else {
            Ok(())
        }
    };

    let outcome = restore(&scenario.target, &scenario.file, &partial_promotion);

    assert!(matches!(outcome, Err(BackupError::Io(_))));
    assert_old_state_intact_and_served(&scenario.target, &scenario.before);
}

#[test]
fn a_failed_swap_still_accepts_writes_on_the_old_database() {
    let scenario = scenario();
    restore(
        &scenario.target,
        &scenario.file,
        &failing_at(&[SwapStep::VerifyAndAudit]),
    )
    .unwrap_err();

    execute(&scenario.target, "CREATE TABLE sobrevivio (id INTEGER)");

    let tables: i64 = scenario
        .target
        .database
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT count(*) FROM sqlite_master WHERE name = 'sobrevivio'",
                [],
                |row| row.get(0),
            )?)
        })
        .unwrap();
    assert_eq!(tables, 1);
}

#[test]
fn a_successful_swap_replaces_the_database_and_the_key_and_ends_the_session() {
    let scenario = scenario();

    let result = restore(&scenario.target, &scenario.file, &no_failure).unwrap();

    assert_eq!(
        result,
        RestoreResult {
            source_schema_version: supported_version(),
            schema_version: supported_version(),
        }
    );
    assert_eq!(marker_count(&scenario.target), 1);
    assert_eq!(
        stored_key_bytes(&scenario.target),
        stored_key_bytes(&scenario.source)
    );
    assert!(scenario
        .target
        .source
        .key_store
        .read_pending()
        .unwrap()
        .is_none());
    assert_eq!(scenario.target.session.current_user_id().unwrap(), None);
}

#[test]
fn after_the_swap_the_user_of_the_backup_can_sign_in_and_transactions_work() {
    let scenario = scenario();
    restore(&scenario.target, &scenario.file, &no_failure).unwrap();

    let signed_in = sign_in_as(&scenario.target, MARKER_USER);

    assert!(signed_in > 0);
    scenario
        .target
        .database
        .with_tx(|tx| Ok::<_, DbError>(tx.execute("UPDATE users SET username = username", [])?))
        .unwrap();
}

#[test]
fn the_restored_file_on_disk_opens_with_the_key_in_the_keychain() {
    let scenario = scenario();
    restore(&scenario.target, &scenario.file, &no_failure).unwrap();

    let key = scenario.target.source.key_store.read().unwrap().unwrap();
    let conn = open_encrypted(&scenario.target.source.database_path, &key).unwrap();

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, i64::from(supported_version()));
}

#[test]
fn the_restore_is_audited_in_the_new_database_without_an_actor() {
    let scenario = scenario();

    restore(&scenario.target, &scenario.file, &no_failure).unwrap();

    let rows = backup_audit_rows(&scenario.target, "backup_restored");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].actor_user_id, None);
    let diff: serde_json::Value = serde_json::from_str(rows[0].diff.as_ref().unwrap()).unwrap();
    assert_eq!(diff["restoredBy"], OWNER);
    assert_eq!(diff["sourceSchemaVersion"], supported_version());
    assert_eq!(diff["schemaVersion"], supported_version());
    assert_eq!(diff.as_object().unwrap().len(), 3);
}

#[test]
fn a_successful_swap_removes_the_old_database_copy_and_old_snapshots() {
    let scenario = scenario();
    let data_dir = scenario
        .target
        .source
        .database_path
        .parent()
        .unwrap()
        .to_path_buf();
    fs::write(data_dir.join(SNAPSHOT_NAME), b"viejo").unwrap();

    restore(&scenario.target, &scenario.file, &no_failure).unwrap();

    let mut names: Vec<String> = fs::read_dir(&data_dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["spa.db"]);
}

#[test]
fn a_rollback_that_fails_too_reports_it_and_leaves_the_evidence_for_recovery() {
    let scenario = scenario();

    let outcome = restore(
        &scenario.target,
        &scenario.file,
        &failing_at(&[SwapStep::InstallRestored, SwapStep::Rollback]),
    );

    assert!(matches!(outcome, Err(BackupError::RollbackFailed)));
    assert!(scenario
        .target
        .source
        .key_store
        .read_pending()
        .unwrap()
        .is_some());
    assert_eq!(
        find(&scenario.target.source.database_path, Leftover::Prev)
            .unwrap()
            .len(),
        1
    );
    assert!(!scenario.target.source.database_path.exists());
}

#[test]
fn every_step_is_announced_before_it_runs() {
    let scenario = scenario();
    let seen = std::cell::RefCell::new(Vec::new());
    let recorder = |step: SwapStep| {
        seen.borrow_mut().push(step);
        Ok(())
    };

    restore(&scenario.target, &scenario.file, &recorder).unwrap();

    assert_eq!(*seen.borrow(), STEPS_BEFORE_ROLLBACK);
}

#[test]
fn a_permission_revoked_after_staging_blocks_the_swap_inside_the_lock() {
    let scenario = scenario();
    let staged = stage_restore(
        &scenario.target.source.database_path,
        &scenario.file,
        &passphrase(),
    )
    .unwrap();
    execute(
        &scenario.target,
        "DELETE FROM role_permissions WHERE role_id = 1 AND permission_key = 'backup.manage'",
    );
    let before = snapshot_of(&scenario.target);

    let outcome = swap_in(
        &scenario.target.database,
        &scenario.target.session,
        &scenario.target.source,
        staged,
        &no_failure,
    );

    assert!(matches!(
        outcome,
        Err(BackupError::Auth(AuthError::Forbidden))
    ));
    assert_untouched(&scenario.target, &before);
    assert_eq!(marker_count(&scenario.target), 0);
}

#[test]
fn without_a_session_and_with_users_the_swap_is_unauthenticated() {
    let source = source_with_marker();
    let target = backup_fixture();
    let file = current_backup_file(&source, "respaldo.spabak");
    let before = snapshot_of(&target);

    let outcome = restore(&target, &file, &no_failure);

    assert!(matches!(
        outcome,
        Err(BackupError::Auth(AuthError::Unauthenticated))
    ));
    assert_old_state_intact_and_served(&target, &before);
}

#[test]
fn a_role_without_backup_manage_cannot_swap() {
    let source = source_with_marker();
    let target = backup_fixture();
    sign_in_as(&target, RECEPTION);
    let file = current_backup_file(&source, "respaldo.spabak");
    let before = snapshot_of(&target);

    let outcome = restore(&target, &file, &no_failure);

    assert!(matches!(
        outcome,
        Err(BackupError::Auth(AuthError::Forbidden))
    ));
    assert_old_state_intact_and_served(&target, &before);
}

#[test]
fn a_locked_session_cannot_swap() {
    let source = source_with_marker();
    let target = backup_fixture();
    sign_in_as(&target, OWNER);
    target.session.force_lock().unwrap();
    let file = current_backup_file(&source, "respaldo.spabak");
    let before = snapshot_of(&target);

    let outcome = restore(&target, &file, &no_failure);

    assert!(matches!(outcome, Err(BackupError::Auth(AuthError::Locked))));
    assert_old_state_intact_and_served(&target, &before);
}

#[test]
fn on_first_run_without_users_the_swap_needs_no_session() {
    let source = source_with_marker();
    let target = first_run_fixture();
    let file = current_backup_file(&source, "respaldo.spabak");

    restore(&target, &file, &no_failure).unwrap();

    assert_eq!(marker_count(&target), 1);
    let rows = backup_audit_rows(&target, "backup_restored");
    assert_eq!(rows.len(), 1);
    let diff: serde_json::Value = serde_json::from_str(rows[0].diff.as_ref().unwrap()).unwrap();
    assert!(diff["restoredBy"].is_null());
}

#[test]
fn a_failed_first_run_swap_keeps_the_empty_database() {
    let source = source_with_marker();
    let target = first_run_fixture();
    let file = current_backup_file(&source, "respaldo.spabak");
    let before = snapshot_of(&target);

    let outcome = restore(&target, &file, &failing_at(&[SwapStep::PromoteKey]));

    assert!(matches!(outcome, Err(BackupError::Io(_))));
    assert_untouched(&target, &before);
    assert_eq!(count_users(&target, "1 = 1"), 0);
}

fn new_key_of(scenario: &Scenario) -> DbKey {
    DbKey::from_hex(hex::encode(stored_key_bytes(&scenario.source))).unwrap()
}

fn rollback_failing_after_partial_promotion<'a>(
    scenario: &'a Scenario,
    new_key: &'a DbKey,
    failing_in_rollback: &'static [SwapStep],
) -> impl Fn(SwapStep) -> io::Result<()> + 'a {
    let key_store = &scenario.target.source.key_store;
    move |step| {
        if step == SwapStep::PromoteKey {
            key_store.write(new_key).unwrap();
            return Err(io::Error::other("injected"));
        }
        if failing_in_rollback.contains(&step) {
            return Err(io::Error::other("injected"));
        }
        Ok(())
    }
}

fn users_after_recovery(target: &BackupFixture) -> i64 {
    let key = target.source.key_store.read().unwrap().unwrap();
    open_encrypted(&target.source.database_path, &key)
        .unwrap()
        .query_row("SELECT count(*) FROM users", [], |row| row.get(0))
        .unwrap()
}

#[test]
fn a_rollback_that_cannot_restore_the_old_key_does_not_put_the_old_database_back() {
    let scenario = scenario();
    let new_key = new_key_of(&scenario);
    let inject = rollback_failing_after_partial_promotion(
        &scenario,
        &new_key,
        &[SwapStep::RollbackRestoreKey],
    );

    let outcome = restore(&scenario.target, &scenario.file, &inject);

    assert!(matches!(outcome, Err(BackupError::RollbackFailed)));
    assert_eq!(
        find(&scenario.target.source.database_path, Leftover::Prev)
            .unwrap()
            .len(),
        1
    );
    recover_interrupted_restore(
        &scenario.target.source.database_path,
        &scenario.target.source.key_store,
    )
    .unwrap();
    assert_eq!(users_after_recovery(&scenario.target), 3);
}

#[test]
fn a_rollback_that_restores_the_key_but_not_the_database_is_completed_forward_by_recovery() {
    let scenario = scenario();
    let new_key = new_key_of(&scenario);
    let inject = rollback_failing_after_partial_promotion(
        &scenario,
        &new_key,
        &[SwapStep::RollbackRestoreDatabase],
    );

    let outcome = restore(&scenario.target, &scenario.file, &inject);

    assert!(matches!(outcome, Err(BackupError::RollbackFailed)));
    assert!(scenario
        .target
        .source
        .key_store
        .read_pending()
        .unwrap()
        .is_some());
    recover_interrupted_restore(
        &scenario.target.source.database_path,
        &scenario.target.source.key_store,
    )
    .unwrap();
    assert_eq!(users_after_recovery(&scenario.target), 3);
    assert_eq!(
        stored_key_bytes(&scenario.target),
        stored_key_bytes(&scenario.source)
    );
}

#[test]
fn a_failed_rollback_step_does_not_stop_the_remaining_steps_from_being_attempted() {
    let scenario = scenario();
    let seen = std::cell::RefCell::new(Vec::new());
    let inject = |step: SwapStep| {
        seen.borrow_mut().push(step);
        match step {
            SwapStep::InstallRestored | SwapStep::RollbackRestoreDatabase => {
                Err(io::Error::other("injected"))
            }
            _ => Ok(()),
        }
    };

    restore(&scenario.target, &scenario.file, &inject).unwrap_err();

    let attempted = seen.borrow();
    assert!(attempted.contains(&SwapStep::RollbackReopenLive));
}

#[test]
fn a_rollback_that_cannot_reopen_the_live_connection_ends_the_session_but_keeps_the_old_state() {
    let scenario = scenario();

    let outcome = restore(
        &scenario.target,
        &scenario.file,
        &failing_at(&[SwapStep::VerifyAndAudit, SwapStep::RollbackReopenLive]),
    );

    assert!(matches!(outcome, Err(BackupError::RollbackFailed)));
    assert_eq!(scenario.target.session.current_user_id().unwrap(), None);
    assert_untouched(&scenario.target, &scenario.before);
}

#[test]
fn a_rollback_failure_ends_the_active_session() {
    let scenario = scenario();

    let outcome = restore(
        &scenario.target,
        &scenario.file,
        &failing_at(&[SwapStep::InstallRestored, SwapStep::Rollback]),
    );

    assert!(matches!(outcome, Err(BackupError::RollbackFailed)));
    assert_eq!(scenario.target.session.current_user_id().unwrap(), None);
}

#[test]
fn after_a_rollback_that_fails_the_live_connection_still_serves_the_database_on_disk() {
    let scenario = scenario();
    let new_key = new_key_of(&scenario);
    let inject = rollback_failing_after_partial_promotion(
        &scenario,
        &new_key,
        &[SwapStep::RollbackRestoreKey],
    );

    restore(&scenario.target, &scenario.file, &inject).unwrap_err();

    assert_eq!(count_users(&scenario.target, "1 = 1"), 3);
}

#[test]
fn a_panic_inside_the_swap_rolls_back_to_the_old_state() {
    let scenario = scenario();
    let panicking = |step: SwapStep| -> io::Result<()> {
        if step == SwapStep::InstallRestored {
            panic!("boom");
        }
        Ok(())
    };

    let outcome = restore(&scenario.target, &scenario.file, &panicking);

    assert!(matches!(
        outcome,
        Err(BackupError::Db(DbError::OperationPanicked))
    ));
    assert_old_state_intact_and_served(&scenario.target, &scenario.before);
    assert!(scenario.target.session.current_user_id().unwrap().is_some());
}

#[test]
fn a_failed_swap_also_removes_the_sidecars_of_the_staged_file() {
    let scenario = scenario();
    let staged = stage_restore(
        &scenario.target.source.database_path,
        &scenario.file,
        &passphrase(),
    )
    .unwrap();
    let journal = format!("{}-journal", staged.restoring_path.display());
    fs::write(&journal, b"huerfano").unwrap();

    swap_in(
        &scenario.target.database,
        &scenario.target.session,
        &scenario.target.source,
        staged,
        &failing_at(&[SwapStep::SavePendingKey]),
    )
    .unwrap_err();

    assert!(!std::path::Path::new(&journal).exists());
    assert_untouched(&scenario.target, &scenario.before);
}

#[test]
fn after_a_successful_swap_no_previous_copy_and_no_pending_key_remain() {
    let scenario = scenario();

    restore(&scenario.target, &scenario.file, &no_failure).unwrap();

    assert!(find(&scenario.target.source.database_path, Leftover::Prev)
        .unwrap()
        .is_empty());
    assert!(scenario
        .target
        .source
        .key_store
        .read_pending()
        .unwrap()
        .is_none());
}

fn staged_scenario() -> (Scenario, StagedRestore) {
    let scenario = scenario();
    let staged = stage_restore(
        &scenario.target.source.database_path,
        &scenario.file,
        &passphrase(),
    )
    .unwrap();
    (scenario, staged)
}

fn swap_staged(scenario: &Scenario, staged: StagedRestore) -> Result<RestoreResult, BackupError> {
    swap_in(
        &scenario.target.database,
        &scenario.target.session,
        &scenario.target.source,
        staged,
        &no_failure,
    )
}

#[test]
fn a_staged_file_that_grew_before_the_swap_is_refused_and_nothing_changes() {
    let (scenario, staged) = staged_scenario();
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&staged.restoring_path)
        .unwrap();
    std::io::Write::write_all(&mut file, b"x").unwrap();
    drop(file);

    let outcome = swap_staged(&scenario, staged);

    assert!(matches!(outcome, Err(BackupError::Unreadable)));
    assert_old_state_intact_and_served(&scenario.target, &scenario.before);
}

#[test]
fn a_staged_file_rewritten_with_the_same_size_is_refused_by_its_modification_time() {
    let (scenario, staged) = staged_scenario();
    let file = fs::OpenOptions::new()
        .write(true)
        .open(&staged.restoring_path)
        .unwrap();
    file.set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(60))
        .unwrap();
    drop(file);

    let outcome = swap_staged(&scenario, staged);

    assert!(matches!(outcome, Err(BackupError::Unreadable)));
    assert_old_state_intact_and_served(&scenario.target, &scenario.before);
}

#[test]
fn an_untouched_staged_file_is_accepted() {
    let (scenario, staged) = staged_scenario();

    swap_staged(&scenario, staged).unwrap();

    assert_eq!(marker_count(&scenario.target), 1);
}

#[test]
fn a_same_size_rewrite_with_the_modification_time_put_back_evades_the_fingerprint_but_not_the_verification(
) {
    let (scenario, staged) = staged_scenario();
    let metadata = fs::metadata(&staged.restoring_path).unwrap();
    let original_modified = metadata.modified().unwrap();
    fs::write(&staged.restoring_path, vec![0u8; metadata.len() as usize]).unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(&staged.restoring_path)
        .unwrap()
        .set_modified(original_modified)
        .unwrap();

    assert!(staged.require_unchanged().is_ok());
    let outcome = swap_staged(&scenario, staged);

    assert!(outcome.is_err());
    assert_old_state_intact_and_served(&scenario.target, &scenario.before);
}
