use crate::features::auth::username::is_allowed_text_character;

pub const MAX_AMOUNT_CENTS: i64 = 100_000_000_000;
pub const MAX_JS_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
pub const MAX_RATE_E4: i64 = 100_000_000_000;
pub const MAX_VOID_REASON_CHARS: usize = 200;

const RATE_SCALE: i128 = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EquivalentError {
    Amount,
    Rate,
}

pub fn usd_equivalent_cents(amount_cents: i64, rate_e4: i64) -> Result<i64, EquivalentError> {
    if !(0..=MAX_AMOUNT_CENTS).contains(&amount_cents) {
        return Err(EquivalentError::Amount);
    }
    if !(1..=MAX_RATE_E4).contains(&rate_e4) {
        return Err(EquivalentError::Rate);
    }
    let amount = i128::from(amount_cents);
    let rate = i128::from(rate_e4);
    let rounded_half_up = (2 * amount * RATE_SCALE + rate) / (2 * rate);
    i64::try_from(rounded_half_up)
        .ok()
        .filter(|equivalent| *equivalent <= MAX_JS_SAFE_INTEGER)
        .ok_or(EquivalentError::Amount)
}

pub fn valid_void_reason(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let length = trimmed.chars().count();
    let is_clean = trimmed.chars().all(is_allowed_text_character);
    ((1..=MAX_VOID_REASON_CHARS).contains(&length) && is_clean).then(|| trimmed.to_string())
}

#[cfg(test)]
#[path = "rules_test.rs"]
mod tests;
