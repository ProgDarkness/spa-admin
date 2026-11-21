use unicode_normalization::UnicodeNormalization;

const FORMAT_CHARACTER_RANGES: [(u32, u32); 21] = [
    (0x00AD, 0x00AD),
    (0x0600, 0x0605),
    (0x061C, 0x061C),
    (0x06DD, 0x06DD),
    (0x070F, 0x070F),
    (0x0890, 0x0891),
    (0x08E2, 0x08E2),
    (0x180E, 0x180E),
    (0x200B, 0x200F),
    (0x202A, 0x202E),
    (0x2060, 0x2064),
    (0x2066, 0x206F),
    (0xFEFF, 0xFEFF),
    (0xFFF9, 0xFFFB),
    (0x110BD, 0x110BD),
    (0x110CD, 0x110CD),
    (0x13430, 0x1343F),
    (0x1BCA0, 0x1BCA3),
    (0x1D173, 0x1D17A),
    (0xE0001, 0xE0001),
    (0xE0020, 0xE007F),
];

const SEPARATOR_RANGES: [(u32, u32); 7] = [
    (0x00A0, 0x00A0),
    (0x1680, 0x1680),
    (0x2000, 0x200A),
    (0x2028, 0x2029),
    (0x202F, 0x202F),
    (0x205F, 0x205F),
    (0x3000, 0x3000),
];

fn within(ranges: &[(u32, u32)], character: char) -> bool {
    let code_point = u32::from(character);
    ranges
        .iter()
        .any(|&(first, last)| (first..=last).contains(&code_point))
}

pub fn is_allowed_text_character(character: char) -> bool {
    !character.is_control()
        && !within(&FORMAT_CHARACTER_RANGES, character)
        && !within(&SEPARATOR_RANGES, character)
}

pub fn collapse_ascii_spaces(text: &str) -> String {
    let mut collapsed = String::with_capacity(text.len());
    let mut previous_was_space = false;
    for character in text.chars() {
        let is_space = character == ' ';
        if !(is_space && previous_was_space) {
            collapsed.push(character);
        }
        previous_was_space = is_space;
    }
    collapsed
}

pub fn unicode_casefold(text: &str) -> String {
    text.nfc()
        .collect::<String>()
        .to_lowercase()
        .nfc()
        .collect()
}

#[cfg(test)]
#[path = "username_test.rs"]
mod tests;
