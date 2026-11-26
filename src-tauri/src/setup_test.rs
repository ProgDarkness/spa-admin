use std::fs;
use std::path::PathBuf;

use keyring_core::mock;

use super::*;
use crate::db::migrations::supported_version;
use crate::keystore::{KeyStoreError, DB_KEY_ACCOUNT};
use crate::test_support::{isolated_store, isolated_store_with_service};

const SENTINEL_BYTES: &[u8] = b"contenido-previo-intacto";

fn database_path(dir: &Path) -> PathBuf {
    dir.join(DATABASE_FILE_NAME)
}

fn role_count(bootstrap: &Bootstrap) -> i64 {
    bootstrap
        .database
        .with_conn(|conn| Ok(conn.query_row("SELECT count(*) FROM roles", [], |row| row.get(0))?))
        .unwrap()
}

fn inject_keystore_failure(service: &str) {
    let entry = keyring_core::Entry::new(service, DB_KEY_ACCOUNT).unwrap();
    let cred = entry.as_any().downcast_ref::<mock::Cred>().unwrap();
    cred.set_error(keyring_core::Error::NoStorageAccess(Box::new(
        std::io::Error::other("denied"),
    )));
}

#[test]
fn bootstrap_creates_db_and_key_then_reopens_with_same_key() {
    let dir = tempfile::tempdir().unwrap();
    let store = isolated_store();

    let first = bootstrap(dir.path(), &store).unwrap();
    assert_eq!(role_count(&first), 3);
    assert!(database_path(dir.path()).exists());
    let key_after_first = store.read().unwrap().unwrap().as_hex().to_string();
    drop(first);

    let second = bootstrap(dir.path(), &store).unwrap();
    assert_eq!(role_count(&second), 3);
    assert_eq!(
        store.read().unwrap().unwrap().as_hex(),
        key_after_first.as_str()
    );
}

#[test]
fn bootstrap_creates_missing_data_dir() {
    let dir = tempfile::tempdir().unwrap();
    let nested = dir.path().join("a").join("b");
    let store = isolated_store();
    bootstrap(&nested, &store).unwrap();
    assert!(database_path(&nested).exists());
}

#[test]
fn bootstrap_fails_when_db_exists_but_key_is_missing() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(database_path(dir.path()), SENTINEL_BYTES).unwrap();
    let store = isolated_store();

    let result = bootstrap(dir.path(), &store);

    assert!(matches!(
        result,
        Err(SetupError::KeyStore(KeyStoreError::MissingForExistingDb))
    ));
    assert_eq!(fs::read(database_path(dir.path())).unwrap(), SENTINEL_BYTES);
    assert!(store.read().unwrap().is_none());
}

#[test]
fn bootstrap_fails_when_keystore_errors_without_creating_db_file() {
    let dir = tempfile::tempdir().unwrap();
    let (store, service) = isolated_store_with_service();
    inject_keystore_failure(&service);

    let result = bootstrap(dir.path(), &store);

    assert!(matches!(
        result,
        Err(SetupError::KeyStore(KeyStoreError::Keyring(_)))
    ));
    assert!(!database_path(dir.path()).exists());
}

#[test]
fn setup_error_messages_are_fixed_and_leak_nothing() {
    let io = SetupError::Io(std::io::Error::other("/ruta/secreta"));
    assert_eq!(io.to_string(), "data directory unavailable");
    let key = SetupError::KeyStore(KeyStoreError::MissingForExistingDb);
    assert_eq!(key.to_string(), "key store unavailable");
}

#[cfg(unix)]
#[test]
fn bootstrap_restricts_data_dir_and_database_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let nested = dir.path().join("datos");
    let store = isolated_store();

    bootstrap(&nested, &store).unwrap();

    let mode_of = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode_of(&nested), 0o700);
    assert_eq!(mode_of(&database_path(&nested)), 0o600);
}

