use super::*;

fn policy() -> PasswordPolicy {
    PasswordPolicy::new().unwrap()
}

#[test]
fn hash_is_argon2id_phc() {
    let hash = policy().hash("clave-segura").unwrap();
    assert!(
        hash.starts_with("$argon2id$v=19$m=19456,t=2,p=1$"),
        "unexpected hash prefix"
    );
    assert!(!hash.contains("clave-segura"));
}

#[test]
fn hashes_of_the_same_password_use_different_salts() {
    let policy = policy();
    let first = policy.hash("clave-segura").unwrap();
    let second = policy.hash("clave-segura").unwrap();
    assert_ne!(first, second);
}

#[test]
fn verify_accepts_correct_and_rejects_wrong() {
    let policy = policy();
    let stored = policy.hash("clave-segura").unwrap();
    assert!(policy.verify("clave-segura", Some(&stored)).unwrap());
    assert!(!policy.verify("otra-clave", Some(&stored)).unwrap());
    assert!(!policy.verify("", Some(&stored)).unwrap());
}

#[test]
fn verify_none_runs_dummy_and_returns_false() {
    let policy = policy();
    assert!(!policy.verify("clave-segura", None).unwrap());
    assert!(!policy.verify("", None).unwrap());
    assert_eq!(policy.verification_count(), 2);
}

#[test]
fn verify_none_never_accepts_the_dummy_password_itself() {
    let policy = policy();
    assert!(!policy.verify(DUMMY_PASSWORD, None).unwrap());
}

#[test]
fn dummy_hash_shares_the_policy_parameters() {
    let policy = policy();
    assert!(policy
        .dummy_hash
        .starts_with("$argon2id$v=19$m=19456,t=2,p=1$"));
}

#[test]
fn verify_rejects_malformed_stored_hash_as_error() {
    let policy = policy();
    let result = policy.verify("clave-segura", Some("no-es-un-hash-phc"));
    assert!(matches!(result, Err(AuthError::Hash)));
}

#[test]
fn verify_rejects_hash_of_unsupported_algorithm_as_error() {
    let policy = policy();
    let result = policy.verify("clave-segura", Some("$bcrypt$v=1$abc$def"));
    assert!(matches!(result, Err(AuthError::Hash)));
}

#[test]
fn hash_and_verify_handle_unicode_and_long_passwords() {
    let policy = policy();
    let password = "contraseña-ñandú-🔐-".repeat(40);
    let stored = policy.hash(&password).unwrap();
    assert!(policy.verify(&password, Some(&stored)).unwrap());
}
