use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use super::service::AuthError;

pub const MAX_FAILURES: u32 = 5;
pub const LOCKOUT: Duration = Duration::from_secs(300);
pub const MAX_TRACKED: usize = 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reservation {
    Denied,
    Granted,
}

impl Reservation {
    pub fn is_granted(self) -> bool {
        self != Self::Denied
    }
}

struct Entry {
    failures: u32,
    last_failure: Instant,
    locked_until: Option<Instant>,
}

impl Entry {
    fn is_stale(&self, now: Instant) -> bool {
        match self.locked_until {
            Some(until) => until <= now,
            None => now.saturating_duration_since(self.last_failure) >= LOCKOUT,
        }
    }

    fn reserve(&mut self, now: Instant) -> Reservation {
        if self.locked_until.is_some() {
            return Reservation::Denied;
        }
        self.failures += 1;
        self.last_failure = now;
        if self.failures >= MAX_FAILURES {
            self.locked_until = Some(now + LOCKOUT);
        }
        Reservation::Granted
    }
}

#[derive(Default)]
pub struct LoginThrottle {
    entries: Mutex<HashMap<String, Entry>>,
}

fn normalize_key(key: &str) -> String {
    key.to_lowercase()
}

impl LoginThrottle {
    fn entries(&self) -> MutexGuard<'_, HashMap<String, Entry>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn reserve_attempt(&self, key: &str, now: Instant) -> Reservation {
        let mut entries = self.entries();
        let key = normalize_key(key);
        if entries.get(&key).is_some_and(|entry| entry.is_stale(now)) {
            entries.remove(&key);
        }
        if let Some(entry) = entries.get_mut(&key) {
            return entry.reserve(now);
        }
        make_room(&mut entries, now);
        let mut entry = Entry {
            failures: 0,
            last_failure: now,
            locked_until: None,
        };
        let reservation = entry.reserve(now);
        entries.insert(key, entry);
        reservation
    }

    pub fn release_attempt(&self, key: &str) {
        let mut entries = self.entries();
        let key = normalize_key(key);
        let Some(entry) = entries.get_mut(&key) else {
            return;
        };
        entry.failures = entry.failures.saturating_sub(1);
        if entry.failures < MAX_FAILURES {
            entry.locked_until = None;
        }
        if entry.failures == 0 {
            entries.remove(&key);
        }
    }

    pub fn record_success(&self, key: &str) {
        self.entries().remove(&normalize_key(key));
    }

    pub fn settle<T>(&self, key: &str, outcome: Result<T, AttemptFailure>) -> Result<T, AuthError> {
        match outcome {
            Ok(value) => {
                self.record_success(key);
                Ok(value)
            }
            Err(failure) => {
                if !failure.attempt_spent {
                    self.release_attempt(key);
                }
                Err(failure.error)
            }
        }
    }
}

#[derive(Debug)]
pub struct AttemptFailure {
    pub error: AuthError,
    pub attempt_spent: bool,
}

impl AttemptFailure {
    pub fn spent(error: AuthError) -> Self {
        Self {
            error,
            attempt_spent: true,
        }
    }

    pub fn spent_only_if(self, counts: bool) -> Self {
        Self {
            attempt_spent: self.attempt_spent && counts,
            ..self
        }
    }
}

impl From<AuthError> for AttemptFailure {
    fn from(error: AuthError) -> Self {
        let attempt_spent = matches!(error, AuthError::InvalidCredentials);
        Self {
            error,
            attempt_spent,
        }
    }
}

fn make_room(entries: &mut HashMap<String, Entry>, now: Instant) {
    if entries.len() < MAX_TRACKED {
        return;
    }
    entries.retain(|_, entry| !entry.is_stale(now));
    if entries.len() < MAX_TRACKED {
        return;
    }
    let victim = weakest_unlocked(entries).or_else(|| soonest_to_expire(entries));
    if let Some(key) = victim {
        entries.remove(&key);
    }
}

fn weakest_unlocked(entries: &HashMap<String, Entry>) -> Option<String> {
    entries
        .iter()
        .filter(|(_, entry)| entry.locked_until.is_none())
        .min_by_key(|(_, entry)| (entry.failures, entry.last_failure))
        .map(|(key, _)| key.clone())
}

fn soonest_to_expire(entries: &HashMap<String, Entry>) -> Option<String> {
    entries
        .iter()
        .min_by_key(|(_, entry)| entry.locked_until)
        .map(|(key, _)| key.clone())
}

#[cfg(test)]
#[path = "throttle_test.rs"]
mod tests;
