use std::sync::Arc;
use std::time::{Duration, Instant};

use super::*;

fn fail_times(throttle: &LoginThrottle, key: &str, times: u32, now: Instant) {
    for _ in 0..times {
        throttle.reserve_attempt(key, now);
    }
}

fn is_locked(throttle: &LoginThrottle, key: &str, now: Instant) -> bool {
    !throttle.reserve_attempt(key, now)
}

#[test]
fn stays_open_below_the_failure_limit() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "ana", MAX_FAILURES - 1, now);
    assert!(throttle.reserve_attempt("ana", now));
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
    assert!(throttle.reserve_attempt("ana", later));
}

#[test]
fn success_resets_the_counter() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "ana", MAX_FAILURES - 1, now);
    throttle.record_success("ana");
    fail_times(&throttle, "ana", MAX_FAILURES - 1, now);
    assert!(throttle.reserve_attempt("ana", now));
}

#[test]
fn stale_failures_outside_the_window_do_not_accumulate() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "ana", MAX_FAILURES - 1, now);
    let later = now + LOCKOUT;
    throttle.reserve_attempt("ana", later);
    assert!(throttle.reserve_attempt("ana", later));
}

#[test]
fn keys_are_independent_and_case_insensitive() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    fail_times(&throttle, "Ana", MAX_FAILURES, now);
    assert!(is_locked(&throttle, "ANA", now));
    assert!(throttle.reserve_attempt("beto", now));
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
    assert!(throttle.reserve_attempt("victima", now));
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

#[test]
fn rejects_a_new_key_when_every_tracked_entry_is_stronger() {
    let throttle = LoginThrottle::default();
    let now = Instant::now();
    for index in 0..MAX_TRACKED {
        fail_times(&throttle, &format!("fuerte-{index}"), 2, now);
    }
    assert!(!throttle.reserve_attempt("nuevo", now));
    assert_eq!(throttle.entries.lock().unwrap().len(), MAX_TRACKED);
}

#[test]
fn concurrent_attempts_never_exceed_the_failure_limit() {
    let throttle = Arc::new(LoginThrottle::default());
    let now = Instant::now();
    let allowed: u32 = (0..32)
        .map(|_| {
            let shared = Arc::clone(&throttle);
            std::thread::spawn(move || u32::from(shared.reserve_attempt("ana", now)))
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
    assert!(throttle.reserve_attempt("ana", now));
    assert!(is_locked(&throttle, "ana", now));
}

#[test]
fn releasing_an_unknown_key_is_a_no_op() {
    let throttle = LoginThrottle::default();
    throttle.release_attempt("nadie");
    assert!(throttle.entries.lock().unwrap().is_empty());
}
