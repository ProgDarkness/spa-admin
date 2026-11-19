use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use super::*;

const WORKERS: usize = 12;
const MAXIMUM: usize = 2;

fn record_peak(active: &AtomicUsize, peak: &AtomicUsize) {
    let now_active = active.fetch_add(1, Ordering::SeqCst) + 1;
    peak.fetch_max(now_active, Ordering::SeqCst);
    std::thread::sleep(Duration::from_millis(15));
    active.fetch_sub(1, Ordering::SeqCst);
}

#[test]
fn never_exceeds_the_maximum_under_contention() {
    let limit = Arc::new(ConcurrencyLimit::new(MAXIMUM));
    let active = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let handles: Vec<_> = (0..WORKERS)
        .map(|_| {
            let (limit, active, peak) =
                (Arc::clone(&limit), Arc::clone(&active), Arc::clone(&peak));
            std::thread::spawn(move || {
                let _permit = limit.acquire();
                record_peak(&active, &peak);
            })
        })
        .collect();
    handles
        .into_iter()
        .for_each(|handle| handle.join().unwrap());
    assert!(peak.load(Ordering::SeqCst) <= MAXIMUM);
    assert_eq!(peak.load(Ordering::SeqCst), MAXIMUM);
    assert_eq!(limit.in_use(), 0);
}

#[test]
fn a_waiter_proceeds_once_a_permit_is_released() {
    let limit = Arc::new(ConcurrencyLimit::new(1));
    let first = limit.acquire();
    let waiter_limit = Arc::clone(&limit);
    let acquired = Arc::new(AtomicBool::new(false));
    let waiter_flag = Arc::clone(&acquired);
    let waiter = std::thread::spawn(move || {
        let _permit = waiter_limit.acquire();
        waiter_flag.store(true, Ordering::SeqCst);
    });
    limit.wait_until_waiting(1);
    assert!(!acquired.load(Ordering::SeqCst));
    drop(first);
    waiter.join().unwrap();
    assert!(acquired.load(Ordering::SeqCst));
    assert_eq!(limit.in_use(), 0);
}

#[test]
fn releases_the_permit_when_the_holder_panics() {
    let limit = Arc::new(ConcurrencyLimit::new(1));
    let holder = Arc::clone(&limit);
    let outcome = std::thread::spawn(move || {
        let _permit = holder.acquire();
        panic!("boom");
    })
    .join();
    assert!(outcome.is_err());
    assert_eq!(limit.in_use(), 0);
    let _again = limit.acquire();
    assert_eq!(limit.in_use(), 1);
}

#[test]
fn releases_the_permit_when_the_work_returns_an_error() {
    let limit = ConcurrencyLimit::new(1);
    let work = |fail: bool| -> Result<(), ()> {
        let _permit = limit.acquire();
        if fail {
            Err(())
        } else {
            Ok(())
        }
    };
    assert!(work(true).is_err());
    assert_eq!(limit.in_use(), 0);
    assert!(work(false).is_ok());
}

#[test]
fn recovers_from_a_poisoned_counter() {
    let limit = Arc::new(ConcurrencyLimit::new(1));
    let poisoner = Arc::clone(&limit);
    let _ = std::thread::spawn(move || {
        let _guard = poisoner.in_use.lock().unwrap();
        panic!("poison");
    })
    .join();
    let _permit = limit.acquire();
    assert_eq!(limit.in_use(), 1);
}
