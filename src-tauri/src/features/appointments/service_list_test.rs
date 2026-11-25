use super::*;
use crate::features::appointments::fixture_test::{create, facial, fixture, Fixture, CABIN_ONE};

fn range(from: &str, to: &str, resource_id: Option<i64>) -> AppointmentRange {
    AppointmentRange {
        from: from.to_string(),
        to: to.to_string(),
        resource_id,
    }
}

fn listed(
    fixture: &Fixture,
    request: &AppointmentRange,
) -> Result<Vec<AppointmentSummary>, AppointmentError> {
    fixture
        .database
        .with_conn_mapped(|conn| list_appointments(conn, request))
}

fn field_of(result: Result<Vec<AppointmentSummary>, AppointmentError>) -> &'static str {
    match result.unwrap_err() {
        AppointmentError::Validation { field } => field,
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn a_valid_range_lists_the_matching_appointments() {
    let fixture = fixture();
    let inside = create(&fixture, &facial(CABIN_ONE, "2026-11-12T10:00"));
    create(&fixture, &facial(CABIN_ONE, "2026-11-20T10:00"));

    let rows = listed(&fixture, &range("2026-11-12", "2026-11-12", None)).unwrap();

    assert_eq!(rows, vec![inside]);
}

#[test]
fn malformed_dates_are_rejected_on_their_own_field() {
    let fixture = fixture();

    for bad in [
        "",
        "2026-11",
        "2026-02-30",
        "2026-11-12T10:00",
        "12/11/2026",
    ] {
        assert_eq!(
            field_of(listed(&fixture, &range(bad, "2026-11-12", None))),
            "from",
            "{bad:?}"
        );
        assert_eq!(
            field_of(listed(&fixture, &range("2026-11-12", bad, None))),
            "to",
            "{bad:?}"
        );
    }
}

#[test]
fn an_inverted_range_is_rejected_on_the_end_field() {
    let fixture = fixture();

    let result = listed(&fixture, &range("2026-11-13", "2026-11-12", None));

    assert_eq!(field_of(result), "to");
}

#[test]
fn a_single_day_range_is_not_inverted() {
    let fixture = fixture();

    assert!(listed(&fixture, &range("2026-11-12", "2026-11-12", None)).is_ok());
}

#[test]
fn a_non_positive_resource_filter_is_rejected() {
    let fixture = fixture();

    for resource_id in [0, -3] {
        let result = listed(
            &fixture,
            &range("2026-11-12", "2026-11-12", Some(resource_id)),
        );
        assert_eq!(field_of(result), "resourceId");
    }
}

#[test]
fn a_range_of_up_to_three_hundred_sixty_six_days_is_accepted() {
    let fixture = fixture();

    assert!(listed(&fixture, &range("2027-01-01", "2027-12-31", None)).is_ok());
    assert!(listed(&fixture, &range("2028-01-01", "2028-12-31", None)).is_ok());
    assert!(listed(&fixture, &range("2026-01-01", "2027-01-01", None)).is_ok());
}

#[test]
fn a_range_longer_than_three_hundred_sixty_six_days_is_rejected_on_the_end_field() {
    let fixture = fixture();

    assert_eq!(
        field_of(listed(&fixture, &range("2026-01-01", "2027-01-02", None))),
        "to"
    );
    assert_eq!(
        field_of(listed(&fixture, &range("2000-01-01", "2026-01-01", None))),
        "to"
    );
}
