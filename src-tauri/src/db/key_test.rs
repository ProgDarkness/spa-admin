use super::*;

fn valid_hex() -> String {
    "0123456789abcdef".repeat(4)
}

fn is_lower_hex(text: &str) -> bool {
    text.bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[test]
fn generate_yields_64_lowercase_hex_chars() {
    let key = DbKey::generate().unwrap();
    assert_eq!(key.as_hex().len(), 64);
    assert!(is_lower_hex(key.as_hex()));
}

#[test]
fn generate_yields_distinct_keys() {
    let first = DbKey::generate().unwrap();
    let second = DbKey::generate().unwrap();
    assert_ne!(first.as_hex(), second.as_hex());
}

#[test]
fn from_hex_accepts_valid_key() {
    let key = DbKey::from_hex(valid_hex()).unwrap();
    assert_eq!(key.as_hex(), valid_hex());
}

#[test]
fn from_hex_rejects_uppercase() {
    let result = DbKey::from_hex("0123456789ABCDEF".repeat(4));
    assert!(matches!(result, Err(KeyStoreError::Malformed)));
}

#[test]
fn from_hex_rejects_wrong_length() {
    for candidate in ["ab".repeat(31), "ab".repeat(33), String::new()] {
        assert!(matches!(
            DbKey::from_hex(candidate),
            Err(KeyStoreError::Malformed)
        ));
    }
}

#[test]
fn from_hex_rejects_non_hex() {
    let mut candidate = valid_hex();
    candidate.replace_range(10..11, "g");
    assert!(matches!(
        DbKey::from_hex(candidate),
        Err(KeyStoreError::Malformed)
    ));
}

#[test]
fn debug_never_contains_the_key() {
    let key = DbKey::from_hex(valid_hex()).unwrap();
    let rendered = format!("{key:?}");
    assert_eq!(rendered, "DbKey(<redacted>)");
    assert!(!rendered.contains("0123"));
}
