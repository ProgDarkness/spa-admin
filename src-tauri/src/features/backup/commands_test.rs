use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use tauri::test::{mock_app, MockRuntime};
use tauri::{App, Manager};
use tempfile::TempDir;

use super::*;
use crate::errors::{AppError, AppErrorCode};
use crate::features::backup::fixture_test::{
    backup_fixture, current_backup_file, first_run_fixture, sign_in_as, source_with_marker,
    BackupFixture, MARKER_USER, OWNER, PASSPHRASE, RECEPTION,
};
use crate::features::backup::format::BackupHeader;

const SUGGESTED_NAME_LEN: usize = "spa-respaldo-".len() + "2026-11-25-2231".len() + ".spabak".len();

struct CommandApp {
    app: App<MockRuntime>,
    _dir: TempDir,
    save_names: Arc<Mutex<Vec<String>>>,
    open_calls: Arc<AtomicUsize>,
}

impl CommandApp {
    fn database_bytes(&self) -> Vec<u8> {
        fs::read(&self.app.state::<BackupSource>().database_path).unwrap()
    }

    fn key_hex(&self) -> String {
        self.app
            .state::<BackupSource>()
            .key_store
            .read()
            .unwrap()
            .unwrap()
            .as_hex()
            .to_string()
    }

    fn save_calls(&self) -> usize {
        self.save_names.lock().unwrap().len()
    }

    fn count_users(&self, username: &str) -> i64 {
        self.app
            .state::<Database>()
            .with_conn(|conn| {
                Ok(conn.query_row(
                    "SELECT count(*) FROM users WHERE username = ?1",
                    [username],
                    |row| row.get(0),
                )?)
            })
            .unwrap()
    }

    fn audit_count(&self, action: &str) -> i64 {
        self.app
            .state::<Database>()
            .with_conn(|conn| {
                Ok(conn.query_row(
                    "SELECT count(*) FROM audit_log WHERE action = ?1",
                    [action],
                    |row| row.get(0),
                )?)
            })
            .unwrap()
    }

    fn has_session(&self) -> bool {
        self.app
            .state::<SessionState>()
            .current_user_id()
            .unwrap()
            .is_some()
    }
}

fn command_app(
    fixture: BackupFixture,
    save_to: Option<PathBuf>,
    open_from: Option<PathBuf>,
) -> CommandApp {
    let BackupFixture {
        dir,
        database,
        session,
        source,
    } = fixture;
    let save_names: Arc<Mutex<Vec<String>>> = Arc::default();
    let open_calls = Arc::new(AtomicUsize::new(0));
    let names = save_names.clone();
    let opens = open_calls.clone();
    let dialogs = BackupDialogs::new(
        Arc::new(move |name| {
            names.lock().unwrap().push(name.to_string());
            save_to.clone()
        }),
        Arc::new(move || {
            opens.fetch_add(1, Ordering::SeqCst);
            open_from.clone()
        }),
    );
    let app = mock_app();
    app.manage(database);
    app.manage(session);
    app.manage(source);
    app.manage(dialogs);
    CommandApp {
        app,
        _dir: dir,
        save_names,
        open_calls,
    }
}

fn signed_in(username: &str, save_to: Option<PathBuf>, open_from: Option<PathBuf>) -> CommandApp {
    let fixture = backup_fixture();
    sign_in_as(&fixture, username);
    command_app(fixture, save_to, open_from)
}

fn owner_saving_as(file_name: &str) -> (CommandApp, PathBuf) {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let chosen = fixture.dir.path().join("out").join(file_name);
    (command_app(fixture, Some(chosen.clone()), None), chosen)
}

fn destination_in(app: &CommandApp, name: &str) -> PathBuf {
    app._dir.path().join("out").join(name)
}

fn export_cheap(app: &CommandApp, passphrase: &str) -> Result<Option<BackupExported>, AppError> {
    tauri::async_runtime::block_on(export_flow(
        &app.app.state::<Database>(),
        &app.app.state::<SessionState>(),
        &app.app.state::<BackupSource>(),
        &app.app.state::<BackupDialogs>(),
        KdfParams::LOWEST_ACCEPTED,
        passphrase.to_string(),
    ))
    .map_err(AppError::from)
}

fn restore_command(app: &CommandApp, passphrase: &str) -> Result<Option<RestoreResult>, AppError> {
    tauri::async_runtime::block_on(restore_backup(
        passphrase.to_string(),
        app.app.state(),
        app.app.state(),
        app.app.state(),
        app.app.state(),
    ))
}

fn export_command(app: &CommandApp, passphrase: &str) -> Result<Option<BackupExported>, AppError> {
    tauri::async_runtime::block_on(export_backup(
        passphrase.to_string(),
        app.app.state(),
        app.app.state(),
        app.app.state(),
        app.app.state(),
    ))
}

