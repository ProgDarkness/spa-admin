use std::path::PathBuf;

use tauri::test::{mock_app, MockRuntime};
use tauri::{App, Manager};

use super::*;
use crate::features::backup::fixture_test::backup_fixture;

fn app_with_backup_state() -> (App<MockRuntime>, tempfile::TempDir) {
    let fixture = backup_fixture();
    let app = mock_app();
    app.manage(fixture.database);
    app.manage(fixture.session);
    app.manage(fixture.source);
    (app, fixture.dir)
}

#[test]
fn background_work_runs_off_the_thread_that_polls_the_command() {
    let (app, _dir) = app_with_backup_state();
    let background = BackupBackground::native(app.handle().clone());
    let polling_thread = std::thread::current().id();

    let worker_thread =
        tauri::async_runtime::block_on(background.run(|_, _, _| Ok(std::thread::current().id())))
            .unwrap();

    assert_ne!(worker_thread, polling_thread);
}

#[test]
fn background_work_sees_the_managed_state_of_the_app() {
    let (app, _dir) = app_with_backup_state();
    let background = BackupBackground::native(app.handle().clone());
    let expected: PathBuf = app.state::<BackupSource>().database_path.clone();

    let seen = tauri::async_runtime::block_on(
        background.run(|_, _, source| Ok(source.database_path.clone())),
    )
    .unwrap();

    assert_eq!(seen, expected);
}

#[test]
fn background_work_returns_its_own_failure_untouched() {
    let (app, _dir) = app_with_backup_state();
    let background = BackupBackground::native(app.handle().clone());

    let outcome = tauri::async_runtime::block_on(
        background.run(|_, _, _| Err::<(), _>(BackupError::NotRecognized)),
    );

    assert!(matches!(outcome, Err(BackupError::NotRecognized)));
}

#[test]
fn a_panic_in_background_work_becomes_a_file_failure_instead_of_unwinding_the_command() {
    let (app, _dir) = app_with_backup_state();
    let background = BackupBackground::native(app.handle().clone());

    let outcome = tauri::async_runtime::block_on(
        background.run(|_, _, _| -> Result<(), BackupError> { panic!("boom") }),
    );

    assert!(matches!(outcome, Err(BackupError::Io(_))));
}

#[test]
fn background_work_can_take_the_database_lock_while_the_caller_is_idle() {
    let (app, _dir) = app_with_backup_state();
    let background = BackupBackground::native(app.handle().clone());

    let users = tauri::async_runtime::block_on(background.run(|db, _, _| {
        db.with_conn_mapped(|conn| {
            Ok(conn
                .query_row("SELECT count(*) FROM users", [], |row| row.get::<_, i64>(0))
                .map_err(crate::db::DbError::from)?)
        })
    }))
    .unwrap();

    assert_eq!(users, 2);
}