#[cfg(unix)]
#[test]
fn bootstrap_tightens_permissions_of_an_existing_database() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let store = isolated_store();
    drop(bootstrap(dir.path(), &store).unwrap());
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o755)).unwrap();
    fs::set_permissions(database_path(dir.path()), fs::Permissions::from_mode(0o644)).unwrap();

    bootstrap(dir.path(), &store).unwrap();

    let mode_of = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode_of(dir.path()), 0o700);
    assert_eq!(mode_of(&database_path(dir.path())), 0o600);
}

#[cfg(not(unix))]
#[test]
fn restrict_to_owner_leaves_the_platform_permissions_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("probe");
    fs::write(&file, SENTINEL_BYTES).unwrap();
    let permissions_of = |path: &Path| fs::metadata(path).unwrap().permissions();
    let (dir_before, file_before) = (permissions_of(dir.path()), permissions_of(&file));

    restrict_to_owner(dir.path(), DIRECTORY_MODE).unwrap();
    restrict_to_owner(&file, DATABASE_MODE).unwrap();

    assert_eq!(permissions_of(dir.path()), dir_before);
    assert_eq!(permissions_of(&file), file_before);
    assert!(!permissions_of(&file).readonly());
    assert_eq!(fs::read(&file).unwrap(), SENTINEL_BYTES);
}

fn database_at_version_two(dir: &Path, store: &KeyStore) {
    let key = load_or_create(store, false).unwrap();
    let conn = open_encrypted(&database_path(dir), &key).unwrap();
    conn.execute_batch(include_str!("db/migrations/0001_auth.sql"))
        .unwrap();
    conn.execute_batch(include_str!("db/migrations/0002_username_nocase.sql"))
        .unwrap();
    conn.pragma_update(None, "user_version", 2).unwrap();
}

fn backups_in(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .filter(|name| name.ends_with(".bak"))
        .collect()
}

fn version_of(path: &Path, store: &KeyStore) -> i64 {
    let key = load_or_create(store, true).unwrap();
    open_encrypted(path, &key)
        .unwrap()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap()
}

#[test]
fn bootstrap_snapshots_a_pending_database_before_migrating() {
    let dir = tempfile::tempdir().unwrap();
    let store = isolated_store();
    database_at_version_two(dir.path(), &store);

    drop(bootstrap(dir.path(), &store).unwrap());

    let backups = backups_in(dir.path());
    assert_eq!(backups.len(), 1);
    assert!(backups[0].ends_with(".v2.bak"));
    assert_eq!(version_of(&dir.path().join(&backups[0]), &store), 2);
    assert_eq!(
        version_of(&database_path(dir.path()), &store),
        i64::from(supported_version())
    );
}

#[test]
fn bootstrap_creates_no_snapshot_for_a_fresh_or_current_database() {
    let dir = tempfile::tempdir().unwrap();
    let store = isolated_store();

    drop(bootstrap(dir.path(), &store).unwrap());
    drop(bootstrap(dir.path(), &store).unwrap());

    assert!(backups_in(dir.path()).is_empty());
}

#[test]
fn copy_failure_aborts_before_migrate() {
    let dir = tempfile::tempdir().unwrap();
    let store = isolated_store();
    database_at_version_two(dir.path(), &store);
    let failing_snapshot =
        |_: &Path, _: i64| Err(SnapshotError::Io(std::io::Error::other("disk full")));

    let result = bootstrap_with(dir.path(), &store, failing_snapshot, &|_: &str| None);

    assert!(matches!(result, Err(SetupError::Snapshot(_))));
    assert_eq!(version_of(&database_path(dir.path()), &store), 2);
    assert!(backups_in(dir.path()).is_empty());
}

#[test]
fn snapshot_setup_error_message_is_fixed() {
    let failure = SetupError::Snapshot(SnapshotError::Io(std::io::Error::other("/ruta")));
    assert_eq!(failure.to_string(), "database snapshot unavailable");
}

fn insert_future_audit_row(bootstrap: &Bootstrap) -> String {
    bootstrap
        .database
        .with_conn(|conn| {
            let (stamp, stamp_utc): (String, String) = conn.query_row(
                "SELECT strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', '+1 day'), \
                        strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            conn.execute(
                "INSERT INTO audit_log (occurred_at, occurred_at_utc, action, entity) \
                 VALUES (?1, ?2, 'logout', 'system')",
                [&stamp, &stamp_utc],
            )?;
            Ok(stamp)
        })
        .unwrap()
}

