use std::time::Duration;

use rusqlite::Connection;

use super::*;
use crate::db::migrate;
use crate::features::audit::repository::list_all;
use crate::features::auth::model::SessionStatus;
use crate::features::auth::repository::{
    find_active_user_by_id, insert_user, permissions_of_role_for_user, NewUser,
};
use crate::features::auth::service::{session_user_from, LockReason, IDLE_TIMEOUT};

const RECEPTION_ROLE_ID: i64 = 2;
const PLACEHOLDER_HASH: &str = "hash-de-ana";
const RESUME_NOTE: &str = r#"{"note":"resume"}"#;
const TICK: Duration = Duration::from_secs(15);
const HOUR: Duration = Duration::from_secs(3600);

fn secs(value: u64) -> Duration {
    Duration::from_secs(value)
}

fn after(beat: Beat, mono: Duration, wall: Duration) -> Beat {
    Beat {
        mono: beat.mono + mono,
        wall: beat.wall + wall,
    }
}

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn signed_in(conn: &Connection) -> (SessionState, i64, Beat) {
    signed_in_at(conn, Beat::now())
}

fn signed_in_at(conn: &Connection, beat: Beat) -> (SessionState, i64, Beat) {
    let user = NewUser {
        username: "ana".to_string(),
        password_hash: PLACEHOLDER_HASH.to_string(),
        role_id: RECEPTION_ROLE_ID,
    };
    let id = insert_user(conn, &user).unwrap();
    let row = find_active_user_by_id(conn, id).unwrap().unwrap();
    let session_user = session_user_from(row, permissions_of_role_for_user(conn, id).unwrap());
    let state = SessionState::default();
    state.start(session_user, beat).unwrap();
    (state, id, beat)
}

#[test]
fn resume_when_wall_jumps() {
    let start = Beat::now();
    let current = after(start, TICK, TICK + HOUR);

    assert!(resumed_between(start, current));
}

#[test]
fn resume_when_mono_gap_exceeds_threshold() {
    let start = Beat::now();
    let current = after(
        start,
        MAX_HEARTBEAT_GAP + secs(1),
        MAX_HEARTBEAT_GAP + secs(1),
    );

    assert!(resumed_between(start, current));
}

#[test]
fn no_resume_on_regular_tick() {
    let start = Beat::now();

    assert!(!resumed_between(start, after(start, TICK, TICK)));
}

#[test]
fn no_resume_when_gap_is_exactly_the_threshold() {
    let start = Beat::now();

    assert!(!resumed_between(
        start,
        after(start, MAX_HEARTBEAT_GAP, MAX_HEARTBEAT_GAP)
    ));
}

#[test]
fn no_resume_when_wall_goes_back() {
    let start = Beat::now();
    let current = Beat {
        mono: start.mono + TICK,
        wall: start.wall - HOUR,
    };

    assert!(!resumed_between(start, current));
}

#[test]
fn resume_when_wall_goes_back_but_mono_gap_exceeds_threshold() {
    let start = Beat::now();
    let current = Beat {
        mono: start.mono + MAX_HEARTBEAT_GAP + secs(1),
        wall: start.wall - HOUR,
    };

    assert!(resumed_between(start, current));
}

#[test]
fn wall_jump_within_slack_does_not_lock() {
    let start = Beat::now();

    assert!(!resumed_between(
        start,
        after(start, TICK, TICK + HEARTBEAT_SLACK)
    ));
}

#[test]
fn wall_jump_just_over_slack_locks() {
    let start = Beat::now();

    assert!(resumed_between(
        start,
        after(start, TICK, TICK + HEARTBEAT_SLACK + secs(1))
    ));
}

#[test]
fn observe_locks_with_reason_resume_on_wall_jump() {
    let conn = migrated();
    let (state, _, start) = signed_in(&conn);

    let observation = state
        .observe(after(start, TICK, TICK + HOUR))
        .unwrap()
        .unwrap();

    assert_eq!(observation.locked_now, Some(LockReason::Resume));
    assert_eq!(observation.view.status, SessionStatus::Locked);
}

#[test]
fn observe_updates_last_beat_on_regular_tick() {
    let conn = migrated();
    let (state, _, start) = signed_in(&conn);
    let next = after(start, TICK, TICK);

    state.observe(next).unwrap();

    assert_eq!(state.last_beat().unwrap(), Some(next));
}

