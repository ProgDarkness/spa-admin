use std::collections::HashMap;

use super::*;

const SAMPLE_CODES: usize = 2000;
const EXPECTED_PER_SYMBOL: usize = SAMPLE_CODES * RECOVERY_CODE_CHARS / 32;
const TOLERANCE: usize = EXPECTED_PER_SYMBOL / 5;
const CANONICAL_SAMPLE: &str = "ABCDEFGHIJKLMNOPQRST";

fn generated() -> RecoveryCode {
    RecoveryCode::generate().unwrap()
}

#[test]
fn code_has_20_symbols_from_rfc4648_alphabet() {
    let code = generated();

    assert_eq!(code.canonical().len(), 20);
    assert!(code
        .canonical()
        .bytes()
        .all(|b| RECOVERY_ALPHABET.contains(&b)));
    assert_eq!(RECOVERY_ALPHABET.len(), 32);
}

#[test]
fn code_distribution_uses_full_alphabet() {
    let mut counts: HashMap<u8, usize> = HashMap::new();
    for _ in 0..SAMPLE_CODES {
        for symbol in generated().canonical().bytes() {
            *counts.entry(symbol).or_default() += 1;
        }
    }

    assert_eq!(counts.len(), 32);
    for (symbol, count) in counts {
        assert!(
            count.abs_diff(EXPECTED_PER_SYMBOL) <= TOLERANCE,
            "symbol {} appeared {count} times",
            symbol as char
        );
    }
}

#[test]
fn generated_codes_differ() {
    assert_ne!(generated().canonical(), generated().canonical());
}

#[test]
fn formatted_groups_five_blocks_of_four() {
    let code = RecoveryCode::parse(CANONICAL_SAMPLE).unwrap();

    assert_eq!(code.formatted().as_str(), "ABCD-EFGH-IJKL-MNOP-QRST");
}

#[test]
fn formatted_code_parses_back_to_the_same_canonical() {
    let code = generated();

    let reparsed = RecoveryCode::parse(&code.formatted()).unwrap();

    assert_eq!(reparsed.canonical(), code.canonical());
}

#[test]
fn recovery_code_debug_redacted() {
    let code = RecoveryCode::parse(CANONICAL_SAMPLE).unwrap();

    let rendered = format!("{code:?}");

    assert_eq!(rendered, "RecoveryCode(***)");
    assert!(!rendered.contains("ABCD"));
}

#[test]
fn recovery_code_parse_normalizes_case_and_dashes() {
    for candidate in [
        "abcd-efgh-ijkl-mnop-qrst",
        "ABCD EFGH IJKL MNOP QRST",
        "  abcdefghijklmnopqrst  ",
        "aBcD-eFgH ijkl-MNOP qrst",
    ] {
        let code = RecoveryCode::parse(candidate).unwrap();
        assert_eq!(code.canonical(), CANONICAL_SAMPLE, "{candidate}");
    }
}

#[test]
fn recovery_code_parse_rejects_bad_chars_and_length() {
    for candidate in [
        "",
        "ABCD-EFGH-IJKL-MNOP-QRS",
        "ABCD-EFGH-IJKL-MNOP-QRSTA",
        "ABCD-EFGH-IJKL-MNOP-QRS0",
        "ABCD-EFGH-IJKL-MNOP-QRS1",
        "ABCD-EFGH-IJKL-MNOP-QRS8",
        "ABCD-EFGH-IJKL-MNOP-QRS9",
        "ABCD-EFGH-IJKL-MNOP-QRS=",
        "ABCD-EFGH-IJKL-MNOP-QRÁT",
        "ABCD\tEFGH\nIJKLMNOPQRST",
        "--------------------",
    ] {
        assert!(RecoveryCode::parse(candidate).is_none(), "{candidate:?}");
    }
}
