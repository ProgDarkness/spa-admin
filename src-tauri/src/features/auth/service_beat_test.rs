use std::time::Duration;

use super::tests::{later, origin, session_user};
use super::*;
use crate::features::auth::heartbeat::MAX_HEARTBEAT_GAP;

fn started_session() -> (SessionState, Beat) {
    let state = SessionState::default();
    let start = origin();
    state.start(session_user(), start).unwrap();
    (state, start)
}

#[test]
fn observing_an_earlier_beat_keeps_the_latest_beat_seen() {
    let (state, start) = started_session();
    let newest = later(start, Duration::from_secs(100));
    state.observe(newest).unwrap();

    let observation = state.observe(start).unwrap().unwrap();

    assert_eq!(observation.locked_now, None);
    assert_eq!(observation.view.status, SessionStatus::Active);
    assert_eq!(state.last_beat().unwrap(), Some(newest));
}

#[test]
fn a_beat_with_the_same_mono_and_a_later_wall_is_not_adopted_nor_resumed() {
    let (state, start) = started_session();
    let same_mono_later_wall = Beat {
        mono: start.mono,
        wall: start.wall + Duration::from_secs(5),
    };

    for _ in 0..2 {
        let observation = state.observe(same_mono_later_wall).unwrap().unwrap();
        assert_eq!(observation.locked_now, None);
        assert_eq!(observation.view.status, SessionStatus::Active);
    }

    assert_eq!(state.last_beat().unwrap(), Some(start));
}

#[test]
fn an_earlier_beat_does_not_stretch_the_gap_measured_by_the_next_beat() {
    let (state, start) = started_session();
    state
        .observe(later(start, Duration::from_secs(100)))
        .unwrap();
    state.observe(start).unwrap();
    let gap_from_start = MAX_HEARTBEAT_GAP + Duration::from_secs(10);

    let observation = state
        .observe(later(start, gap_from_start))
        .unwrap()
        .unwrap();

    assert_eq!(observation.locked_now, None);
    assert_eq!(observation.view.status, SessionStatus::Active);
}

#[test]
fn a_later_beat_still_advances_the_latest_beat_seen() {
    let (state, start) = started_session();
    let next = later(start, Duration::from_secs(15));

    state.observe(next).unwrap();

    assert_eq!(state.last_beat().unwrap(), Some(next));
}
