use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

pub const MAX_FAILURES: u32 = 5;
pub const LOCKOUT: Duration = Duration::from_secs(300);
pub const MAX_TRACKED: usize = 1024;
const NEW_ENTRY_FAILURES: u32 = 1;

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

    fn reserve(&mut self, now: Instant) -> bool {
        if self.locked_until.is_some() {
            return false;
        }
        self.failures += 1;
        self.last_failure = now;
        if self.failures >= MAX_FAILURES {
            self.locked_until = Some(now + LOCKOUT);
        }
        true
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

    pub fn reserve_attempt(&self, key: &str, now: Instant) -> bool {
        let mut entries = self.entries();
        let key = normalize_key(key);
        if entries.get(&key).is_some_and(|entry| entry.is_stale(now)) {
            entries.remove(&key);
        }
        if let Some(entry) = entries.get_mut(&key) {
            return entry.reserve(now);
        }
        if !make_room(&mut entries, now) {
            return false;
        }
        let mut entry = Entry {
            failures: 0,
            last_failure: now,
            locked_until: None,
        };
        entry.reserve(now);
        entries.insert(key, entry);
        true
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
}

fn make_room(entries: &mut HashMap<String, Entry>, now: Instant) -> bool {
    if entries.len() < MAX_TRACKED {
        return true;
    }
    entries.retain(|_, entry| !entry.is_stale(now));
    if entries.len() < MAX_TRACKED {
        return true;
    }
    let weakest = entries
        .iter()
        .filter(|(_, entry)| entry.failures <= NEW_ENTRY_FAILURES)
        .min_by_key(|(_, entry)| entry.last_failure)
        .map(|(key, _)| key.clone());
    match weakest {
        Some(key) => {
            entries.remove(&key);
            true
        }
        None => false,
    }
}

#[cfg(test)]
#[path = "throttle_test.rs"]
mod tests;
