use super::*;
use AppointmentStatus::{Cancelled, Completed, InProgress, NoShow, Scheduled};
use AppointmentTransition::{Cancel, Complete, MarkNoShow, Reopen, Start};

const ALL_STATUSES: [AppointmentStatus; 5] = [Scheduled, InProgress, Completed, Cancelled, NoShow];
const START: &str = "2026-11-12T10:00";

#[test]
fn an_hour_that_ends_before_midnight_is_accepted() {
    assert_eq!(
        ends_at("2026-11-12T23:00", 60),
        Ok("2026-11-13T00:00".to_string())
    );
}

#[test]
fn an_appointment_ending_after_midnight_is_rejected() {
    assert_eq!(
        ends_at("2026-11-12T23:30", 60),
        Err(SlotError::CrossesMidnight)
    );
    assert_eq!(
        ends_at("2026-11-12T23:55", 10),
        Err(SlotError::CrossesMidnight)
    );
}

#[test]
fn a_full_day_from_midnight_is_accepted_and_one_minute_more_is_not() {
    assert_eq!(
        ends_at("2026-11-12T00:00", 1440),
        Ok("2026-11-13T00:00".to_string())
    );
    assert_eq!(
        ends_at("2026-11-12T00:05", 1440),
        Err(SlotError::CrossesMidnight)
    );
}

#[test]
fn the_end_rolls_over_month_year_and_leap_day_boundaries() {
    assert_eq!(
        ends_at("2026-12-31T23:00", 60),
        Ok("2027-01-01T00:00".to_string())
    );
    assert_eq!(
        ends_at("2028-02-28T23:00", 60),
        Ok("2028-02-29T00:00".to_string())
    );
    assert_eq!(
        ends_at("2028-02-29T23:00", 60),
        Ok("2028-03-01T00:00".to_string())
    );
    assert_eq!(
        ends_at("2026-02-28T23:00", 60),
        Ok("2026-03-01T00:00".to_string())
    );
    assert_eq!(
        ends_at("2026-11-30T23:00", 60),
        Ok("2026-12-01T00:00".to_string())
    );
}

#[test]
fn the_end_within_the_same_day_keeps_the_date() {
    assert_eq!(ends_at(START, 45), Ok("2026-11-12T10:45".to_string()));
    assert_eq!(ends_at(START, 90), Ok("2026-11-12T11:30".to_string()));
}

#[test]
fn malformed_or_nonexistent_starts_are_invalid() {
    for bad in [
        "",
        "2026-11-12",
        "2026-11-12 10:00",
        "2026-11-12T10:00:00",
        "2026-11-12T24:00",
        "2026-11-12T10:60",
        "2026-02-30T10:00",
        "2027-02-29T10:00",
        "2026-13-01T10:00",
        "2026-00-10T10:00",
        "2026-11-00T10:00",
        "2026-11-31T10:00",
        "26-11-12T10:00",
        "2026-11-12T1a:00",
        "２０２６-11-12T10:00",
    ] {
        assert_eq!(ends_at(bad, 60), Err(SlotError::InvalidStart), "{bad:?}");
    }
}

#[test]
fn a_leap_day_start_is_valid_only_in_leap_years() {
    assert!(ends_at("2028-02-29T10:00", 30).is_ok());
    assert!(ends_at("2100-02-29T10:00", 30).is_err());
    assert!(ends_at("2000-02-29T10:00", 30).is_ok());
}

#[test]
fn starts_must_land_on_five_minute_blocks() {
    assert!(has_valid_start("2026-11-12T10:00"));
    assert!(has_valid_start("2026-11-12T10:55"));
    assert!(!has_valid_start("2026-11-12T10:03"));
    assert!(!has_valid_start("2026-11-12T10:61"));
    assert!(!has_valid_start("nope"));
}

#[test]
fn local_minutes_and_dates_are_validated_independently() {
    assert!(is_local_minute("2026-11-12T10:03"));
    assert!(!is_local_minute("2026-11-12T10:63"));
    assert!(is_local_date("2026-11-12"));
    assert!(is_local_date("2028-02-29"));
    assert!(!is_local_date("2026-02-29"));
    assert!(!is_local_date("2026-11-12T10:00"));
    assert!(!is_local_date(""));
}

