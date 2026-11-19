use std::sync::Arc;
use std::time::{Duration, Instant};

use super::*;

fn fail_times(throttle: &LoginThrottle, key: &str, times: u32, now: Instant) {
    for _ in 0..times {
        throttle.reserve_attempt(key, now);
    }
}

fn is_locked(throttle: &LoginThrottle, key: &str, now: Instant) -> bool {
    !throttle.reserve_attempt(key, now).is_granted()
}

#[test]
fn stays_open_below_the_failure_limit() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "ana", MAX_FAILURES - 1, now);
    assert!(throttle.reserve_attempt("ana", now).is_granted());
}

#[test]
fn locks_at_the_failure_limit_until_the_lockout_expires() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "ana", MAX_FAILURES, now);
    assert!(is_locked(&throttle, "ana", now));
    assert!(is_locked(
        &throttle,
        "ana",
        now + LOCKOUT - Duration::from_secs(1)
    ));
    assert!(!is_locked(&throttle, "ana", now + LOCKOUT));
}

#[test]
fn expired_lockout_restarts_the_failure_count() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "ana", MAX_FAILURES, now);
    let later = now + LOCKOUT;
    fail_times(&throttle, "ana", MAX_FAILURES - 1, later);
    assert!(throttle.reserve_attempt("ana", later).is_granted());
}

#[test]
fn success_resets_the_counter() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "ana", MAX_FAILURES - 1, now);
    throttle.record_success("ana");
    fail_times(&throttle, "ana", MAX_FAILURES - 1, now);
    assert!(throttle.reserve_attempt("ana", now).is_granted());
}

#[test]
fn stale_failures_outside_the_window_do_not_accumulate() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "ana", MAX_FAILURES - 1, now);
    let later = now + LOCKOUT;
    throttle.reserve_attempt("ana", later);
    assert!(throttle.reserve_attempt("ana", later).is_granted());
}

#[test]
fn keys_are_independent_and_case_insensitive() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "Ana", MAX_FAILURES, now);
    assert!(is_locked(&throttle, "ANA", now));
    assert!(throttle.reserve_attempt("beto", now).is_granted());
}

#[test]
fn tracked_keys_are_bounded() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    for index in 0..(MAX_TRACKED + 10) {
        throttle.reserve_attempt(&format!("user-{index}"), now);
    }
    assert!(throttle.entries.lock().unwrap().len() <= MAX_TRACKED);
}

#[test]
fn recovers_from_a_poisoned_lock() {
    let throttle = Arc::new(LoginThrottle::default());
    let poisoner = Arc::clone(&throttle);
    let _ = std::thread::spawn(move || {
        let _guard = poisoner.entries.lock().unwrap();
        panic!("poison");
    })
    .join();
    let now = Instant::now();
    fail_times(&throttle, "ana", MAX_FAILURES, now);
    assert!(is_locked(&throttle, "ana", now));
}

#[test]
fn garbage_usernames_do_not_evict_a_victim_with_accumulated_failures() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "victima", MAX_FAILURES - 1, now);
    for index in 0..(MAX_TRACKED * 2) {
        throttle.reserve_attempt(&format!("basura-{index}"), now);
    }
    assert!(throttle.reserve_attempt("victima", now).is_granted());
    assert!(is_locked(&throttle, "victima", now));
}

#[test]
fn eviction_prefers_fewer_failures_even_when_the_stronger_entry_is_older() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "victima", MAX_FAILURES - 1, now);
    for index in 0..(MAX_TRACKED * 2) {
        throttle.reserve_attempt(&format!("basura-{index}"), now + Duration::from_secs(1));
    }
    assert!(throttle.entries.lock().unwrap().contains_key("victima"));
    assert!(throttle.reserve_attempt("victima", now).is_granted());
    assert!(is_locked(&throttle, "victima", now));
}

#[test]
fn garbage_usernames_do_not_evict_a_locked_entry() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "victima", MAX_FAILURES, now);
    for index in 0..(MAX_TRACKED * 2) {
        throttle.reserve_attempt(&format!("basura-{index}"), now);
    }
    assert!(is_locked(&throttle, "victima", now));
}

fn fill_with_unlocked_failures(throttle: &LoginThrottle, failures: u32, now: Instant) {
    for index in 0..MAX_TRACKED {
        fail_times(throttle, &format!("fuerte-{index}"), failures, now);
    }
}

#[test]
fn a_new_legitimate_key_is_granted_when_every_tracked_entry_has_failures() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fill_with_unlocked_failures(&throttle, 2, now);
    assert!(throttle.reserve_attempt("nuevo", now).is_granted());
    assert_eq!(throttle.entries.lock().unwrap().len(), MAX_TRACKED);
    assert!(throttle.entries.lock().unwrap().contains_key("nuevo"));
}

