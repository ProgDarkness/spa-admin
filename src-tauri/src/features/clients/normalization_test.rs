use super::*;

#[test]
fn national_id_is_canonicalized_from_every_common_spelling() {
    for raw in [
        "V-12345678",
        "v12345678",
        "V 12.345.678",
        "  v-12.345.678  ",
        "V12.345.678",
        "v 12345678",
    ] {
        assert_eq!(
            normalize_national_id(raw).as_deref(),
            Some("V-12345678"),
            "{raw:?}"
        );
    }
}

#[test]
fn national_id_keeps_each_valid_prefix() {
    assert_eq!(normalize_national_id("e81234567").unwrap(), "E-81234567");
    assert_eq!(normalize_national_id("j-123456789").unwrap(), "J-123456789");
}

#[test]
fn national_id_accepts_the_digit_bounds_and_rejects_beyond_them() {
    assert!(normalize_national_id("V-123456").is_some());
    assert!(normalize_national_id("V-123456789").is_some());
    assert!(normalize_national_id("V-12345").is_none());
    assert!(normalize_national_id("V-1234567890").is_none());
}

#[test]
fn national_id_rejects_malformed_input() {
    for raw in [
        "",
        "   ",
        "V",
        "V-",
        "12345678",
        "G-12345678",
        "VE-12345678",
        "V-1234567a",
        "V-１２３４５６７８",
        "V-12345678\u{0}",
        "V/12345678",
        "V-+12345678",
        "V--12-34-56-78",
        "V--12345678",
        "V  12345678",
        "V.12345678",
        "v 12 345 678",
        "V-12-345-678",
        "V-12..345.678",
        "V-12.345.67",
        "V-1234.5678",
        "V-.12.345.678",
        "V-12.345.678.",
        "V-1.2345.678",
    ] {
        assert_eq!(normalize_national_id(raw), None, "{raw:?}");
    }
}

#[test]
fn national_id_accepts_only_thousands_grouped_dots_and_one_prefix_separator() {
    for raw in [
        "V-12.345.678",
        "V 12.345.678",
        "V12.345.678",
        "e-1.234.567",
        "J-123.456.789",
        "V-123.456",
    ] {
        assert!(normalize_national_id(raw).is_some(), "{raw:?}");
    }
}

#[test]
fn national_id_normalization_is_idempotent() {
    let once = normalize_national_id("v 12.345.678").unwrap();

    assert_eq!(normalize_national_id(&once).unwrap(), once);
}

#[test]
fn phone_is_kept_exactly_as_written_after_trimming() {
    assert_eq!(
        valid_phone("  0414-123 4567 ").as_deref(),
        Some("0414-123 4567")
    );
    assert_eq!(valid_phone("+58 414 1234567").unwrap(), "+58 414 1234567");
}

#[test]
fn phone_collapses_inner_whitespace_runs_into_one_space() {
    assert_eq!(
        valid_phone("0414   123    4567").as_deref(),
        Some("0414 123 4567")
    );
    assert_eq!(
        valid_phone("+58\u{a0}414  1234567").as_deref(),
        Some("+58 414 1234567")
    );
}

#[test]
fn phone_rejects_line_breaks_and_control_characters() {
    for raw in [
        "0414\n1234567",
        "0414\r\n1234567",
        "0414\t1234567",
        "0414\u{7f}1234567",
        "\u{1b}04141234567",
    ] {
        assert_eq!(valid_phone(raw), None, "{raw:?}");
    }
}

#[test]
fn phone_is_capped_at_thirty_two_characters_after_collapsing() {
    let thirty_two = format!("1234567{}", "-".repeat(25));
    assert_eq!(thirty_two.chars().count(), 32);
    assert!(valid_phone(&thirty_two).is_some());
    let thirty_three = format!("{thirty_two}-");
    assert_eq!(valid_phone(&thirty_three), None);
    let padded = format!("{}1234567", "-".repeat(26));
    assert_eq!(padded.chars().count(), 33);
    assert_eq!(valid_phone(&padded), None);
    assert!(valid_phone(&format!("1234567{}", " ".repeat(40))).is_some());
}

#[test]
fn phone_requires_between_seven_and_fifteen_digits() {
    assert!(valid_phone("1234567").is_some());
    assert!(valid_phone("123456789012345").is_some());
    assert_eq!(valid_phone("123456"), None);
    assert_eq!(valid_phone("1234567890123456"), None);
}

#[test]
fn phone_rejects_letters_symbols_misplaced_plus_and_non_ascii_digits() {
    for raw in [
        "",
        "   ",
        "0414-abc4567",
        "(0414) 1234567",
        "0414+1234567",
        "++584141234567",
        "０４１４１２３４５６７",
        "0414\u{0}1234567",
    ] {
        assert_eq!(valid_phone(raw), None, "{raw:?}");
    }
}

#[test]
fn digits_of_a_phone_drop_every_separator() {
    assert_eq!(phone_digits("+58 (414)-123 4567"), "584141234567");
}

#[test]
fn folding_drops_accents_and_case() {
    assert_eq!(fold_text("María GONZÁLEZ"), "maria gonzalez");
    assert_eq!(fold_text("Ñandú Sofía"), "nandu sofia");
    assert_eq!(fold_text("Hernández"), fold_text("HERNANDEZ"));
}

#[test]
fn folding_handles_decomposed_input_the_same_as_composed() {
    assert_eq!(fold_text("Jose\u{301}"), fold_text("José"));
}

#[test]
fn search_key_concatenates_the_four_fields_and_the_phone_digits() {
    let key = search_key("María", "González", "V-12345678", "0414-123 4567");

    assert_eq!(
        key,
        "maria gonzalez v-12345678 v12345678 0414-123 4567 04141234567"
    );
}

#[test]
fn search_key_is_unaffected_by_accents_in_any_field() {
    assert_eq!(
        search_key("Sofía", "Ramírez", "V-24567890", "0412-8901234"),
        search_key("Sofia", "Ramirez", "V-24567890", "0412-8901234")
    );
}

#[test]
fn like_pattern_wraps_the_folded_query_and_escapes_wildcards() {
    assert_eq!(like_pattern("María"), "%maria%");
    assert_eq!(like_pattern("50%_off\\"), "%50\\%\\_off\\\\%");
}

#[test]
fn like_pattern_trims_the_query() {
    assert_eq!(like_pattern("  ana  "), "%ana%");
}

#[test]
fn like_pattern_compacts_id_and_phone_shaped_queries() {
    for raw in ["V12345678", "V 12345678", "v-12345678", "V-12.345.678"] {
        assert_eq!(like_pattern(raw), "%v12345678%", "{raw:?}");
    }
    assert_eq!(like_pattern("12.345.678"), "%12345678%");
    assert_eq!(like_pattern("0414 1234567"), "%04141234567%");
    assert_eq!(like_pattern("+58 414-123"), "%58414123%");
}

#[test]
fn like_pattern_keeps_spaces_in_text_queries() {
    assert_eq!(like_pattern("maria gonzalez"), "%maria gonzalez%");
    assert_eq!(like_pattern("-"), "%-%");
    assert_eq!(like_pattern("ana 2"), "%ana 2%");
}

#[test]
fn like_pattern_caps_the_query_at_one_hundred_characters() {
    let long = "a".repeat(150);
    assert_eq!(like_pattern(&long), format!("%{}%", "a".repeat(100)));
    let accented = "Á".repeat(101);
    assert_eq!(like_pattern(&accented), format!("%{}%", "a".repeat(100)));
}
