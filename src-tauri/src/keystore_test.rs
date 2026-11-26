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

fn other_key() -> DbKey {
    DbKey::from_hex("cd".repeat(32)).unwrap()
}

fn pending_entry_of(store: &KeyStore) -> keyring_core::Entry {
    keyring_core::Entry::new(&store.service, PENDING_KEY_ACCOUNT).unwrap()
}

#[test]
fn a_pending_key_is_stored_apart_from_the_main_key() {
    let store = isolated_store();
    store.write(&sample_key()).unwrap();

    store.write_pending(&other_key()).unwrap();

    assert_eq!(
        store.read_pending().unwrap().unwrap().as_hex(),
        "cd".repeat(32)
    );
    assert_eq!(store.read().unwrap().unwrap().as_hex(), "ab".repeat(32));
}

#[test]
fn reading_a_pending_key_that_was_never_written_returns_none() {
    let store = isolated_store();

    assert!(store.read_pending().unwrap().is_none());
}

#[test]
fn deleting_the_pending_key_removes_it_and_is_idempotent() {
    let store = isolated_store();
    store.write_pending(&other_key()).unwrap();

    store.delete_pending().unwrap();
    store.delete_pending().unwrap();

    assert!(store.read_pending().unwrap().is_none());
}

#[test]
fn promoting_the_pending_key_replaces_the_main_key_and_clears_the_pending_one() {
    let store = isolated_store();
    store.write(&sample_key()).unwrap();
    store.write_pending(&other_key()).unwrap();

    store.promote_pending().unwrap();

    assert_eq!(store.read().unwrap().unwrap().as_hex(), "cd".repeat(32));
    assert!(store.read_pending().unwrap().is_none());
}

#[test]
fn promoting_without_a_pending_key_fails_and_keeps_the_main_key() {
    let store = isolated_store();
    store.write(&sample_key()).unwrap();

    let outcome = store.promote_pending();

    assert!(matches!(outcome, Err(KeyStoreError::MissingPending)));
    assert_eq!(store.read().unwrap().unwrap().as_hex(), "ab".repeat(32));
}

#[test]
fn a_malformed_pending_value_is_reported_and_never_promoted() {
    let store = isolated_store();
    store.write(&sample_key()).unwrap();
    pending_entry_of(&store).set_password("not-a-key").unwrap();

    assert!(matches!(
        store.read_pending(),
        Err(KeyStoreError::Malformed)
    ));
    assert!(matches!(
        store.promote_pending(),
        Err(KeyStoreError::Malformed)
    ));
    assert_eq!(store.read().unwrap().unwrap().as_hex(), "ab".repeat(32));
}
