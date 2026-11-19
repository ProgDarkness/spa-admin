use std::fmt;

use zeroize::Zeroizing;

use super::service::AuthError;

pub const RECOVERY_ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
pub const RECOVERY_CODE_CHARS: usize = 20;
pub const RECOVERY_GROUP: usize = 4;
const SYMBOL_MASK: u8 = 0x1F;
const GROUP_SEPARATOR: char = '-';
const IGNORED_WHEN_PARSING: [char; 2] = [GROUP_SEPARATOR, ' '];

pub struct RecoveryCode(Zeroizing<String>);

fn is_alphabet_symbol(symbol: char) -> bool {
    symbol.is_ascii() && RECOVERY_ALPHABET.contains(&(symbol as u8))
}

impl RecoveryCode {
    pub fn generate() -> Result<Self, AuthError> {
        let mut entropy = Zeroizing::new([0u8; RECOVERY_CODE_CHARS]);
        getrandom::fill(entropy.as_mut_slice()).map_err(|_| AuthError::Hash)?;
        let mut symbols = Zeroizing::new(String::with_capacity(RECOVERY_CODE_CHARS));
        for byte in entropy.iter() {
            symbols.push(RECOVERY_ALPHABET[usize::from(byte & SYMBOL_MASK)] as char);
        }
        Ok(Self(symbols))
    }

    pub fn parse(candidate: &str) -> Option<Self> {
        let mut canonical = Zeroizing::new(String::with_capacity(RECOVERY_CODE_CHARS));
        for symbol in candidate
            .chars()
            .filter(|symbol| !IGNORED_WHEN_PARSING.contains(symbol))
            .take(RECOVERY_CODE_CHARS + 1)
        {
            canonical.push(symbol.to_ascii_uppercase());
        }
        let is_valid = canonical.chars().count() == RECOVERY_CODE_CHARS
            && canonical.chars().all(is_alphabet_symbol);
        is_valid.then_some(Self(canonical))
    }

    pub fn canonical(&self) -> &str {
        &self.0
    }

    pub fn formatted(&self) -> Zeroizing<String> {
        let mut grouped = Zeroizing::new(String::with_capacity(
            RECOVERY_CODE_CHARS + RECOVERY_CODE_CHARS / RECOVERY_GROUP,
        ));
        for (index, symbol) in self.0.chars().enumerate() {
            if index > 0 && index % RECOVERY_GROUP == 0 {
                grouped.push(GROUP_SEPARATOR);
            }
            grouped.push(symbol);
        }
        grouped
    }
}

impl fmt::Debug for RecoveryCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RecoveryCode(***)")
    }
}

#[cfg(test)]
#[path = "recovery_test.rs"]
mod tests;