#[test]
fn observe_does_not_report_resume_twice() {
    let conn = migrated();
    let (state, _, start) = signed_in(&conn);
    let jump = after(start, TICK, TICK + HOUR);

    state.observe(jump).unwrap();
    let second = state.observe(after(jump, TICK, TICK)).unwrap().unwrap();

    assert_eq!(second.locked_now, None);
    assert_eq!(second.view.status, SessionStatus::Locked);
}

#[test]
fn resume_takes_precedence_over_idle_reason() {
    let conn = migrated();
    let (state, _, start) = signed_in(&conn);
    let long = IDLE_TIMEOUT + HOUR;

    let observation = state.observe(after(start, long, long)).unwrap().unwrap();

    assert_eq!(observation.locked_now, Some(LockReason::Resume));
}

#[test]
fn resume_lock_audited_once_with_reason_resume() {
    let conn = migrated();
    let (state, id, start) = signed_in(&conn);
    let jump = after(start, TICK, TICK + HOUR);

    tick(&conn, &state, jump).unwrap();
    tick(&conn, &state, after(jump, TICK, TICK)).unwrap();

    let entries = list_all(&conn).unwrap();
    assert_eq!(entries.len(), 1, "{entries:?}");
    assert_eq!(entries[0].action.as_str(), "session_locked");
    assert_eq!(entries[0].actor_user_id, Some(id));
    assert_eq!(entries[0].entity_id, Some(id));
    assert_eq!(entries[0].diff.as_deref(), Some(RESUME_NOTE));
}

#[test]
fn resume_on_signed_out_session_does_nothing() {
    let conn = migrated();
    let state = SessionState::default();
    let start = Beat::now();

    tick(&conn, &state, after(start, TICK, TICK + HOUR)).unwrap();

    assert!(list_all(&conn).unwrap().is_empty());
    assert!(state.observe(start).unwrap().is_none());
}

#[test]
fn heartbeat_tick_locks_and_audits() {
    let conn = migrated();
    let (state, _, start) = signed_in(&conn);

    tick(&conn, &state, after(start, TICK, TICK + HOUR)).unwrap();

    assert!(state.locked_user_id().unwrap().is_some());
    assert_eq!(list_all(&conn).unwrap().len(), 1);
}

#[test]
fn regular_tick_writes_no_audit() {
    let conn = migrated();
    let (state, _, start) = signed_in(&conn);

    tick(&conn, &state, after(start, TICK, TICK)).unwrap();

    assert!(list_all(&conn).unwrap().is_empty());
    assert_eq!(state.locked_user_id().unwrap(), None);
}

#[test]
fn run_tick_commits_audit_through_database() {
    let database = Database::new(migrated());
    let (state, _, start) = database.with_conn(|conn| Ok(signed_in(conn))).unwrap();

    run_tick(&database, &state, after(start, TICK, TICK + HOUR)).unwrap();

    let entries = database
        .with_conn(|conn| Ok(list_all(conn).unwrap()))
        .unwrap();
    assert_eq!(entries.len(), 1);
}

#[test]
fn tick_recovers_from_poisoned_session_mutex_as_signed_out() {
    let conn = migrated();
    let (state, _, start) = signed_in(&conn);
    state.poison_for_test();

    let outcome = tick(&conn, &state, after(start, TICK, TICK));

    assert!(outcome.is_ok());
    assert!(state.observe(after(start, TICK, TICK)).unwrap().is_none());
}

fn inside_open_transaction(conn: Connection) -> Database {
    conn.execute_batch("BEGIN").unwrap();
    Database::new(conn)
}

#[test]
fn run_tick_without_a_session_never_opens_a_transaction() {
    let database = inside_open_transaction(migrated());

    let outcome = run_tick(&database, &SessionState::default(), Beat::now());

    assert!(outcome.is_ok());
}

#[test]
fn run_tick_with_a_session_opens_a_transaction() {
    let conn = migrated();
    let (state, _, start) = signed_in(&conn);
    let database = inside_open_transaction(conn);

    let outcome = run_tick(&database, &state, after(start, TICK, TICK));

    assert!(matches!(outcome, Err(AuthError::Db(_))));
}

#[test]
fn heartbeat_step_is_a_no_op_when_the_state_is_not_managed() {
    let app = tauri::test::mock_app();

    assert!(heartbeat_step(app.handle()).is_ok());
}

#[test]
fn heartbeat_step_is_a_no_op_when_only_the_database_is_managed() {
    let app = tauri::test::mock_app();
    app.manage(inside_open_transaction(migrated()));

    assert!(heartbeat_step(app.handle()).is_ok());
}

