use crate::db::DbKey;

pub const DB_KEY_ACCOUNT: &str = "sqlcipher-db-key";

#[derive(Debug, thiserror::Error)]
pub enum KeyStoreError {
    #[error("keychain operation failed")]
    Keyring(#[from] keyring_core::Error),
    #[error("stored database key is malformed")]
    Malformed,
    #[error("database key missing for an existing database")]
    MissingForExistingDb,
    #[error("secure random generation failed")]
    Random,
}

pub struct KeyStore {
    service: String,
}

impl KeyStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self) -> Result<keyring_core::Entry, KeyStoreError> {
        Ok(keyring_core::Entry::new(&self.service, DB_KEY_ACCOUNT)?)
    }

    pub fn read(&self) -> Result<Option<DbKey>, KeyStoreError> {
        match self.entry()?.get_password() {
            Ok(stored) => DbKey::from_hex(stored).map(Some),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(keyring_core::Error::BadEncoding(_) | keyring_core::Error::BadDataFormat(..)) => {
                Err(KeyStoreError::Malformed)
            }
            Err(other) => Err(other.into()),
        }
    }

    pub fn write(&self, key: &DbKey) -> Result<(), KeyStoreError> {
        Ok(self.entry()?.set_password(key.as_hex())?)
    }
}

pub fn init_native_store() -> Result<(), KeyStoreError> {
    match keyring::Entry::store_status() {
        Ok(()) => Ok(()),
        Err(_) => Err(KeyStoreError::Keyring(keyring_core::Error::NoDefaultStore)),
    }
}

pub fn load_or_create(store: &KeyStore, db_exists: bool) -> Result<DbKey, KeyStoreError> {
    if let Some(existing) = store.read()? {
        return Ok(existing);
    }
    if db_exists {
        return Err(KeyStoreError::MissingForExistingDb);
    }
    store.write(&DbKey::generate()?)?;
    store.read()?.ok_or(KeyStoreError::MissingForExistingDb)
}

#[cfg(test)]
#[path = "keystore_test.rs"]
mod tests;
