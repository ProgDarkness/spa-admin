use std::ops::RangeInclusive;

use super::errors::BackupError;
use crate::db::migrations::supported_version;

pub const HEADER_LEN: usize = 66;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 24;
pub const MAX_BACKUP_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KdfParams {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl KdfParams {
    pub const EXPORT: Self = Self {
        memory_kib: 65536,
        iterations: 3,
        parallelism: 1,
    };
    pub const LOWEST_ACCEPTED: Self = Self {
        memory_kib: 19456,
        iterations: 1,
        parallelism: 1,
    };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BackupHeader {
    pub schema_version: u32,
    pub kdf: KdfParams,
    pub salt: [u8; SALT_LEN],
    pub nonce: [u8; NONCE_LEN],
}

const MAGIC: [u8; 8] = *b"SPABAK\0\0";
const FORMAT_VERSION: u16 = 1;
const MEMORY_KIB_RANGE: RangeInclusive<u32> = 19456..=131_072;
const ITERATIONS_RANGE: RangeInclusive<u32> = 1..=6;
const PARALLELISM_RANGE: RangeInclusive<u32> = 1..=4;

const FORMAT_VERSION_OFFSET: usize = 8;
const SCHEMA_VERSION_OFFSET: usize = 10;
const MEMORY_OFFSET: usize = 14;
const ITERATIONS_OFFSET: usize = 18;
const PARALLELISM_OFFSET: usize = 22;
const SALT_OFFSET: usize = 26;
const NONCE_OFFSET: usize = SALT_OFFSET + SALT_LEN;

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    let mut word = [0u8; 4];
    word.copy_from_slice(&bytes[offset..offset + 4]);
    u32::from_le_bytes(word)
}

fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn read_array<const N: usize>(bytes: &[u8], offset: usize) -> [u8; N] {
    let mut array = [0u8; N];
    array.copy_from_slice(&bytes[offset..offset + N]);
    array
}

impl KdfParams {
    fn is_accepted(self) -> bool {
        MEMORY_KIB_RANGE.contains(&self.memory_kib)
            && ITERATIONS_RANGE.contains(&self.iterations)
            && PARALLELISM_RANGE.contains(&self.parallelism)
    }
}

impl BackupHeader {
    pub fn encode(&self) -> [u8; HEADER_LEN] {
        let mut bytes = [0u8; HEADER_LEN];
        bytes[..MAGIC.len()].copy_from_slice(&MAGIC);
        bytes[FORMAT_VERSION_OFFSET..SCHEMA_VERSION_OFFSET]
            .copy_from_slice(&FORMAT_VERSION.to_le_bytes());
        write_u32(&mut bytes, SCHEMA_VERSION_OFFSET, self.schema_version);
        write_u32(&mut bytes, MEMORY_OFFSET, self.kdf.memory_kib);
        write_u32(&mut bytes, ITERATIONS_OFFSET, self.kdf.iterations);
        write_u32(&mut bytes, PARALLELISM_OFFSET, self.kdf.parallelism);
        bytes[SALT_OFFSET..NONCE_OFFSET].copy_from_slice(&self.salt);
        bytes[NONCE_OFFSET..].copy_from_slice(&self.nonce);
        bytes
    }

    pub fn parse(file: &[u8]) -> Result<Self, BackupError> {
        if file.len() < HEADER_LEN || file[..MAGIC.len()] != MAGIC {
            return Err(BackupError::NotRecognized);
        }
        let format_version = u16::from_le_bytes(read_array(file, FORMAT_VERSION_OFFSET));
        let kdf = KdfParams {
            memory_kib: read_u32(file, MEMORY_OFFSET),
            iterations: read_u32(file, ITERATIONS_OFFSET),
            parallelism: read_u32(file, PARALLELISM_OFFSET),
        };
        let schema_version = read_u32(file, SCHEMA_VERSION_OFFSET);
        if format_version != FORMAT_VERSION || !kdf.is_accepted() || schema_version == 0 {
            return Err(BackupError::NotRecognized);
        }
        if schema_version > supported_version() {
            return Err(BackupError::FromNewerApp);
        }
        Ok(Self {
            schema_version,
            kdf,
            salt: read_array(file, SALT_OFFSET),
            nonce: read_array(file, NONCE_OFFSET),
        })
    }
}

pub fn require_acceptable_size(length: u64) -> Result<(), BackupError> {
    if length > MAX_BACKUP_BYTES {
        Err(BackupError::NotRecognized)
    } else {
        Ok(())
    }
}

#[cfg(test)]
#[path = "format_test.rs"]
mod tests;
