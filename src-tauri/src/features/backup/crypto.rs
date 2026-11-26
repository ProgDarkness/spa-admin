use std::fmt;

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

use super::errors::BackupError;
use super::format::{BackupHeader, KdfParams, HEADER_LEN, NONCE_LEN, SALT_LEN};

pub const MIN_PASSPHRASE_CHARS: usize = 12;
pub const MAX_PASSPHRASE_BYTES: usize = 1024;
const PASSPHRASE_FIELD: &str = "passphrase";
const DERIVED_KEY_LEN: usize = 32;

pub struct BackupPassphrase(Zeroizing<String>);

impl BackupPassphrase {
    pub fn new(raw: String) -> Result<Self, BackupError> {
        let raw = Zeroizing::new(raw);
        let composed = composed_without_stray_copies(&raw);
        let long_enough = composed.chars().count() >= MIN_PASSPHRASE_CHARS;
        if long_enough && composed.len() <= MAX_PASSPHRASE_BYTES {
            Ok(Self(composed))
        } else {
            Err(BackupError::Validation {
                field: PASSPHRASE_FIELD,
            })
        }
    }
}

fn composed_without_stray_copies(raw: &str) -> Zeroizing<String> {
    let mut composed = Zeroizing::new(String::with_capacity(raw.len()));
    for character in raw.nfc() {
        if composed.capacity() - composed.len() < character.len_utf8() {
            let mut grown = Zeroizing::new(String::with_capacity(composed.capacity() * 2 + 4));
            grown.push_str(&composed);
            composed = grown;
        }
        composed.push(character);
    }
    composed
}

impl fmt::Debug for BackupPassphrase {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("BackupPassphrase(<redacted>)")
    }
}

pub struct OpenedBackup {
    pub header: BackupHeader,
    pub plaintext: Zeroizing<Vec<u8>>,
}

fn derive_key(
    passphrase: &BackupPassphrase,
    kdf: KdfParams,
    salt: &[u8; SALT_LEN],
) -> Result<Zeroizing<[u8; DERIVED_KEY_LEN]>, BackupError> {
    let params = Params::new(
        kdf.memory_kib,
        kdf.iterations,
        kdf.parallelism,
        Some(DERIVED_KEY_LEN),
    )
    .map_err(|_| BackupError::Crypto)?;
    let mut key = Zeroizing::new([0u8; DERIVED_KEY_LEN]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.0.as_bytes(), salt, key.as_mut_slice())
        .map_err(|_| BackupError::Crypto)?;
    Ok(key)
}

fn cipher_for(key: &[u8; DERIVED_KEY_LEN]) -> Result<XChaCha20Poly1305, BackupError> {
    XChaCha20Poly1305::new_from_slice(key).map_err(|_| BackupError::Crypto)
}

fn random_bytes<const N: usize>() -> Result<[u8; N], BackupError> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|_| BackupError::Crypto)?;
    Ok(bytes)
}

pub fn seal(
    passphrase: &BackupPassphrase,
    kdf: KdfParams,
    schema_version: u32,
    plaintext: &[u8],
) -> Result<Vec<u8>, BackupError> {
    let header = BackupHeader {
        schema_version,
        kdf,
        salt: random_bytes::<SALT_LEN>()?,
        nonce: random_bytes::<NONCE_LEN>()?,
    };
    let encoded_header = header.encode();
    let key = derive_key(passphrase, kdf, &header.salt)?;
    let ciphertext = cipher_for(&key)?
        .encrypt(
            &XNonce::from(header.nonce),
            Payload {
                msg: plaintext,
                aad: &encoded_header,
            },
        )
        .map_err(|_| BackupError::Crypto)?;
    let mut file = Vec::with_capacity(HEADER_LEN + ciphertext.len());
    file.extend_from_slice(&encoded_header);
    file.extend_from_slice(&ciphertext);
    Ok(file)
}

pub fn open(passphrase: &BackupPassphrase, file: &[u8]) -> Result<OpenedBackup, BackupError> {
    let header = BackupHeader::parse(file)?;
    let key = derive_key(passphrase, header.kdf, &header.salt)?;
    let plaintext = cipher_for(&key)?
        .decrypt(
            &XNonce::from(header.nonce),
            Payload {
                msg: &file[HEADER_LEN..],
                aad: &file[..HEADER_LEN],
            },
        )
        .map_err(|_| BackupError::Unreadable)?;
    Ok(OpenedBackup {
        header,
        plaintext: Zeroizing::new(plaintext),
    })
}

#[cfg(test)]
#[path = "crypto_test.rs"]
mod tests;
