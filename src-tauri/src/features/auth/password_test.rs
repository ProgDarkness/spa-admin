use std::sync::Arc;

use super::*;
use crate::errors::{AppError, AppErrorCode};

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

#[test]
fn password_min_10_chars() {
    assert!(matches!(
        validate_new_password(&"a".repeat(9)),
        Err(AuthError::Validation("password"))
    ));
    assert!(validate_new_password(&"a".repeat(10)).is_ok());
    assert!(matches!(
        validate_new_password(""),
        Err(AuthError::Validation("password"))
    ));
}

#[test]
fn password_min_counts_code_points_not_bytes() {
    assert!(validate_new_password(&"ñ".repeat(10)).is_ok());
    assert!(validate_new_password(&"🔐".repeat(10)).is_ok());
    assert!(matches!(
        validate_new_password(&"🔐".repeat(9)),
        Err(AuthError::Validation("password"))
    ));
    assert!(matches!(
        validate_new_password(&"ñ".repeat(9)),
        Err(AuthError::Validation("password"))
    ));
}

#[test]
fn password_too_long_rejected() {
    assert!(validate_new_password(&"a".repeat(1024)).is_ok());
    assert!(matches!(
        validate_new_password(&"a".repeat(1025)),
        Err(AuthError::Validation("password"))
    ));
    assert!(matches!(
        validate_new_password(&"ñ".repeat(513)),
        Err(AuthError::Validation("password"))
    ));
}

#[test]
fn weak_password_rejected_with_field_password() {
    let failure = AppError::from(validate_new_password("corta").unwrap_err());

    assert_eq!(failure.code, AppErrorCode::Validation);
    assert_eq!(failure.field.as_deref(), Some("password"));
}

#[test]
fn composition_rules_are_not_enforced() {
    assert!(validate_new_password("aaaaaaaaaa").is_ok());
    assert!(validate_new_password("          ").is_ok());
}

fn saturate(policy: &PasswordPolicy) -> Vec<crate::features::auth::concurrency::Permit<'_>> {
    (0..MAX_CONCURRENT_OPERATIONS)
        .map(|_| policy.slots.acquire())
        .collect()
}

fn completes_while_saturated(operation: impl FnOnce(&PasswordPolicy) + Send + 'static) -> bool {
    let policy = Arc::new(policy());
    let permits = saturate(&policy);
    let finished = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (worker_policy, worker_flag) = (Arc::clone(&policy), Arc::clone(&finished));
    let worker = std::thread::spawn(move || {
        operation(&worker_policy);
        worker_flag.store(true, std::sync::atomic::Ordering::SeqCst);
    });
    policy.slots.wait_until_waiting(1);
    let finished_early = finished.load(std::sync::atomic::Ordering::SeqCst);
    drop(permits);
    worker.join().unwrap();
    finished_early
}

#[test]
fn hash_waits_for_a_free_slot() {
    assert!(!completes_while_saturated(|policy| {
        policy.hash("clave-segura").unwrap();
    }));
}

#[test]
fn verify_waits_for_a_free_slot() {
    assert!(!completes_while_saturated(|policy| {
        policy.verify("clave", None).unwrap();
    }));
}

#[test]
fn slots_are_released_when_verify_fails_on_a_malformed_hash() {
    let policy = policy();
    assert!(policy.verify("clave", Some("no-es-un-hash")).is_err());
    assert_eq!(policy.slots.in_use(), 0);
}
