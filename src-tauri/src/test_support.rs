use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;

use keyring_core::mock;

use crate::keystore::KeyStore;

static COUNTER: AtomicUsize = AtomicUsize::new(0);
static MOCK_STORE: OnceLock<()> = OnceLock::new();

pub(crate) fn isolated_store_with_service() -> (KeyStore, String) {
    MOCK_STORE.get_or_init(|| {
        keyring_core::set_default_store(mock::Store::new().unwrap());
    });
    let id = COUNTER.fetch_add(1, Ordering::SeqCst);
    let service = format!("com.progdarkness.spa.unit-{id}");
    (KeyStore::new(service.clone()), service)
}

pub(crate) fn isolated_store() -> KeyStore {
    isolated_store_with_service().0
}

#[cfg(test)]
#[path = "test_support_test.rs"]
mod tests;
