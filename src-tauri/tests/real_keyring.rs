#![cfg(feature = "real-keyring")]

use std::time::{SystemTime, UNIX_EPOCH};

use spa_app_lib::db::{open_encrypted, DbKey};
use spa_app_lib::keystore::{init_native_store, KeyStore, DB_KEY_ACCOUNT, PENDING_KEY_ACCOUNT};

const KNOWN_HEX: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PENDING_HEX: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

#[test]
fn real_keyring_roundtrip_and_opens_sqlcipher() {
    init_native_store().unwrap();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let service = format!("com.progdarkness.spa.test-{nanos}");
    let store = KeyStore::new(service.clone());
    let raw_entry = keyring_core::Entry::new(&service, DB_KEY_ACCOUNT).unwrap();

    store
        .write(&DbKey::from_hex(KNOWN_HEX.to_string()).unwrap())
        .unwrap();
    let stored_raw = raw_entry.get_password();
    let restored = store.read();
    let database_outcome = restored
        .as_ref()
        .ok()
        .and_then(Option::as_ref)
        .map(roundtrip_encrypted_database);
    raw_entry.delete_credential().unwrap();

    assert_eq!(stored_raw.unwrap(), KNOWN_HEX);
    assert!(restored.unwrap().is_some());
    assert_eq!(database_outcome, Some("hello".to_string()));
    assert!(store.read().unwrap().is_none());
}

fn roundtrip_encrypted_database(key: &DbKey) -> String {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("spa.db");
    open_encrypted(&path, key)
        .unwrap()
        .execute_batch("CREATE TABLE t(v TEXT); INSERT INTO t VALUES ('hello');")
        .unwrap();
    open_encrypted(&path, key)
        .unwrap()
        .query_row("SELECT v FROM t", [], |row| row.get(0))
        .unwrap()
}

#[test]
fn real_keyring_pending_account_is_promoted_over_the_main_account() {
    init_native_store().unwrap();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let service = format!("com.progdarkness.spa.test-pending-{nanos}");
    let store = KeyStore::new(service.clone());
    let main_entry = keyring_core::Entry::new(&service, DB_KEY_ACCOUNT).unwrap();
    let pending_entry = keyring_core::Entry::new(&service, PENDING_KEY_ACCOUNT).unwrap();

    store
        .write(&DbKey::from_hex(KNOWN_HEX.to_string()).unwrap())
        .unwrap();
    store
        .write_pending(&DbKey::from_hex(PENDING_HEX.to_string()).unwrap())
        .unwrap();
    let pending_raw = pending_entry.get_password();
    let main_before_promotion = main_entry.get_password();
    let promotion = store.promote_pending();
    let main_after_promotion = main_entry.get_password();
    let pending_after_promotion = store.read_pending();
    main_entry.delete_credential().unwrap();
    let cleanup = store.delete_pending();

    assert_eq!(pending_raw.unwrap(), PENDING_HEX);
    assert_eq!(main_before_promotion.unwrap(), KNOWN_HEX);
    promotion.unwrap();
    assert_eq!(main_after_promotion.unwrap(), PENDING_HEX);
    assert!(pending_after_promotion.unwrap().is_none());
    cleanup.unwrap();
}
