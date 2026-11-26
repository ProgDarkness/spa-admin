use std::cell::{Cell, RefCell};
use std::io;
use std::time::Duration;

use super::*;

const MAX_ATTEMPTS: usize = BACKOFF.len() + 1;

fn transient() -> io::Error {
    io::Error::from_raw_os_error(32)
}

fn always_transient(error: &io::Error) -> bool {
    is_transient_os_error(error)
}

#[test]
fn access_denied_sharing_and_lock_violations_are_transient() {
    for code in [5, 32, 33] {
        assert!(is_transient_os_error(&io::Error::from_raw_os_error(code)));
    }
}

#[test]
fn other_errors_are_not_transient() {
    assert!(!is_transient_os_error(&io::Error::from_raw_os_error(2)));
    assert!(!is_transient_os_error(&io::Error::from_raw_os_error(31)));
    assert!(!is_transient_os_error(&io::Error::from(
        io::ErrorKind::NotFound
    )));
    assert!(!is_transient_os_error(&io::Error::other("boom")));
}

#[test]
fn succeeds_after_transient_failures() {
    let calls = Cell::new(0);
    let slept = RefCell::new(Vec::new());

    let result = retry_with_backoff(
        || {
            calls.set(calls.get() + 1);
            if calls.get() <= 3 {
                Err(transient())
            } else {
                Ok(7)
            }
        },
        always_transient,
        |pause| slept.borrow_mut().push(pause),
    );

    assert_eq!(result.unwrap(), 7);
    assert_eq!(calls.get(), 4);
    assert_eq!(
        *slept.borrow(),
        vec![
            Duration::from_millis(50),
            Duration::from_millis(100),
            Duration::from_millis(200)
        ]
    );
}

#[test]
fn succeeds_first_try_without_sleeping() {
    let slept = RefCell::new(Vec::new());

    let result = retry_with_backoff(|| Ok(1), always_transient, |p| slept.borrow_mut().push(p));

    assert_eq!(result.unwrap(), 1);
    assert!(slept.borrow().is_empty());
}

#[test]
fn gives_up_after_the_maximum_and_returns_the_last_error() {
    let calls = Cell::new(0);

    let result: io::Result<()> = retry_with_backoff(
        || {
            calls.set(calls.get() + 1);
            Err(io::Error::from_raw_os_error(
                if calls.get() == MAX_ATTEMPTS { 33 } else { 32 },
            ))
        },
        always_transient,
        |_| {},
    );

    assert_eq!(calls.get(), MAX_ATTEMPTS);
    assert_eq!(result.unwrap_err().raw_os_error(), Some(33));
}

#[test]
fn does_not_retry_non_transient_errors() {
    let calls = Cell::new(0);
    let slept = Cell::new(0);

    let result: io::Result<()> = retry_with_backoff(
        || {
            calls.set(calls.get() + 1);
            Err(io::Error::from(io::ErrorKind::NotFound))
        },
        always_transient,
        |_| slept.set(slept.get() + 1),
    );

    assert_eq!(result.unwrap_err().kind(), io::ErrorKind::NotFound);
    assert_eq!(calls.get(), 1);
    assert_eq!(slept.get(), 0);
}

#[test]
fn total_injected_sleep_stays_under_the_cap() {
    let total = RefCell::new(Duration::ZERO);

    let _: io::Result<()> = retry_with_backoff(
        || Err(transient()),
        always_transient,
        |pause| *total.borrow_mut() += pause,
    );

    assert!(*total.borrow() < Duration::from_secs(1));
    assert_eq!(*total.borrow(), Duration::from_millis(750));
}

#[test]
fn rename_with_retry_moves_a_file_and_reports_missing_source() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("a");
    let to = dir.path().join("b");
    std::fs::write(&from, b"x").unwrap();

    rename_with_retry(&from, &to).unwrap();
    let missing = rename_with_retry(&from, &to).unwrap_err();

    assert!(to.exists());
    assert_eq!(missing.kind(), io::ErrorKind::NotFound);
}
