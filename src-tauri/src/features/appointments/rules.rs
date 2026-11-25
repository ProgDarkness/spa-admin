use super::model::{AppointmentStatus, AppointmentTransition};

const START_STEP_MIN: i64 = 5;
const MINUTES_PER_HOUR: i64 = 60;
const MINUTES_PER_DAY: i64 = 1_440;
const LOCAL_MINUTE_LENGTH: usize = 16;
const LOCAL_DATE_LENGTH: usize = 10;
const LAST_REPRESENTABLE_YEAR: i64 = 9_999;
const DAYS_FROM_CIVIL_ZERO_TO_UNIX_EPOCH: i64 = 719_468;
const DAYS_PER_ERA: i64 = 146_097;
const YEARS_PER_ERA: i64 = 400;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlotError {
    InvalidStart,
    CrossesMidnight,
}

#[derive(Clone, Copy)]
struct CivilDate {
    year: i64,
    month: u32,
    day: u32,
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        2 if is_leap_year(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn digits(text: &str) -> Option<u32> {
    if text.bytes().all(|byte| byte.is_ascii_digit()) {
        text.parse().ok()
    } else {
        None
    }
}

fn has_separators(text: &str, separators: &[(usize, u8)]) -> bool {
    separators
        .iter()
        .all(|(index, expected)| text.as_bytes().get(*index) == Some(expected))
}

fn parse_date(text: &str) -> Option<CivilDate> {
    if text.len() != LOCAL_DATE_LENGTH
        || !text.is_ascii()
        || !has_separators(text, &[(4, b'-'), (7, b'-')])
    {
        return None;
    }
    let date = CivilDate {
        year: i64::from(digits(&text[0..4])?),
        month: digits(&text[5..7])?,
        day: digits(&text[8..10])?,
    };
    let exists = (1..=12).contains(&date.month)
        && (1..=days_in_month(date.year, date.month)).contains(&date.day);
    exists.then_some(date)
}

fn days_from_civil(date: CivilDate) -> i64 {
    let year = if date.month <= 2 {
        date.year - 1
    } else {
        date.year
    };
    let era = year.div_euclid(YEARS_PER_ERA);
    let year_of_era = year - era * YEARS_PER_ERA;
    let shifted_month = i64::from((date.month + 9) % 12);
    let day_of_year = (153 * shifted_month + 2) / 5 + i64::from(date.day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * DAYS_PER_ERA + day_of_era - DAYS_FROM_CIVIL_ZERO_TO_UNIX_EPOCH
}

fn civil_from_days(days: i64) -> CivilDate {
    let shifted = days + DAYS_FROM_CIVIL_ZERO_TO_UNIX_EPOCH;
    let era = shifted.div_euclid(DAYS_PER_ERA);
    let day_of_era = shifted - era * DAYS_PER_ERA;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * shifted_month + 2) / 5 + 1) as u32;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    } as u32;
    let year = year_of_era + era * YEARS_PER_ERA + i64::from(month <= 2);
    CivilDate { year, month, day }
}

fn minute_of_day(text: &str) -> Option<i64> {
    if text.len() != LOCAL_MINUTE_LENGTH
        || !text.is_ascii()
        || !has_separators(text, &[(10, b'T'), (13, b':')])
    {
        return None;
    }
    let hour = digits(&text[11..13])?;
    let minute = digits(&text[14..16])?;
    (hour < 24 && minute < 60).then(|| i64::from(hour) * MINUTES_PER_HOUR + i64::from(minute))
}

fn epoch_minutes(local_minute: &str) -> Option<i64> {
    let date = parse_date(local_minute.get(..LOCAL_DATE_LENGTH)?)?;
    Some(days_from_civil(date) * MINUTES_PER_DAY + minute_of_day(local_minute)?)
}

fn format_epoch_minutes(minutes: i64) -> Option<String> {
    let date = civil_from_days(minutes.div_euclid(MINUTES_PER_DAY));
    if !(0..=LAST_REPRESENTABLE_YEAR).contains(&date.year) {
        return None;
    }
    let within_day = minutes.rem_euclid(MINUTES_PER_DAY);
    Some(format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}",
        date.year,
        date.month,
        date.day,
        within_day / MINUTES_PER_HOUR,
        within_day % MINUTES_PER_HOUR
    ))
}

pub fn is_local_date(text: &str) -> bool {
    parse_date(text).is_some()
}

pub fn is_local_minute(text: &str) -> bool {
    epoch_minutes(text).is_some()
}

pub fn days_between(from: &str, to: &str) -> Option<i64> {
    let first = days_from_civil(parse_date(from)?);
    let last = days_from_civil(parse_date(to)?);
    Some(last - first)
}

pub fn has_valid_start(text: &str) -> bool {
    epoch_minutes(text)
        .is_some_and(|minutes| minutes.rem_euclid(MINUTES_PER_HOUR) % START_STEP_MIN == 0)
}

pub fn ends_at(starts_at: &str, duration_min: u32) -> Result<String, SlotError> {
    let start = epoch_minutes(starts_at).ok_or(SlotError::InvalidStart)?;
    let end = start + i64::from(duration_min);
    let next_midnight = (start.div_euclid(MINUTES_PER_DAY) + 1) * MINUTES_PER_DAY;
    if end > next_midnight {
        return Err(SlotError::CrossesMidnight);
    }
    format_epoch_minutes(end).ok_or(SlotError::CrossesMidnight)
}

pub fn blocks_slot(status: AppointmentStatus) -> bool {
    matches!(
        status,
        AppointmentStatus::Scheduled | AppointmentStatus::InProgress | AppointmentStatus::Completed
    )
}

pub fn status_after(transition: AppointmentTransition) -> AppointmentStatus {
    match transition {
        AppointmentTransition::Start => AppointmentStatus::InProgress,
        AppointmentTransition::Complete => AppointmentStatus::Completed,
        AppointmentTransition::MarkNoShow => AppointmentStatus::NoShow,
        AppointmentTransition::Cancel => AppointmentStatus::Cancelled,
        AppointmentTransition::Reopen => AppointmentStatus::Scheduled,
    }
}

fn is_final(status: AppointmentStatus) -> bool {
    matches!(
        status,
        AppointmentStatus::Completed | AppointmentStatus::Cancelled | AppointmentStatus::NoShow
    )
}

pub fn can_transition(
    status: AppointmentStatus,
    transition: AppointmentTransition,
    starts_at: &str,
    now: &str,
) -> bool {
    use AppointmentStatus::{InProgress, Scheduled};
    use AppointmentTransition::{Cancel, Complete, MarkNoShow, Reopen, Start};
    match transition {
        Start | MarkNoShow => status == Scheduled,
        Cancel => matches!(status, Scheduled | InProgress),
        Complete => status == InProgress || (status == Scheduled && now >= starts_at),
        Reopen => is_final(status),
    }
}

#[cfg(test)]
#[path = "rules_test.rs"]
mod tests;
