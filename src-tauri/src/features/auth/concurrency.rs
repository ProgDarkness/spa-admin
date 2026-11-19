use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};

#[cfg(test)]
const WAITER_SYNC_DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);

pub struct ConcurrencyLimit {
    maximum: usize,
    in_use: Mutex<usize>,
    released: Condvar,
    #[cfg(test)]
    waiting: std::sync::atomic::AtomicUsize,
}

pub struct Permit<'limit> {
    limit: &'limit ConcurrencyLimit,
}

impl ConcurrencyLimit {
    pub const fn new(maximum: usize) -> Self {
        Self {
            maximum,
            in_use: Mutex::new(0),
            released: Condvar::new(),
            #[cfg(test)]
            waiting: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    fn counter(&self) -> MutexGuard<'_, usize> {
        self.in_use.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn acquire(&self) -> Permit<'_> {
        let mut in_use = self.counter();
        while *in_use >= self.maximum {
            #[cfg(test)]
            self.waiting
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            in_use = self
                .released
                .wait(in_use)
                .unwrap_or_else(PoisonError::into_inner);
            #[cfg(test)]
            self.waiting
                .fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        }
        *in_use += 1;
        Permit { limit: self }
    }

    #[cfg(test)]
    pub(crate) fn wait_until_waiting(&self, waiters: usize) {
        let deadline = std::time::Instant::now() + WAITER_SYNC_DEADLINE;
        while self.waiting.load(std::sync::atomic::Ordering::SeqCst) != waiters {
            assert!(
                std::time::Instant::now() < deadline,
                "expected {waiters} waiter(s) on the limit"
            );
            std::thread::yield_now();
        }
    }

    #[cfg(test)]
    pub(crate) fn in_use(&self) -> usize {
        *self.counter()
    }
}

impl Drop for Permit<'_> {
    fn drop(&mut self) {
        *self.limit.counter() -= 1;
        self.limit.released.notify_one();
    }
}

#[cfg(test)]
#[path = "concurrency_test.rs"]
mod tests;
