use argon2::password_hash::phc::PasswordHash;
use argon2::password_hash::Error as PasswordHashError;
use argon2::{Algorithm, Argon2, Params, PasswordHasher, PasswordVerifier, Version};

use super::concurrency::ConcurrencyLimit;
use super::service::AuthError;

const MEMORY_COST_KIB: u32 = 19456;
const TIME_COST: u32 = 2;
const PARALLELISM: u32 = 1;
const DUMMY_PASSWORD: &str = "contrasena-interna-para-igualar-tiempos";
pub const MAX_CONCURRENT_OPERATIONS: usize = 2;
pub const MIN_NEW_PASSWORD_CHARS: usize = 10;
const MAX_NEW_PASSWORD_BYTES: usize = 1024;
const NEW_PASSWORD_FIELD: &str = "password";

pub fn validate_new_password(password: &str) -> Result<(), AuthError> {
    let long_enough = password.chars().count() >= MIN_NEW_PASSWORD_CHARS;
    if long_enough && password.len() <= MAX_NEW_PASSWORD_BYTES {
        Ok(())
    } else {
        Err(AuthError::Validation(NEW_PASSWORD_FIELD))
    }
}

pub struct PasswordPolicy {
    pub(crate) argon2: Argon2<'static>,
    pub(crate) dummy_hash: String,
    pub(crate) slots: ConcurrencyLimit,
    #[cfg(test)]
    verifications: std::sync::atomic::AtomicUsize,
    #[cfg(test)]
    hashes: std::sync::atomic::AtomicUsize,
}

fn build_argon2() -> Result<Argon2<'static>, AuthError> {
    let params =
        Params::new(MEMORY_COST_KIB, TIME_COST, PARALLELISM, None).map_err(|_| AuthError::Hash)?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

impl PasswordPolicy {
    pub fn new() -> Result<Self, AuthError> {
        let mut policy = Self {
            argon2: build_argon2()?,
            dummy_hash: String::new(),
            slots: ConcurrencyLimit::new(MAX_CONCURRENT_OPERATIONS),
            #[cfg(test)]
            verifications: std::sync::atomic::AtomicUsize::new(0),
            #[cfg(test)]
            hashes: std::sync::atomic::AtomicUsize::new(0),
        };
        policy.dummy_hash = policy.hash(DUMMY_PASSWORD)?;
        Ok(policy)
    }

    pub fn hash(&self, password: &str) -> Result<String, AuthError> {
        let _slot = self.slots.acquire();
        #[cfg(test)]
        self.hashes
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.argon2
            .hash_password(password.as_bytes())
            .map(|hash| hash.to_string())
            .map_err(|_| AuthError::Hash)
    }

    #[cfg(test)]
    pub(crate) fn hash_count(&self) -> usize {
        self.hashes.load(std::sync::atomic::Ordering::SeqCst)
    }

    #[cfg(test)]
    pub(crate) fn verification_count(&self) -> usize {
        self.verifications.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn verify(&self, password: &str, stored: Option<&str>) -> Result<bool, AuthError> {
        let _slot = self.slots.acquire();
        #[cfg(test)]
        self.verifications
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let candidate = stored.unwrap_or(&self.dummy_hash);
        let parsed = PasswordHash::new(candidate).map_err(|_| AuthError::Hash)?;
        match self.argon2.verify_password(password.as_bytes(), &parsed) {
            Ok(()) => Ok(stored.is_some()),
            Err(PasswordHashError::PasswordInvalid) => Ok(false),
            Err(_) => Err(AuthError::Hash),
        }
    }
}

#[cfg(test)]
#[path = "password_test.rs"]
mod tests;
