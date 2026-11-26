use std::fs;
use std::io;

use super::tests::{assert_old_state_intact_and_served, restore, scenario};
use super::*;
use crate::features::backup::fixture_test::{hot_journal_truncating_to_one_page, sidecar_path};
use crate::features::backup::leftovers::{find, Leftover};

#[test]
fn a_hot_journal_of_the_restored_database_is_discarded_before_the_old_one_returns() {
    let scenario = scenario();
    let database = scenario.target.source.database_path.clone();
    let journal = sidecar_path(&database, "-journal");
    let planting = |step: SwapStep| -> io::Result<()> {
        match step {
            SwapStep::VerifyAndAudit => Err(io::Error::other("injected")),
            SwapStep::Rollback => fs::write(&journal, hot_journal_truncating_to_one_page()),
            _ => Ok(()),
        }
    };

    let outcome = restore(&scenario.target, &scenario.file, &planting);

    assert!(matches!(outcome, Err(BackupError::Io(_))));
    assert!(!journal.exists());
    assert_old_state_intact_and_served(&scenario.target, &scenario.before);
}

#[test]
fn a_successful_swap_also_removes_the_sidecars_of_the_previous_copy() {
    let scenario = scenario();
    let database = scenario.target.source.database_path.clone();
    let planting = |step: SwapStep| -> io::Result<()> {
        if step != SwapStep::VerifyAndAudit {
            return Ok(());
        }
        let previous = find(&database, Leftover::Prev).unwrap().remove(0);
        for suffix in ["-journal", "-wal", "-shm"] {
            fs::write(sidecar_path(&previous, suffix), b"huerfano")?;
        }
        Ok(())
    };

    restore(&scenario.target, &scenario.file, &planting).unwrap();

    let mut names: Vec<String> = fs::read_dir(database.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["spa.db"]);
}

#[test]
fn a_rollback_that_cannot_discard_the_journal_does_not_bring_the_old_database_back() {
    let scenario = scenario();
    let database = scenario.target.source.database_path.clone();
    let journal = sidecar_path(&database, "-journal");
    let blocking = |step: SwapStep| -> io::Result<()> {
        match step {
            SwapStep::VerifyAndAudit => Err(io::Error::other("injected")),
            SwapStep::Rollback => fs::create_dir_all(journal.join("no-vacio")),
            _ => Ok(()),
        }
    };

    let outcome = restore(&scenario.target, &scenario.file, &blocking);

    assert!(matches!(outcome, Err(BackupError::RollbackFailed)));
    assert_eq!(find(&database, Leftover::Prev).unwrap().len(), 1);
}
