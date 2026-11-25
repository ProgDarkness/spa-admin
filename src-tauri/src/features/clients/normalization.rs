use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

const NATIONAL_ID_PREFIXES: [char; 3] = ['V', 'E', 'J'];
const NATIONAL_ID_DIGITS: std::ops::RangeInclusive<usize> = 6..=9;
const PHONE_DIGITS: std::ops::RangeInclusive<usize> = 7..=15;
const PHONE_PLUS: char = '+';
const LIKE_ESCAPE: char = '\\';
const LIKE_WILDCARDS: [char; 2] = ['%', '_'];

const PHONE_MAX_CHARACTERS: usize = 32;
const QUERY_MAX_CHARACTERS: usize = 100;
const THOUSANDS_DOT: char = '.';
const THOUSANDS_GROUP_DIGITS: usize = 3;

fn is_ascii_digits(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())
}

fn has_thousands_grouping(digits: &str) -> bool {
    let mut groups = digits.split(THOUSANDS_DOT);
    let first_is_valid = groups
        .next()
        .is_some_and(|group| is_ascii_digits(group) && group.len() <= THOUSANDS_GROUP_DIGITS);
    first_is_valid
        && groups.all(|group| is_ascii_digits(group) && group.len() == THOUSANDS_GROUP_DIGITS)
}

fn plain_digits(body: &str) -> Option<String> {
    let well_formed = if body.contains(THOUSANDS_DOT) {
        has_thousands_grouping(body)
    } else {
        is_ascii_digits(body)
    };
    well_formed.then(|| body.replace(THOUSANDS_DOT, ""))
}

pub fn normalize_national_id(raw: &str) -> Option<String> {
    let mut characters = raw.trim().chars();
    let prefix = characters
        .next()
        .and_then(|candidate| candidate.to_uppercase().next())
        .filter(|candidate| NATIONAL_ID_PREFIXES.contains(candidate))?;
    let rest = characters.as_str();
    let body = rest
        .strip_prefix('-')
        .or_else(|| rest.strip_prefix(' '))
        .unwrap_or(rest);
    let digits = plain_digits(body)?;
    NATIONAL_ID_DIGITS
        .contains(&digits.len())
        .then(|| format!("{prefix}-{digits}"))
}

fn is_phone_character(candidate: char) -> bool {
    candidate.is_ascii_digit() || candidate == '-' || candidate == ' '
}

pub fn valid_phone(raw: &str) -> Option<String> {
    if raw.chars().any(char::is_control) {
        return None;
    }
    let phone = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let body = phone.strip_prefix(PHONE_PLUS).unwrap_or(&phone);
    let has_only_phone_characters = body.chars().all(is_phone_character);
    let digit_count = body.chars().filter(char::is_ascii_digit).count();
    let fits = phone.chars().count() <= PHONE_MAX_CHARACTERS;
    (fits && has_only_phone_characters && PHONE_DIGITS.contains(&digit_count)).then_some(phone)
}

pub fn phone_digits(phone: &str) -> String {
    phone.chars().filter(char::is_ascii_digit).collect()
}

pub fn fold_text(text: &str) -> String {
    text.nfd()
        .filter(|candidate| !is_combining_mark(*candidate))
        .collect::<String>()
        .to_lowercase()
}

pub fn search_key(first_name: &str, last_name: &str, national_id: &str, phone: &str) -> String {
    [
        fold_text(first_name),
        fold_text(last_name),
        fold_text(national_id),
        compact_identifier(national_id),
        fold_text(phone),
        phone_digits(phone),
    ]
    .join(" ")
}

fn compact_identifier(text: &str) -> String {
    fold_text(text)
        .chars()
        .filter(|candidate| !is_identifier_separator(*candidate))
        .collect()
}

fn is_identifier_separator(candidate: char) -> bool {
    candidate == ' ' || candidate == '.' || candidate == '-'
}

fn is_identifier_shaped(folded: &str) -> bool {
    let body = folded.strip_prefix(PHONE_PLUS).unwrap_or(folded);
    let digits_start = body
        .strip_prefix(|candidate: char| {
            NATIONAL_ID_PREFIXES
                .map(|p| p.to_ascii_lowercase())
                .contains(&candidate)
        })
        .unwrap_or(body);
    digits_start
        .chars()
        .all(|candidate| candidate.is_ascii_digit() || is_identifier_separator(candidate))
        && digits_start
            .chars()
            .any(|candidate| candidate.is_ascii_digit())
}

fn search_term(query: &str) -> String {
    let folded: String = fold_text(query.trim())
        .chars()
        .take(QUERY_MAX_CHARACTERS)
        .collect();
    if is_identifier_shaped(&folded) {
        folded
            .chars()
            .filter(|candidate| *candidate != PHONE_PLUS && !is_identifier_separator(*candidate))
            .collect()
    } else {
        folded
    }
}

pub fn like_pattern(query: &str) -> String {
    let escaped: String = search_term(query)
        .chars()
        .flat_map(|candidate| {
            let needs_escape = candidate == LIKE_ESCAPE || LIKE_WILDCARDS.contains(&candidate);
            needs_escape
                .then_some(LIKE_ESCAPE)
                .into_iter()
                .chain(std::iter::once(candidate))
        })
        .collect();
    format!("%{escaped}%")
}

#[cfg(test)]
#[path = "normalization_test.rs"]
mod tests;