#[test]
fn eviction_removes_the_unlocked_entry_with_the_oldest_last_failure() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "antigua", 2, now);
    for index in 1..MAX_TRACKED {
        fail_times(
            &throttle,
            &format!("fuerte-{index}"),
            2,
            now + Duration::from_secs(1),
        );
    }
    throttle.reserve_attempt("nuevo", now + Duration::from_secs(2));
    let entries = throttle.entries.lock().unwrap();
    assert!(!entries.contains_key("antigua"));
    assert!(entries.contains_key("fuerte-1"));
    assert!(entries.contains_key("nuevo"));
}

#[test]
fn eviction_never_removes_a_locked_entry() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "victima", MAX_FAILURES, now);
    for index in 1..MAX_TRACKED {
        fail_times(&throttle, &format!("fuerte-{index}"), 2, now);
    }
    for index in 0..MAX_TRACKED {
        assert!(throttle
            .reserve_attempt(&format!("nuevo-{index}"), now)
            .is_granted());
    }
    assert!(is_locked(&throttle, "victima", now));
}

#[test]
fn concurrent_attempts_never_exceed_the_failure_limit() {
    let throttle = Arc::new(LoginThrottle::default());
    let now = Instant::now();
    let allowed: u32 = (0..32)
        .map(|_| {
            let shared = Arc::clone(&throttle);
            std::thread::spawn(move || u32::from(shared.reserve_attempt("ana", now).is_granted()))
        })
        .collect::<Vec<_>>()
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .sum();
    assert_eq!(allowed, MAX_FAILURES);
}

#[test]
fn releasing_a_reservation_restores_the_attempt() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "ana", MAX_FAILURES, now);
    throttle.release_attempt("ana");
    assert!(throttle.reserve_attempt("ana", now).is_granted());
    assert!(is_locked(&throttle, "ana", now));
}

#[test]
fn releasing_an_unknown_key_is_a_no_op() {
    let throttle = LoginThrottle::default();
    throttle.release_attempt("nadie");
    assert!(throttle.entries.lock().unwrap().is_empty());
}

#[test]
fn reservations_are_granted_until_the_limit_and_then_denied() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    let outcomes: Vec<Reservation> = (0..MAX_FAILURES)
        .map(|_| throttle.reserve_attempt("ana", now))
        .collect();
    assert!(outcomes
        .iter()
        .all(|outcome| *outcome == Reservation::Granted));
    assert_eq!(throttle.reserve_attempt("ana", now), Reservation::Denied);
    assert!(!Reservation::Denied.is_granted());
}

fn failures_recorded(throttle: &LoginThrottle, key: &str) -> Option<u32> {
    throttle
        .entries
        .lock()
        .unwrap()
        .get(key)
        .map(|entry| entry.failures)
}

#[test]
fn settling_a_success_clears_the_key() {
    let throttle = LoginThrottle::default();
    throttle.reserve_attempt("ana", Instant::now());

    let settled = throttle.settle("ana", Ok::<_, AttemptFailure>(7));

    assert_eq!(settled.unwrap(), 7);
    assert_eq!(failures_recorded(&throttle, "ana"), None);
}

#[test]
fn settling_a_spent_failure_keeps_the_reservation() {
    let throttle = LoginThrottle::default();
    throttle.reserve_attempt("ana", Instant::now());

    let settled = throttle.settle::<()>("ana", Err(AttemptFailure::spent(AuthError::Hash)));

    assert!(matches!(settled, Err(AuthError::Hash)));
    assert_eq!(failures_recorded(&throttle, "ana"), Some(1));
}

#[test]
fn settling_an_infrastructure_failure_releases_the_reservation() {
    let throttle = LoginThrottle::default();
    throttle.reserve_attempt("ana", Instant::now());

    let settled = throttle.settle::<()>("ana", Err(AttemptFailure::from(AuthError::Hash)));

    assert!(matches!(settled, Err(AuthError::Hash)));
    assert_eq!(failures_recorded(&throttle, "ana"), None);
}

#[test]
fn invalid_credentials_convert_to_a_spent_failure() {
    assert!(AttemptFailure::from(AuthError::InvalidCredentials).attempt_spent);
    assert!(!AttemptFailure::from(AuthError::Hash).attempt_spent);
}

#[test]
fn spent_only_if_can_downgrade_but_never_upgrade() {
    let spent = AttemptFailure::spent(AuthError::Hash);
    assert!(!spent.spent_only_if(false).attempt_spent);
    let refunded = AttemptFailure::from(AuthError::Hash);
    assert!(!refunded.spent_only_if(true).attempt_spent);
}

#[test]
fn a_new_key_evicts_the_locked_entry_that_expires_soonest_when_all_are_locked() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "proxima", MAX_FAILURES, now);
    for index in 1..MAX_TRACKED {
        fail_times(
            &throttle,
            &format!("tardia-{index}"),
            MAX_FAILURES,
            now + Duration::from_secs(1),
        );
    }
    let later = now + Duration::from_secs(2);
    assert!(throttle.reserve_attempt("nuevo", later).is_granted());
    let entries = throttle.entries.lock().unwrap();
    assert_eq!(entries.len(), MAX_TRACKED);
    assert!(!entries.contains_key("proxima"));
    assert!(entries.contains_key("tardia-1"));
    assert!(entries.contains_key("nuevo"));
}
