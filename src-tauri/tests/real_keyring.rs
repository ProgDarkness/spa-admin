#![cfg(feature = "real-keyring")]

use std::time::{SystemTime, UNIX_EPOCH};

use spa_app_lib::db::{open_encrypted, DbKey};
use spa_app_lib::keystore::{init_native_store, KeyStore, DB_KEY_ACCOUNT};

const KNOWN_HEX: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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