fn status_command(app: &CommandApp) -> Result<BackupStatus, AppError> {
    get_backup_status(app.app.state(), app.app.state())
}

fn backup_from_marker_source() -> (BackupFixture, PathBuf) {
    let source = source_with_marker();
    let file = current_backup_file(&source, "origen.spabak");
    (source, file)
}

#[test]
fn exporting_without_a_session_is_unauthenticated_and_opens_no_dialog() {
    let app = command_app(backup_fixture(), Some(PathBuf::from("/nunca")), None);

    let failure = export_cheap(&app, PASSPHRASE).unwrap_err();

    assert_eq!(failure, AppError::unauthenticated());
    assert_eq!(app.save_calls(), 0);
}

#[test]
fn exporting_while_the_first_run_is_pending_is_unauthenticated() {
    let app = command_app(first_run_fixture(), Some(PathBuf::from("/nunca")), None);

    let failure = export_cheap(&app, PASSPHRASE).unwrap_err();

    assert_eq!(failure, AppError::unauthenticated());
    assert_eq!(app.save_calls(), 0);
}

#[test]
fn reception_cannot_export_and_sees_no_dialog() {
    let app = signed_in(RECEPTION, Some(PathBuf::from("/nunca")), None);

    let failure = export_cheap(&app, PASSPHRASE).unwrap_err();

    assert_eq!(failure, AppError::forbidden());
    assert_eq!(app.save_calls(), 0);
}

#[test]
fn a_locked_session_cannot_export() {
    let app = signed_in(OWNER, Some(PathBuf::from("/nunca")), None);
    app.app.state::<SessionState>().force_lock().unwrap();

    let failure = export_cheap(&app, PASSPHRASE).unwrap_err();

    assert_eq!(failure, AppError::session_locked());
    assert_eq!(app.save_calls(), 0);
}

#[test]
fn the_permission_is_decided_before_validating_the_passphrase() {
    let app = signed_in(RECEPTION, Some(PathBuf::from("/nunca")), None);

    let failure = export_cheap(&app, "corta").unwrap_err();

    assert_eq!(failure, AppError::forbidden());
}

#[test]
fn a_short_passphrase_is_rejected_before_any_dialog() {
    let app = signed_in(OWNER, Some(PathBuf::from("/nunca")), None);

    let failure = export_cheap(&app, "corta").unwrap_err();

    assert_eq!(failure.code, AppErrorCode::Validation);
    assert_eq!(failure.field.as_deref(), Some("passphrase"));
    assert_eq!(app.save_calls(), 0);
}

#[test]
fn cancelling_the_save_dialog_returns_nothing_and_touches_nothing() {
    let app = signed_in(OWNER, None, None);
    let database_before = app.database_bytes();

    let outcome = export_cheap(&app, PASSPHRASE).unwrap();

    assert_eq!(outcome, None);
    assert_eq!(app.save_calls(), 1);
    assert_eq!(app.audit_count("backup_created"), 0);
    assert_eq!(app.database_bytes(), database_before);
    assert_eq!(fs::read_dir(destination_in(&app, "")).unwrap().count(), 0);
}

#[test]
fn the_save_dialog_suggests_a_dated_default_name() {
    let app = signed_in(OWNER, None, None);

    export_cheap(&app, PASSPHRASE).unwrap();

    let names = app.save_names.lock().unwrap();
    assert_eq!(names.len(), 1);
    assert!(names[0].starts_with("spa-respaldo-"), "{}", names[0]);
    assert!(names[0].ends_with(".spabak"), "{}", names[0]);
    assert_eq!(names[0].len(), SUGGESTED_NAME_LEN);
}

#[test]
fn a_chosen_path_without_the_extension_gets_it_added() {
    let (app, chosen) = owner_saving_as("mi-respaldo");

    let exported = export_cheap(&app, PASSPHRASE).unwrap().unwrap();

    assert_eq!(exported.file_name, "mi-respaldo.spabak");
    assert!(destination_in(&app, "mi-respaldo.spabak").is_file());
    assert!(!chosen.exists());
    assert_eq!(app.audit_count("backup_created"), 1);
}

#[test]
fn the_export_command_seals_with_the_production_key_derivation() {
    let (app, chosen) = owner_saving_as("produccion.spabak");

    let exported = export_command(&app, PASSPHRASE).unwrap().unwrap();

    assert_eq!(exported.file_name, "produccion.spabak");
    let header = BackupHeader::parse(&fs::read(&chosen).unwrap()).unwrap();
    assert_eq!(header.kdf, KdfParams::EXPORT);
}

