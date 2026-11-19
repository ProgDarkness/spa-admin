use super::*;

#[test]
fn isolated_stores_get_distinct_services() {
    let (_, first) = isolated_store_with_service();
    let (_, second) = isolated_store_with_service();
    assert_ne!(first, second);
}

#[test]
fn isolated_store_starts_without_a_key() {
    let store = isolated_store();
    assert!(store.read().unwrap().is_none());
}
