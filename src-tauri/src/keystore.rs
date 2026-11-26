use crate::db::DbKey;

pub const DB_KEY_ACCOUNT: &str = "sqlcipher-db-key";
pub const PENDING_KEY_ACCOUNT: &str = "sqlcipher-db-key-pending";

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
    #[error("pending database key missing")]
    MissingPending,
}

#[derive(Clone)]
pub struct KeyStore {
    service: String,
}

impl KeyStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    #[cfg(test)]
    pub(crate) fn service_name(&self) -> &str {
        &self.service
    }

    fn entry(&self, account: &str) -> Result<keyring_core::Entry, KeyStoreError> {
        Ok(keyring_core::Entry::new(&self.service, account)?)
    }

    fn read_account(&self, account: &str) -> Result<Option<DbKey>, KeyStoreError> {
        match self.entry(account)?.get_password() {
            Ok(stored) => DbKey::from_hex(stored).map(Some),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(keyring_core::Error::BadEncoding(_) | keyring_core::Error::BadDataFormat(..)) => {
                Err(KeyStoreError::Malformed)
            }
            Err(other) => Err(other.into()),
        }
    }

    fn write_account(&self, account: &str, key: &DbKey) -> Result<(), KeyStoreError> {
        Ok(self.entry(account)?.set_password(key.as_hex())?)
    }

    pub fn read(&self) -> Result<Option<DbKey>, KeyStoreError> {
        self.read_account(DB_KEY_ACCOUNT)
    }

    pub fn write(&self, key: &DbKey) -> Result<(), KeyStoreError> {
        self.write_account(DB_KEY_ACCOUNT, key)
    }

    pub fn read_pending(&self) -> Result<Option<DbKey>, KeyStoreError> {
        self.read_account(PENDING_KEY_ACCOUNT)
    }

    pub fn write_pending(&self, key: &DbKey) -> Result<(), KeyStoreError> {
        self.write_account(PENDING_KEY_ACCOUNT, key)
    }

    pub fn delete_pending(&self) -> Result<(), KeyStoreError> {
        match self.entry(PENDING_KEY_ACCOUNT)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(other) => Err(other.into()),
        }
    }

    pub fn promote_pending(&self) -> Result<(), KeyStoreError> {
        let pending = self.read_pending()?.ok_or(KeyStoreError::MissingPending)?;
        self.write(&pending)?;
        self.delete_pending()
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