#[test]
fn heartbeat_step_ticks_when_both_states_are_managed_and_a_session_exists() {
    let conn = migrated();
    let (state, _, _) = signed_in(&conn);
    let app = tauri::test::mock_app();
    app.manage(inside_open_transaction(conn));
    app.manage(state);

    assert!(matches!(
        heartbeat_step(app.handle()),
        Err(AuthError::Db(_))
    ));
}

const BACKGROUND_DEADLINE: Duration = Duration::from_secs(10);
const REAL_INTERVAL: Duration = Duration::from_millis(1);

type App = tauri::App<tauri::test::MockRuntime>;

fn stale_beat() -> Beat {
    let now = Beat::now();
    Beat {
        mono: now.mono,
        wall: now.wall - HOUR,
    }
}

fn wait_until(condition: impl Fn() -> bool) -> bool {
    let started = std::time::Instant::now();
    while started.elapsed() < BACKGROUND_DEADLINE {
        if condition() {
            return true;
        }
        std::thread::yield_now();
    }
    false
}

fn audit_count(app: &App) -> usize {
    app.state::<Database>()
        .with_conn(|conn| Ok(list_all(conn).unwrap().len()))
        .unwrap()
}

fn app_with_stale_session(database: impl FnOnce(Connection) -> Database) -> App {
    let conn = migrated();
    let (state, _, _) = signed_in_at(&conn, stale_beat());
    let app = tauri::test::mock_app();
    app.manage(database(conn));
    app.manage(state);
    app
}

struct Metronome {
    ticks: std::sync::mpsc::Sender<()>,
    parked: std::sync::mpsc::Receiver<()>,
    worker: std::thread::JoinHandle<()>,
}

impl Metronome {
    fn start(app: &App) -> Self {
        let (ticks, tick_receiver) = std::sync::mpsc::channel::<()>();
        let (parked_sender, parked) = std::sync::mpsc::channel::<()>();
        let handle = app.handle().clone();
        let worker = std::thread::spawn(move || {
            heartbeat_loop(&handle, || {
                parked_sender.send(()).ok();
                tick_receiver.recv().is_ok()
            })
        });
        parked.recv().unwrap();
        Self {
            ticks,
            parked,
            worker,
        }
    }

    fn beat(&self) {
        self.ticks.send(()).unwrap();
        self.parked.recv().unwrap();
    }

    fn stop(self) {
        drop(self.ticks);
        assert!(wait_until(|| self.worker.is_finished()));
        self.worker.join().unwrap();
    }
}

#[test]
fn heartbeat_loop_locks_a_session_that_resumed_and_audits_it_once() {
    let app = app_with_stale_session(Database::new);
    let metronome = Metronome::start(&app);

    metronome.beat();

    assert_eq!(audit_count(&app), 1);
    assert!(app
        .state::<SessionState>()
        .locked_user_id()
        .unwrap()
        .is_some());
    metronome.beat();
    assert_eq!(audit_count(&app), 1);
    metronome.stop();
}

#[test]
fn heartbeat_loop_keeps_running_after_a_failed_step() {
    let app = app_with_stale_session(inside_open_transaction);
    let metronome = Metronome::start(&app);

    metronome.beat();
    assert_eq!(app.state::<SessionState>().locked_user_id().unwrap(), None);
    app.state::<Database>()
        .with_conn(|conn| Ok(conn.execute_batch("COMMIT")?))
        .unwrap();
    metronome.beat();

    assert_eq!(audit_count(&app), 1);
    metronome.stop();
}

#[test]
fn heartbeat_loop_takes_no_step_before_the_first_beat_nor_after_stopping() {
    let app = app_with_stale_session(Database::new);
    let metronome = Metronome::start(&app);

    assert_eq!(audit_count(&app), 0);
    assert_eq!(app.state::<SessionState>().locked_user_id().unwrap(), None);
    metronome.stop();

    assert_eq!(audit_count(&app), 0);
}

#[test]
fn spawned_heartbeat_beats_on_its_own_and_stops_when_asked() {
    let app = app_with_stale_session(Database::new);
    let stop = Arc::new(AtomicBool::new(false));

    let worker = spawn_heartbeat_until(app.handle().clone(), REAL_INTERVAL, Arc::clone(&stop));

    assert!(wait_until(|| audit_count(&app) == 1));
    stop.store(true, Ordering::SeqCst);
    assert!(wait_until(|| worker.is_finished()));
    worker.join().unwrap();
    assert_eq!(audit_count(&app), 1);
}
