use super::model::{MetricsError, MONTH_FIELD};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonthBounds {
    pub start: String,
    pub end: String,
}

const MONTH_LENGTH: usize = 7;
const YEAR_DIGITS: usize = 4;
const FIRST_YEAR: u32 = 1;
const LAST_YEAR: u32 = 9998;

fn rejected() -> MetricsError {
    MetricsError::Validation { field: MONTH_FIELD }
}

fn digits(raw: &str) -> Option<u32> {
    raw.bytes()
        .all(|byte| byte.is_ascii_digit())
        .then(|| raw.parse().ok())
        .flatten()
}

fn parse_month(month: &str) -> Option<(u32, u32)> {
    let (year, number) = month.split_once('-')?;
    let is_shaped = month.len() == MONTH_LENGTH && year.len() == YEAR_DIGITS;
    let year = digits(year).filter(|year| is_shaped && (FIRST_YEAR..=LAST_YEAR).contains(year))?;
    let number = digits(number).filter(|number| (1..=12).contains(number))?;
    Some((year, number))
}

fn first_minute_of(year: u32, month: u32) -> String {
    format!("{year:04}-{month:02}-01T00:00")
}

pub fn month_bounds(month: &str) -> Result<MonthBounds, MetricsError> {
    let (year, number) = parse_month(month).ok_or_else(rejected)?;
    let (next_year, next_number) = if number == 12 {
        (year + 1, 1)
    } else {
        (year, number + 1)
    };
    Ok(MonthBounds {
        start: first_minute_of(year, number),
        end: first_minute_of(next_year, next_number),
    })
}

#[cfg(test)]
#[path = "rules_test.rs"]
mod tests;
