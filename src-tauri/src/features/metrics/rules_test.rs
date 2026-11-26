use super::*;

fn bounds(month: &str) -> (String, String) {
    let found = month_bounds(month).unwrap();
    (found.start, found.end)
}

fn is_month_validation(error: MetricsError) -> bool {
    matches!(error, MetricsError::Validation { field: "month" })
}

#[test]
fn a_regular_month_spans_to_the_first_minute_of_the_next_one() {
    assert_eq!(
        bounds("2026-11"),
        (
            "2026-11-01T00:00".to_string(),
            "2026-12-01T00:00".to_string()
        )
    );
}

#[test]
fn december_rolls_over_to_january_of_the_next_year() {
    assert_eq!(
        bounds("2026-12"),
        (
            "2026-12-01T00:00".to_string(),
            "2027-01-01T00:00".to_string()
        )
    );
}

#[test]
fn the_first_and_last_supported_years_are_accepted() {
    assert_eq!(bounds("0001-01").0, "0001-01-01T00:00");
    assert_eq!(bounds("9998-12").1, "9999-01-01T00:00");
}

#[test]
fn malformed_or_out_of_range_months_are_rejected_on_the_month_field() {
    let rejected = [
        "2026-13",
        "2026-00",
        "0000-01",
        "9999-12",
        "10000-01",
        "26-11",
        "2026-1",
        "2026/11",
        "2026-11-01",
        "",
        " ",
        " 2026-11",
        "2026-11 ",
        "2026-11\n",
        "２０２６-11",
        "abcd-ef",
    ];
    for month in rejected {
        let error = month_bounds(month).unwrap_err();

        assert!(is_month_validation(error), "{month:?}");
    }
}
