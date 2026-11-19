use super::*;

#[test]
fn ascii_space_and_letters_are_allowed() {
    for character in [
        'a', 'Z', '0', ' ', '.', '_', '\u{00F3}', '\u{00D1}', '\u{4E2D}',
    ] {
        assert!(is_allowed_username_character(character), "{character:?}");
    }
}

#[test]
fn control_format_and_separator_characters_are_not_allowed() {
    for character in [
        '\u{0000}',
        '\u{0009}',
        '\u{007F}',
        '\u{0085}',
        '\u{00A0}',
        '\u{00AD}',
        '\u{061C}',
        '\u{1680}',
        '\u{180E}',
        '\u{2003}',
        '\u{200B}',
        '\u{200D}',
        '\u{2028}',
        '\u{2029}',
        '\u{202E}',
        '\u{202F}',
        '\u{205F}',
        '\u{2066}',
        '\u{3000}',
        '\u{FEFF}',
        '\u{E0041}',
    ] {
        assert!(!is_allowed_username_character(character), "{character:?}");
    }
}

#[test]
fn casefold_unifies_case_and_normalization_forms() {
    assert_eq!(unicode_casefold("\u{00D3}SCAR"), "\u{00F3}scar");
    assert_eq!(unicode_casefold("o\u{0301}scar"), "\u{00F3}scar");
    assert_eq!(
        unicode_casefold("O\u{0301}SCAR"),
        unicode_casefold("\u{00F3}scar")
    );
}