fn rollback_rows(bootstrap: &Bootstrap) -> i64 {
    bootstrap
        .database
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT count(*) FROM audit_log WHERE action = 'clock_rollback'",
                [],
                |row| row.get(0),
            )?)
        })
        .unwrap()
}

#[test]
fn bootstrap_records_clock_rollback_notice() {
    let dir = tempfile::tempdir().unwrap();
    let store = isolated_store();
    let first = bootstrap(dir.path(), &store).unwrap();
    let recorded = insert_future_audit_row(&first);
    drop(first);

    let second = bootstrap(dir.path(), &store).unwrap();

    let notice = second.clock_rollback.clone().unwrap();
    assert_eq!(notice.last_recorded_at, recorded);
    assert_eq!(rollback_rows(&second), 1);
}

#[test]
fn bootstrap_without_rollback_has_no_notice_and_no_audit() {
    let dir = tempfile::tempdir().unwrap();
    let store = isolated_store();
    drop(bootstrap(dir.path(), &store).unwrap());

    let second = bootstrap(dir.path(), &store).unwrap();

    assert_eq!(second.clock_rollback, None);
    assert_eq!(rollback_rows(&second), 0);
}

fn installed_app(
    dir: &Path,
    store: &KeyStore,
) -> (
    tauri::App<tauri::test::MockRuntime>,
    Result<(), Box<dyn Error>>,
) {
    let mut app = tauri::test::mock_app();
    let outcome = install(&mut app, dir, store);
    (app, outcome)
}

#[test]
fn install_manages_every_state_the_commands_depend_on() {
    let dir = tempfile::tempdir().unwrap();
    let store = isolated_store();

    let (app, outcome) = installed_app(dir.path(), &store);

    outcome.unwrap();
    assert_eq!(
        app.state::<Database>()
            .with_conn(|conn| Ok(
                conn.query_row("SELECT count(*) FROM roles", [], |r| r.get::<_, i64>(0))?
            ))
            .unwrap(),
        3
    );
    assert_eq!(app.state::<ClockRollbackNotice>().0, None);
    assert!(app.try_state::<Arc<PasswordPolicy>>().is_some());
    assert!(app.try_state::<LoginThrottle>().is_some());
    assert!(app.state::<SessionState>().last_beat().unwrap().is_none());
}

#[test]
fn install_manages_the_backup_source_and_the_native_dialogs() {
    let dir = tempfile::tempdir().unwrap();
    let store = isolated_store();

    let (app, outcome) = installed_app(dir.path(), &store);

    outcome.unwrap();
    let source = app.state::<BackupSource>();
    assert_eq!(source.database_path, database_path(dir.path()));
    assert_eq!(
        source.key_store.read().unwrap().unwrap().as_hex(),
        store.read().unwrap().unwrap().as_hex()
    );
    assert!(app.try_state::<BackupDialogs>().is_some());
    assert!(app.try_state::<BackupBackground>().is_some());
}

#[test]
fn install_exposes_the_recorded_clock_rollback_to_the_frontend() {
    let dir = tempfile::tempdir().unwrap();
    let store = isolated_store();
    let first = bootstrap(dir.path(), &store).unwrap();
    let recorded = insert_future_audit_row(&first);
    drop(first);

    let (app, outcome) = installed_app(dir.path(), &store);

    outcome.unwrap();
    let notice = app.state::<ClockRollbackNotice>().0.clone().unwrap();
    assert_eq!(notice.last_recorded_at, recorded);
}

#[test]
fn install_manages_nothing_when_the_bootstrap_fails() {
    let dir = tempfile::tempdir().unwrap();
    let (store, service) = isolated_store_with_service();
    inject_keystore_failure(&service);

    let (app, outcome) = installed_app(dir.path(), &store);

    assert!(outcome.is_err());
    assert!(app.try_state::<BackupSource>().is_none());
    assert!(app.try_state::<BackupDialogs>().is_none());
    assert!(app.try_state::<BackupBackground>().is_none());
    assert!(app.try_state::<Database>().is_none());
    assert!(app.try_state::<SessionState>().is_none());
    assert!(app.try_state::<LoginThrottle>().is_none());
}

