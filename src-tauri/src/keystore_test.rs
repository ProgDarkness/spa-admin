use super::*;
use crate::test_support::isolated_store;
use keyring_core::mock;

fn entry_of(store: &KeyStore) -> keyring_core::Entry {
    keyring_core::Entry::new(&store.service, DB_KEY_ACCOUNT).unwrap()
}

fn sample_key() -> DbKey {
    DbKey::from_hex("ab".repeat(32)).unwrap()
}

#[test]
fn memory_store_returns_saved_key() {
    let store = isolated_store();
    assert!(store.read().unwrap().is_none());
    store.write(&sample_key()).unwrap();
    assert_eq!(store.read().unwrap().unwrap().as_hex(), "ab".repeat(32));
}

#[test]
fn load_or_create_generates_32_byte_key_once() {
    let store = isolated_store();
    let first = load_or_create(&store, false).unwrap();
    assert_eq!(hex::decode(first.as_hex()).unwrap().len(), 32);
    let second = load_or_create(&store, true).unwrap();
    assert_eq!(first.as_hex(), second.as_hex());
}

#[test]
fn load_or_create_fails_with_missing_key_for_existing_db() {
    let store = isolated_store();
    let result = load_or_create(&store, true);
    assert!(matches!(result, Err(KeyStoreError::MissingForExistingDb)));
    assert!(store.read().unwrap().is_none());
}

#[test]
fn load_or_create_rejects_malformed_stored_value() {
    let store = isolated_store();
    entry_of(&store).set_password("not-a-key").unwrap();
    let result = load_or_create(&store, false);
    assert!(matches!(result, Err(KeyStoreError::Malformed)));
}

#[test]
fn load_or_create_propagates_store_error_without_writing() {
    let store = isolated_store();
    let entry = entry_of(&store);
    let cred = entry.as_any().downcast_ref::<mock::Cred>().unwrap();
    cred.set_error(keyring_core::Error::NoStorageAccess(Box::new(
        std::io::Error::other("denied"),
    )));
    let result = load_or_create(&store, false);
    assert!(matches!(result, Err(KeyStoreError::Keyring(_))));
    assert!(matches!(
        entry.get_password(),
        Err(keyring_core::Error::NoEntry)
    ));
}