#[test]
fn only_scheduled_in_progress_and_completed_block_a_slot() {
    let blocking: Vec<_> = ALL_STATUSES
        .into_iter()
        .filter(|status| blocks_slot(*status))
        .collect();

    assert_eq!(blocking, vec![Scheduled, InProgress, Completed]);
}

#[test]
fn every_transition_leads_to_its_target_status() {
    assert_eq!(status_after(Start), InProgress);
    assert_eq!(status_after(Complete), Completed);
    assert_eq!(status_after(MarkNoShow), NoShow);
    assert_eq!(status_after(Cancel), Cancelled);
    assert_eq!(status_after(Reopen), Scheduled);
}

fn allowed_from(transition: AppointmentTransition, now: &str) -> Vec<AppointmentStatus> {
    ALL_STATUSES
        .into_iter()
        .filter(|status| can_transition(*status, transition, START, now))
        .collect()
}

#[test]
fn the_full_transition_table_matches_the_state_machine() {
    let late = "2026-11-12T12:00";

    assert_eq!(allowed_from(Start, late), vec![Scheduled]);
    assert_eq!(allowed_from(Complete, late), vec![Scheduled, InProgress]);
    assert_eq!(allowed_from(MarkNoShow, late), vec![Scheduled]);
    assert_eq!(allowed_from(Cancel, late), vec![Scheduled, InProgress]);
    assert_eq!(
        allowed_from(Reopen, late),
        vec![Completed, Cancelled, NoShow]
    );
}

#[test]
fn completing_a_scheduled_appointment_needs_its_start_to_have_arrived() {
    assert!(can_transition(Scheduled, Complete, START, START));
    assert!(can_transition(
        Scheduled,
        Complete,
        START,
        "2026-11-12T10:01"
    ));
    assert!(!can_transition(
        Scheduled,
        Complete,
        START,
        "2026-11-12T09:59"
    ));
    assert!(!can_transition(
        Scheduled,
        Complete,
        START,
        "2026-11-11T23:59"
    ));
}

#[test]
fn completing_an_appointment_in_progress_ignores_the_clock() {
    assert!(can_transition(
        InProgress,
        Complete,
        START,
        "2026-11-12T09:00"
    ));
}

#[test]
fn the_clock_never_gates_the_other_transitions() {
    let early = "2026-11-01T00:00";

    for transition in [Start, MarkNoShow, Cancel] {
        assert!(can_transition(Scheduled, transition, START, early));
    }
    assert!(can_transition(Cancelled, Reopen, START, early));
}

#[test]
fn transitions_never_apply_to_unrelated_final_states() {
    for transition in [Start, Complete, MarkNoShow, Cancel] {
        for status in [Completed, Cancelled, NoShow] {
            assert!(!can_transition(
                status,
                transition,
                START,
                "2030-01-01T00:00"
            ));
        }
    }
    assert!(!can_transition(Scheduled, Reopen, START, START));
    assert!(!can_transition(InProgress, Reopen, START, START));
}

#[test]
fn the_span_between_two_dates_counts_days_across_months_and_years() {
    assert_eq!(days_between("2026-11-12", "2026-11-12"), Some(0));
    assert_eq!(days_between("2026-11-12", "2026-11-13"), Some(1));
    assert_eq!(days_between("2026-12-31", "2027-01-01"), Some(1));
    assert_eq!(days_between("2028-02-28", "2028-03-01"), Some(2));
    assert_eq!(days_between("2026-11-13", "2026-11-12"), Some(-1));
    assert_eq!(days_between("2026-02-30", "2026-03-01"), None);
}

#[test]
fn an_end_beyond_the_last_representable_year_counts_as_crossing_midnight() {
    assert_eq!(
        ends_at("9999-12-31T23:00", 60),
        Err(SlotError::CrossesMidnight)
    );
}
