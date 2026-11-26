use std::fs;
use std::io;
use std::path::Path;
use std::thread;
use std::time::Duration;

const BACKOFF: [Duration; 4] = [
    Duration::from_millis(50),
    Duration::from_millis(100),
    Duration::from_millis(200),
    Duration::from_millis(400),
];
const WINDOWS_ACCESS_DENIED: i32 = 5;
const WINDOWS_SHARING_VIOLATION: i32 = 32;
const WINDOWS_LOCK_VIOLATION: i32 = 33;

fn is_transient_os_error(error: &io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(WINDOWS_ACCESS_DENIED | WINDOWS_SHARING_VIOLATION | WINDOWS_LOCK_VIOLATION)
    )
}

fn is_transient_on_this_platform(error: &io::Error) -> bool {
    cfg!(windows) && is_transient_os_error(error)
}

fn retry_with_backoff<T>(
    mut operation: impl FnMut() -> io::Result<T>,
    is_transient: impl Fn(&io::Error) -> bool,
    mut sleep: impl FnMut(Duration),
) -> io::Result<T> {
    let mut pauses = BACKOFF.iter();
    loop {
        match operation() {
            Err(error) if is_transient(&error) => match pauses.next() {
                Some(pause) => sleep(*pause),
                None => return Err(error),
            },
            outcome => return outcome,
        }
    }
}

pub(crate) fn rename_with_retry(from: &Path, to: &Path) -> io::Result<()> {
    retry_with_backoff(
        || fs::rename(from, to),
        is_transient_on_this_platform,
        thread::sleep,
    )
}

#[cfg(test)]
#[path = "fs_retry_test.rs"]
mod tests;
