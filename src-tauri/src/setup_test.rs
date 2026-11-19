use std::fs;
use std::path::PathBuf;

use keyring_core::mock;

use super::*;
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