#[cfg(debug_assertions)]
fn row_count(bootstrap: &Bootstrap, table: &'static str) -> i64 {
    bootstrap
        .database
        .with_conn(|conn| {
            Ok(
                conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })?,
            )
        })
        .unwrap()
}

#[cfg(debug_assertions)]
#[test]
fn bootstrap_with_the_seed_variable_seeds_users_services_rates_clients_and_appointments() {
    let dir = tempfile::tempdir().unwrap();
    let store = isolated_store();
    let read_env = |name: &str| {
        (name == crate::dev_seed::SEED_PASSWORD_VAR).then(|| "clave-de-desarrollo-1".to_string())
    };

    let bootstrap = bootstrap_with(dir.path(), &store, snapshot_before_migrate, &read_env).unwrap();

    assert_eq!(row_count(&bootstrap, "users"), 3);
    assert_eq!(row_count(&bootstrap, "services"), 8);
    assert_eq!(row_count(&bootstrap, "exchange_rates"), 7);
    assert_eq!(row_count(&bootstrap, "clients"), 9);
    assert_eq!(row_count(&bootstrap, "appointments"), 16);
}

#[cfg(debug_assertions)]
#[test]
fn bootstrap_without_the_seed_variable_seeds_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let store = isolated_store();
    let read_env = |_: &str| None;

    let bootstrap = bootstrap_with(dir.path(), &store, snapshot_before_migrate, &read_env).unwrap();

    assert_eq!(row_count(&bootstrap, "users"), 0);
    assert_eq!(row_count(&bootstrap, "services"), 0);
    assert_eq!(row_count(&bootstrap, "exchange_rates"), 0);
    assert_eq!(row_count(&bootstrap, "clients"), 0);
    assert_eq!(row_count(&bootstrap, "appointments"), 0);
}

#[test]
fn backup_recovery_setup_error_message_is_fixed() {
    let failure = SetupError::Backup(crate::features::backup::errors::BackupError::Io(
        std::io::Error::other("/ruta/secreta"),
    ));
    assert_eq!(failure.to_string(), "backup recovery unavailable");
}

fn table_exists(bootstrap: &Bootstrap, name: &'static str) -> bool {
    bootstrap
        .database
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT count(*) FROM sqlite_master WHERE name = ?1",
                [name],
                |row| row.get::<_, i64>(0),
            )? == 1)
        })
        .unwrap()
}

#[test]
fn bootstrap_recovers_an_interrupted_restore_instead_of_creating_an_empty_database() {
    let dir = tempfile::tempdir().unwrap();
    let store = isolated_store();
    let first = bootstrap(dir.path(), &store).unwrap();
    first
        .database
        .with_conn(|conn| Ok(conn.execute_batch("CREATE TABLE datos_de_la_clienta (id INTEGER)")?))
        .unwrap();
    drop(first);
    let previous = crate::features::backup::leftovers::path_for(
        &database_path(dir.path()),
        "0000000000000003",
        crate::features::backup::leftovers::Leftover::Prev,
    );
    fs::rename(database_path(dir.path()), previous).unwrap();

    let second = bootstrap(dir.path(), &store).unwrap();

    assert!(table_exists(&second, "datos_de_la_clienta"));
}

#[test]
fn bootstrap_promotes_the_pending_key_when_the_database_only_opens_with_it() {
    let dir = tempfile::tempdir().unwrap();
    let store = isolated_store();
    drop(bootstrap(dir.path(), &store).unwrap());
    let real_key = store.read().unwrap().unwrap();
    store.write_pending(&real_key).unwrap();
    store.write(&crate::db::DbKey::generate().unwrap()).unwrap();

    let reopened = bootstrap(dir.path(), &store).unwrap();

    assert_eq!(role_count(&reopened), 3);
    assert_eq!(store.read().unwrap().unwrap().as_hex(), real_key.as_hex());
    assert!(store.read_pending().unwrap().is_none());
}
