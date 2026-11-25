use serde::Serialize;
use thiserror::Error;

use crate::db::DbError;
use crate::errors::AppError;
use crate::features::auth::service::AuthError;
use crate::features::named_records::RecordFailure;

pub const MAX_RATE_E4: i64 = 100_000_000_000;

const DATE_LENGTH: usize = 10;
const FIRST_RATE_YEAR: u32 = 2000;
const LAST_RATE_YEAR: u32 = 2099;
const MONTHS_IN_YEAR: u32 = 12;

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeRate {
    pub date: String,
    pub rate_bs_per_usd_e4: i64,
}

pub(crate) const LOG_SCOPE: &str = "rates";

#[derive(Debug, Error)]
pub enum RatesError {
    #[error("auth failure")]
    Auth(#[from] AuthError),
    #[error("database failure")]
    Db(#[from] DbError),
    #[error("validation failed")]
    Validation { field: &'static str },
}

impl From<RatesError> for AppError {
    fn from(error: RatesError) -> Self {
        match error {
            RatesError::Auth(inner) => AppError::from(inner),
            RatesError::Validation { field } => {
                RecordFailure::Validation { field }.into_app_error(LOG_SCOPE)
            }
            RatesError::Db(inner) => RecordFailure::Db(inner).into_app_error(LOG_SCOPE),
        }
    }
}

fn is_leap_year(year: u32) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        2 if is_leap_year(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn number_in(digits: &[u8]) -> Option<u32> {
    digits.iter().try_fold(0u32, |total, byte| {
        byte.is_ascii_digit()
            .then(|| total * 10 + u32::from(byte - b'0'))
    })
}

pub fn is_calendar_date(candidate: &str) -> bool {
    let bytes = candidate.as_bytes();
    if bytes.len() != DATE_LENGTH || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    match (
        number_in(&bytes[0..4]),
        number_in(&bytes[5..7]),
        number_in(&bytes[8..10]),
    ) {
        (Some(year), Some(month), Some(day)) => {
            (FIRST_RATE_YEAR..=LAST_RATE_YEAR).contains(&year)
                && (1..=MONTHS_IN_YEAR).contains(&month)
                && (1..=days_in_month(year, month)).contains(&day)
        }
        _ => false,
    }
}

#[cfg(test)]
#[path = "model_test.rs"]
mod tests;
