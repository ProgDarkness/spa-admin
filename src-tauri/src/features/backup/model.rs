use std::path::PathBuf;

use serde::Serialize;

use crate::keystore::KeyStore;

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupExported {
    pub file_name: String,
    pub created_at: String,
}

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub source_schema_version: u32,
    pub schema_version: u32,
}

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub last_backup_at: Option<String>,
    pub is_due: bool,
}

pub struct BackupSource {
    pub database_path: PathBuf,
    pub key_store: KeyStore,
}

#[cfg(test)]
#[path = "model_test.rs"]
mod tests;
