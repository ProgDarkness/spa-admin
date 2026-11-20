use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use rusqlite::Connection;
use tauri::{AppHandle, Manager, Runtime};

use super::events;
use super::service::{AuthError, Beat, SessionState};
use crate::db::Database;

pub const HEARTBEAT_SLACK: Duration = Duration::from_secs(30);
pub const MAX_HEARTBEAT_GAP: Duration = Duration::from_secs(120);
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);

pub fn resumed_between(previous: Beat, current: Beat) -> bool {
    let mono = current.mono.saturating_duration_since(previous.mono);
    match current.wall.duration_since(previous.wall) {
        Ok(wall) => wall > mono + HEARTBEAT_SLACK || mono > MAX_HEARTBEAT_GAP,
        Err(_) => mono > MAX_HEARTBEAT_GAP,
    }
}

pub fn tick(conn: &Connection, session: &SessionState, beat: Beat) -> Result<(), AuthError> {
    let Some(observation) = session.observe(beat)? else {
        return Ok(());
    };
    events::session_locked_if_new(conn, session, &observation)
}

pub fn run_tick(database: &Database, session: &SessionState, beat: Beat) -> Result<(), AuthError> {
    if session.last_beat()?.is_none() {
        return Ok(());
    }
    database.with_tx(|tx| tick(tx, session, beat))
}

pub fn heartbeat_step<R: Runtime>(app: &AppHandle<R>) -> Result<(), AuthError> {
    let (Some(database), Some(session)) =
        (app.try_state::<Database>(), app.try_state::<SessionState>())
    else {
        return Ok(());
    };
    run_tick(&database, &session, Beat::now())
}

fn heartbeat_loop<R: Runtime>(app: &AppHandle<R>, mut keep_beating: impl FnMut() -> bool) {
    while keep_beating() {
        if let Err(error) = heartbeat_step(app) {
            eprintln!("heartbeat: {error}");
        }
    }
}

fn spawn_heartbeat_until<R: Runtime>(
    app: AppHandle<R>,
    interval: Duration,
    stop: Arc<AtomicBool>,
) -> JoinHandle<()> {
    std::thread::spawn(move || {
        heartbeat_loop(&app, || {
            std::thread::sleep(interval);
            !stop.load(Ordering::SeqCst)
        })
    })
}

pub fn spawn_heartbeat<R: Runtime>(app: AppHandle<R>) {
    spawn_heartbeat_until(app, HEARTBEAT_INTERVAL, Arc::new(AtomicBool::new(false)));
}

#[cfg(test)]
#[path = "heartbeat_test.rs"]
mod tests;
