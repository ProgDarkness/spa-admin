use std::fmt;

use zeroize::Zeroizing;

use crate::keystore::KeyStoreError;

const KEY_BYTES: usize = 32;
const KEY_HEX_LEN: usize = KEY_BYTES * 2;

pub struct DbKey(Zeroizing<String>);

impl DbKey {
    pub fn generate() -> Result<Self, KeyStoreError> {
        let mut bytes = Zeroizing::new([0u8; KEY_BYTES]);
        getrandom::fill(bytes.as_mut_slice()).map_err(|_| KeyStoreError::Random)?;
        Ok(Self(Zeroizing::new(hex::encode(bytes.as_slice()))))
    }

    pub fn from_hex(candidate: String) -> Result<Self, KeyStoreError> {
        let wrapped = Zeroizing::new(candidate);
        if is_lowercase_hex_of_len(&wrapped, KEY_HEX_LEN) {
            Ok(Self(wrapped))
        } else {
            Err(KeyStoreError::Malformed)
        }
    }

    pub(crate) fn as_hex(&self) -> &str {
        &self.0
    }
}

fn is_lowercase_hex_of_len(text: &str, length: usize) -> bool {
    text.len() == length
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

impl fmt::Debug for DbKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DbKey(<redacted>)")
    }
}

#[cfg(test)]
#[path = "key_test.rs"]
mod tests;