#[test]
fn restoring_with_an_existing_owner_and_no_session_is_unauthenticated() {
    let (_source, file) = backup_from_marker_source();
    let app = command_app(backup_fixture(), None, Some(file));
    let database_before = app.database_bytes();

    let failure = restore_command(&app, PASSPHRASE).unwrap_err();

    assert_eq!(failure, AppError::unauthenticated());
    assert_eq!(app.open_calls.load(Ordering::SeqCst), 0);
    assert_eq!(app.database_bytes(), database_before);
}

#[test]
fn reception_cannot_restore() {
    let (_source, file) = backup_from_marker_source();
    let fixture = backup_fixture();
    sign_in_as(&fixture, RECEPTION);
    let app = command_app(fixture, None, Some(file));

    let failure = restore_command(&app, PASSPHRASE).unwrap_err();

    assert_eq!(failure, AppError::forbidden());
    assert_eq!(app.open_calls.load(Ordering::SeqCst), 0);
    assert_eq!(app.count_users(MARKER_USER), 0);
}

#[test]
fn a_locked_session_cannot_restore() {
    let (_source, file) = backup_from_marker_source();
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let app = command_app(fixture, None, Some(file));
    app.app.state::<SessionState>().force_lock().unwrap();

    let failure = restore_command(&app, PASSPHRASE).unwrap_err();

    assert_eq!(failure, AppError::session_locked());
    assert_eq!(app.open_calls.load(Ordering::SeqCst), 0);
}

#[test]
fn a_short_passphrase_is_rejected_before_the_open_dialog() {
    let (_source, file) = backup_from_marker_source();
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let app = command_app(fixture, None, Some(file));

    let failure = restore_command(&app, "corta").unwrap_err();

    assert_eq!(failure.code, AppErrorCode::Validation);
    assert_eq!(failure.field.as_deref(), Some("passphrase"));
    assert_eq!(app.open_calls.load(Ordering::SeqCst), 0);
}

#[test]
fn cancelling_the_open_dialog_returns_nothing_and_touches_nothing() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let app = command_app(fixture, None, None);
    let database_before = app.database_bytes();
    let key_before = app.key_hex();

    let outcome = restore_command(&app, PASSPHRASE).unwrap();

    assert_eq!(outcome, None);
    assert_eq!(app.open_calls.load(Ordering::SeqCst), 1);
    assert_eq!(app.database_bytes(), database_before);
    assert_eq!(app.key_hex(), key_before);
    assert!(app.has_session());
    assert_eq!(app.audit_count("backup_restored"), 0);
}

#[test]
fn an_owner_session_restores_the_chosen_backup_and_is_signed_out() {
    let (_source, file) = backup_from_marker_source();
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let app = command_app(fixture, None, Some(file));

    let restored = restore_command(&app, PASSPHRASE).unwrap().unwrap();

    assert_eq!(
        restored.schema_version,
        crate::db::migrations::supported_version()
    );
    assert_eq!(restored.source_schema_version, restored.schema_version);
    assert_eq!(app.count_users(MARKER_USER), 1);
    assert_eq!(app.audit_count("backup_restored"), 1);
    assert!(!app.has_session());
}

#[test]
fn the_first_run_restores_without_any_session() {
    let (_source, file) = backup_from_marker_source();
    let app = command_app(first_run_fixture(), None, Some(file));

    let restored = restore_command(&app, PASSPHRASE).unwrap();

    assert!(restored.is_some());
    assert_eq!(app.count_users(MARKER_USER), 1);
}

#[test]
fn a_wrong_passphrase_is_unreadable_and_changes_nothing() {
    let (_source, file) = backup_from_marker_source();
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let app = command_app(fixture, None, Some(file));
    let database_before = app.database_bytes();
    let key_before = app.key_hex();

    let failure = restore_command(&app, "otra-frase-bien-larga").unwrap_err();

    assert_eq!(failure, AppError::backup_unreadable());
    assert_eq!(app.database_bytes(), database_before);
    assert_eq!(app.key_hex(), key_before);
    assert!(app.has_session());
    assert_eq!(app.count_users(MARKER_USER), 0);
}

#[test]
fn the_status_requires_a_session_and_the_backup_permission() {
    let anonymous = command_app(backup_fixture(), None, None);
    let reception = signed_in(RECEPTION, None, None);

    assert_eq!(
        status_command(&anonymous).unwrap_err(),
        AppError::unauthenticated()
    );
    assert_eq!(
        status_command(&reception).unwrap_err(),
        AppError::forbidden()
    );
}

#[test]
fn the_status_is_due_until_a_backup_is_exported() {
    let (app, _chosen) = owner_saving_as("estado.spabak");

    let before = status_command(&app).unwrap();
    export_cheap(&app, PASSPHRASE).unwrap();
    let after = status_command(&app).unwrap();

    assert_eq!(
        before,
        BackupStatus {
            last_backup_at: None,
            is_due: true
        }
    );
    assert!(!after.is_due);
    assert_eq!(after.last_backup_at.map(|at| at.len()), Some(19));
}
