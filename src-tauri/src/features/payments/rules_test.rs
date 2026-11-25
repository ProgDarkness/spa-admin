use serde::Deserialize;

use super::*;

const VECTORS: &str = include_str!("../../../../src/lib/usd-equivalent-vectors.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vector {
    amount_cents: i64,
    rate_e4: i64,
    expected: i64,
}

#[test]
fn matches_every_vector_shared_with_the_typescript_formula() {
    let vectors: Vec<Vector> = serde_json::from_str(VECTORS).unwrap();

    assert!(vectors.len() >= 10);
    for vector in vectors {
        assert_eq!(
            usd_equivalent_cents(vector.amount_cents, vector.rate_e4),
            Ok(vector.expected),
            "{}@{}",
            vector.amount_cents,
            vector.rate_e4
        );
    }
}

#[test]
fn the_cap_is_one_billion_units_in_cents() {
    assert_eq!(MAX_AMOUNT_CENTS, 100_000_000_000);
}

#[test]
fn the_largest_possible_equivalent_fits_a_javascript_safe_integer() {
    let largest = usd_equivalent_cents(MAX_AMOUNT_CENTS, 1).unwrap();

    assert_eq!(largest, 1_000_000_000_000_000);
    assert!(largest <= MAX_JS_SAFE_INTEGER);
    assert_eq!(
        usd_equivalent_cents(MAX_AMOUNT_CENTS + 1, 1),
        Err(EquivalentError::Amount)
    );
}

#[test]
fn every_shared_vector_equivalent_is_a_javascript_safe_integer() {
    let vectors: Vec<Vector> = serde_json::from_str(VECTORS).unwrap();

    assert!(vectors
        .iter()
        .all(|vector| (0..=MAX_JS_SAFE_INTEGER).contains(&vector.expected)));
    assert!(vectors
        .iter()
        .any(|vector| vector.amount_cents == MAX_AMOUNT_CENTS && vector.rate_e4 == 1));
}

#[test]
fn an_exact_conversion_is_not_altered() {
    assert_eq!(usd_equivalent_cents(146_000, 365_000), Ok(4_000));
}

#[test]
fn exactly_half_a_cent_rounds_up() {
    assert_eq!(usd_equivalent_cents(1, 20_000), Ok(1));
    assert_eq!(usd_equivalent_cents(3, 20_000), Ok(2));
}

#[test]
fn just_below_half_a_cent_rounds_down() {
    assert_eq!(usd_equivalent_cents(1, 20_001), Ok(0));
    assert_eq!(usd_equivalent_cents(1, 30_000), Ok(0));
}

#[test]
fn the_maximum_amount_with_the_minimum_rate_does_not_overflow() {
    assert_eq!(
        usd_equivalent_cents(MAX_AMOUNT_CENTS, 1),
        Ok(MAX_AMOUNT_CENTS * 10_000)
    );
}

#[test]
fn the_maximum_amount_with_the_maximum_rate_converts() {
    assert_eq!(
        usd_equivalent_cents(MAX_AMOUNT_CENTS, MAX_RATE_E4),
        Ok(10_000)
    );
}

#[test]
fn a_zero_negative_or_oversized_rate_is_rejected() {
    for rate in [0, -1, i64::MIN, MAX_RATE_E4 + 1, i64::MAX] {
        assert_eq!(
            usd_equivalent_cents(100, rate),
            Err(EquivalentError::Rate),
            "{rate}"
        );
    }
}

#[test]
fn a_negative_or_oversized_amount_is_rejected() {
    for amount in [-1, i64::MIN, MAX_AMOUNT_CENTS + 1, i64::MAX] {
        assert_eq!(
            usd_equivalent_cents(amount, 365_000),
            Err(EquivalentError::Amount),
            "{amount}"
        );
    }
}

#[test]
fn a_void_reason_is_trimmed_and_kept_with_its_inner_text() {
    assert_eq!(
        valid_void_reason("  Monto digitado por error \n"),
        Some("Monto digitado por error".to_string())
    );
}

#[test]
fn a_void_reason_must_be_between_one_and_two_hundred_characters_counting_emoji_once() {
    assert_eq!(valid_void_reason(""), None);
    assert_eq!(valid_void_reason("   \t "), None);
    assert!(valid_void_reason(&"a".repeat(200)).is_some());
    assert_eq!(valid_void_reason(&"a".repeat(201)), None);
    assert!(valid_void_reason(&"🙂".repeat(200)).is_some());
    assert_eq!(valid_void_reason(&"🙂".repeat(201)), None);
}

#[test]
fn a_void_reason_with_control_characters_is_rejected() {
    for reason in [
        "fallo\u{0000}",
        "dos\nlineas",
        "tab\tinterno",
        "\u{202e}rtl",
    ] {
        assert_eq!(valid_void_reason(reason), None, "{reason:?}");
    }
}
