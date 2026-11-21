use std::time::Duration;

use tauri::test::{mock_app, MockRuntime};
use tauri::{App, Manager};

use super::*;
use crate::db::{migrate, Database};
use crate::errors::{AppError, AppErrorCode};
use crate::features::audit::repository::list_all;
use crate::features::auth::model::SessionUser;
use crate::features::auth::repository::permissions_of_role_for_user;
use crate::features::auth::service::{Beat, LockReason, SessionState, IDLE_TIMEOUT};
use crate::features::rates::model::MAX_RATE_E4;
use crate::features::rates::repository;
use crate::features::users::repository::{insert_user, NewUserRow};

const OWNER_ROLE: i64 = 1;
const READ_ONLY_ROLE: i64 = 3;
const DATE: &str = "2026-11-12";
const OTHER_DATE: &str = "2026-11-13";
const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";

struct Fixture {
    app: App<MockRuntime>,
}

fn add_role(conn: &rusqlite::Connection, name: &str, permissions: &[&str]) -> i64 {
    conn.execute("INSERT INTO roles (name) VALUES (?1)", [name])
        .unwrap();
    let role_id = conn.last_insert_rowid();
    for permission in permissions {
        conn.execute(
            "INSERT INTO role_permissions (role_id, permission_key) VALUES (?1, ?2)",
            rusqlite::params![role_id, permission],
        )
        .unwrap();
    }
    role_id
}

fn add_user(conn: &rusqlite::Connection, username: &str, role_id: i64) {
    let row = NewUserRow {
        username: username.to_string(),
        password_hash: "hash-opaco".to_string(),
        role_id,
    };
    insert_user(conn, &row, None).unwrap();
}

fn fixture() -> Fixture {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    let rates_manager = add_role(&conn, "Gestor tasas", &["rates.manage"]);
    let payments_reader = add_role(&conn, "Lector pagos", &["payments.read"]);
    let payments_writer = add_role(&conn, "Escritor pagos", &["payments.write"]);
    let catalog_manager = add_role(&conn, "Gestor catalogo", &["catalog.read", "catalog.write"]);
    let without_permissions = add_role(&conn, "Sin permisos", &[]);
    add_user(&conn, "propietaria", OWNER_ROLE);
    add_user(&conn, "lectura", READ_ONLY_ROLE);
    add_user(&conn, "gestora", rates_manager);
    add_user(&conn, "lectorpagos", payments_reader);
    add_user(&conn, "escritorpagos", payments_writer);
    add_user(&conn, "gestoracatalogo", catalog_manager);
    add_user(&conn, "sinpermisos", without_permissions);
    let app = mock_app();
    app.manage(Database::new(conn));
    app.manage(SessionState::default());
    Fixture { app }
}

fn sign_in_as(fixture: &Fixture, username: &str) {
    let db: tauri::State<'_, Database> = fixture.app.state();
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    let user = db
        .with_conn(|conn| {
            let (id, role_name): (i64, String) = conn.query_row(
                "SELECT u.id, r.name FROM users u JOIN roles r ON r.id = u.role_id \
                 WHERE u.username = ?1",
                [username],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            Ok(SessionUser {
                id,
                username: username.to_string(),
                role_name,
                permissions: permissions_of_role_for_user(conn, id)?,
            })
        })
        .unwrap();
    session.start(user, Beat::now()).unwrap();
}

fn lock_session(fixture: &Fixture) {
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    session.force_lock().unwrap();
}

fn session_end(fixture: &Fixture) {
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    session.end().unwrap();
}

fn call_list(fixture: &Fixture) -> Result<Vec<ExchangeRate>, AppError> {
    list_rates(fixture.app.state(), fixture.app.state())
}

fn call_get(fixture: &Fixture, date: &str) -> Result<Option<ExchangeRate>, AppError> {
    get_rate(date.to_string(), fixture.app.state(), fixture.app.state())
}

fn call_upsert(fixture: &Fixture, date: &str, value: i64) -> Result<ExchangeRate, AppError> {
    upsert_rate(
        date.to_string(),
        value,
        fixture.app.state(),
        fixture.app.state(),
    )
}

fn seed_rate(fixture: &Fixture, date: &str, value: i64) -> ExchangeRate {
    sign_in_as(fixture, "propietaria");
    call_upsert(fixture, date, value).unwrap()
}

fn database(fixture: &Fixture) -> tauri::State<'_, Database> {
    fixture.app.state()
}

fn stored_rates(fixture: &Fixture) -> Vec<ExchangeRate> {
    database(fixture).with_conn(repository::list_rates).unwrap()
}

fn audit_actions(fixture: &Fixture) -> Vec<String> {
    database(fixture)
        .with_conn(list_all)
        .unwrap()
        .into_iter()
        .map(|entry| entry.action.as_str().to_string())
        .collect()
}

type Outcomes = Vec<(&'static str, Result<(), AppError>)>;

fn every_command(fixture: &Fixture) -> Outcomes {
    vec![
        ("list_rates", call_list(fixture).map(|_| ())),
        ("get_rate", call_get(fixture, DATE).map(|_| ())),
        (
            "upsert_rate",
            call_upsert(fixture, OTHER_DATE, 400_000).map(|_| ()),
        ),
    ]
}

fn assert_all_fail_with(outcomes: Outcomes, code: AppErrorCode) {
    for (name, outcome) in outcomes {
        assert_eq!(outcome.expect_err(name).code, code, "{name}");
    }
}

#[test]
fn list_rates_requires_a_session() {
    let fixture = fixture();

    assert_eq!(
        call_list(&fixture).unwrap_err(),
        AppError::unauthenticated()
    );
}

#[test]
fn every_rate_command_without_session_is_unauthenticated() {
    let fixture = fixture();
    seed_rate(&fixture, DATE, 365_000);
    session_end(&fixture);

    assert_all_fail_with(every_command(&fixture), AppErrorCode::Unauthenticated);

    assert_eq!(stored_rates(&fixture).len(), 1);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn every_rate_command_with_a_locked_session_is_session_locked() {
    let fixture = fixture();
    seed_rate(&fixture, DATE, 365_000);
    lock_session(&fixture);

    assert_all_fail_with(every_command(&fixture), AppErrorCode::SessionLocked);

    assert_eq!(stored_rates(&fixture).len(), 1);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn rates_manage_or_payments_read_can_read_but_only_rates_manage_can_write() {
    for (username, can_write) in [
        ("propietaria", true),
        ("gestora", true),
        ("lectura", false),
        ("lectorpagos", false),
    ] {
        let fixture = fixture();
        let seeded = seed_rate(&fixture, DATE, 365_000);
        sign_in_as(&fixture, username);

        let listed = call_list(&fixture).unwrap();
        let fetched = call_get(&fixture, DATE).unwrap();
        let written = call_upsert(&fixture, DATE, 370_000);

        assert_eq!(listed, vec![seeded.clone()], "{username}");
        assert_eq!(fetched, Some(seeded.clone()), "{username}");
        match (can_write, written) {
            (true, outcome) => assert!(outcome.is_ok(), "{username}"),
            (false, outcome) => {
                assert_eq!(outcome.unwrap_err(), AppError::forbidden(), "{username}");
                assert_eq!(stored_rates(&fixture), vec![seeded], "{username}");
                assert_eq!(audit_actions(&fixture), ["create"], "{username}");
            }
        }
    }
}

#[test]
fn users_without_a_usable_rate_permission_are_forbidden_everywhere() {
    for username in ["sinpermisos", "escritorpagos", "gestoracatalogo"] {
        let fixture = fixture();
        seed_rate(&fixture, DATE, 365_000);
        sign_in_as(&fixture, username);

        assert_all_fail_with(every_command(&fixture), AppErrorCode::Forbidden);

        assert_eq!(stored_rates(&fixture).len(), 1, "{username}");
        assert_eq!(audit_actions(&fixture), ["create"], "{username}");
    }
}

#[test]
fn upsert_rate_through_the_command_creates_then_updates_and_audits_each() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");

    let created = call_upsert(&fixture, DATE, 365_000).unwrap();
    let updated = call_upsert(&fixture, DATE, 370_000).unwrap();

    assert_eq!(created.rate_bs_per_usd_e4, 365_000);
    assert_eq!(updated.rate_bs_per_usd_e4, 370_000);
    assert_eq!(stored_rates(&fixture), vec![updated]);
    assert_eq!(audit_actions(&fixture), ["create", "update"]);
}

#[test]
fn every_write_attributes_the_audit_and_the_stamp_to_the_signed_in_user() {
    let fixture = fixture();
    sign_in_as(&fixture, "gestora");
    let actor: i64 = database(&fixture)
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT id FROM users WHERE username = 'gestora'",
                [],
                |row| row.get(0),
            )?)
        })
        .unwrap();

    call_upsert(&fixture, DATE, 365_000).unwrap();
    call_upsert(&fixture, DATE, 370_000).unwrap();

    let actors: Vec<Option<i64>> = database(&fixture)
        .with_conn(list_all)
        .unwrap()
        .into_iter()
        .map(|entry| entry.actor_user_id)
        .collect();
    let stamp: (i64, i64) = database(&fixture)
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT created_by, updated_by FROM exchange_rates",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?)
        })
        .unwrap();
    assert_eq!(actors, vec![Some(actor); 2]);
    assert_eq!(stamp, (actor, actor));
}

#[test]
fn list_rates_returns_the_rates_by_date_descending() {
    let fixture = fixture();
    seed_rate(&fixture, DATE, 365_000);
    call_upsert(&fixture, "2027-01-01", 380_000).unwrap();
    call_upsert(&fixture, OTHER_DATE, 366_000).unwrap();

    let dates: Vec<String> = call_list(&fixture)
        .unwrap()
        .into_iter()
        .map(|rate| rate.date)
        .collect();

    assert_eq!(dates, ["2027-01-01", OTHER_DATE, DATE]);
}

#[test]
fn get_rate_of_a_date_without_rate_is_none_and_not_an_error() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");

    assert_eq!(call_get(&fixture, DATE).unwrap(), None);
}

#[test]
fn saving_the_same_value_through_the_command_does_not_audit() {
    let fixture = fixture();
    let created = seed_rate(&fixture, DATE, 365_000);

    let same = call_upsert(&fixture, DATE, 365_000).unwrap();

    assert_eq!(same, created);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn domain_validation_errors_reach_the_caller_with_their_field() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");

    let impossible = call_upsert(&fixture, "2026-02-30", 365_000).unwrap_err();
    let malformed = call_upsert(&fixture, "12-11-2026", 365_000).unwrap_err();
    let zero = call_upsert(&fixture, DATE, 0).unwrap_err();
    let too_high = call_upsert(&fixture, DATE, MAX_RATE_E4 + 1).unwrap_err();
    let bad_lookup = call_get(&fixture, "nope").unwrap_err();

    assert_eq!(impossible, AppError::validation("date"));
    assert_eq!(malformed, AppError::validation("date"));
    assert_eq!(zero, AppError::validation("rateBsPerUsdE4"));
    assert_eq!(too_high, AppError::validation("rateBsPerUsdE4"));
    assert_eq!(bad_lookup, AppError::validation("date"));
    assert!(audit_actions(&fixture).is_empty());
}

fn break_audit(fixture: &Fixture) {
    database(fixture)
        .with_conn(|conn| {
            conn.execute_batch(FAIL_AUDIT_INSERTS)?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_failing_audit_rolls_back_creation_and_update_and_reports_internal() {
    let fixture = fixture();
    let created = seed_rate(&fixture, DATE, 365_000);
    break_audit(&fixture);

    let on_create = call_upsert(&fixture, OTHER_DATE, 366_000).unwrap_err();
    let on_update = call_upsert(&fixture, DATE, 370_000).unwrap_err();

    assert_eq!(on_create, AppError::internal());
    assert_eq!(on_update, AppError::internal());
    assert_eq!(stored_rates(&fixture), vec![created]);
}

fn revoke_owner_rates_manage(fixture: &Fixture) {
    database(fixture)
        .with_conn(|conn| {
            conn.execute(
                "DELETE FROM role_permissions WHERE role_id = ?1 AND permission_key = 'rates.manage'",
                [OWNER_ROLE],
            )?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn losing_the_permission_between_calls_blocks_the_next_write() {
    let fixture = fixture();
    let created = seed_rate(&fixture, DATE, 365_000);
    revoke_owner_rates_manage(&fixture);

    let error = call_upsert(&fixture, DATE, 370_000).unwrap_err();

    assert_eq!(error, AppError::forbidden());
    assert_eq!(stored_rates(&fixture), vec![created]);
}

fn sign_in_idle_past_timeout(fixture: &Fixture, username: &str) {
    sign_in_as(fixture, username);
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    let user = session
        .observe(Beat::now())
        .unwrap()
        .unwrap()
        .view
        .user
        .unwrap();
    session.end().unwrap();
    let now = Beat::now();
    let past = now
        .mono
        .checked_sub(IDLE_TIMEOUT + Duration::from_secs(1))
        .zip(now.wall.checked_sub(IDLE_TIMEOUT + Duration::from_secs(1)));
    match past {
        Some((mono, wall)) => session.start(user, Beat { mono, wall }).unwrap(),
        None => {
            session.start(user, now).unwrap();
            session.lock_with_pending_audit_for_test(LockReason::Idle);
        }
    }
}

fn session_locked_rows(fixture: &Fixture) -> i64 {
    database(fixture)
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT COUNT(*) FROM audit_log WHERE action = 'session_locked'",
                [],
                |row| row.get(0),
            )?)
        })
        .unwrap()
}

#[test]
fn upsert_audits_an_idle_lock_first_seen_on_it_exactly_once() {
    let fixture = fixture();
    seed_rate(&fixture, DATE, 365_000);
    let before = stored_rates(&fixture);
    sign_in_idle_past_timeout(&fixture, "propietaria");

    let outcome = call_upsert(&fixture, DATE, 370_000);

    assert_eq!(outcome.unwrap_err().code, AppErrorCode::SessionLocked);
    assert_eq!(session_locked_rows(&fixture), 1);
    assert_eq!(stored_rates(&fixture), before);
}

fn rates_row_count(fixture: &Fixture) -> i64 {
    database(fixture)
        .with_conn(|conn| {
            Ok(conn.query_row("SELECT COUNT(*) FROM exchange_rates", [], |row| row.get(0))?)
        })
        .unwrap()
}

#[test]
fn no_rate_command_ever_reduces_the_number_of_rates() {
    let fixture = fixture();
    seed_rate(&fixture, DATE, 365_000);
    let mut counts = vec![rates_row_count(&fixture)];

    for (date, value) in [
        (DATE, 370_000),
        (DATE, 370_000),
        (OTHER_DATE, 1),
        (DATE, MAX_RATE_E4),
        (OTHER_DATE, 2),
    ] {
        call_upsert(&fixture, date, value).unwrap();
        counts.push(rates_row_count(&fixture));
    }
    call_list(&fixture).unwrap();
    call_get(&fixture, DATE).unwrap();
    counts.push(rates_row_count(&fixture));
    let _ = call_upsert(&fixture, "2026-02-30", 5);
    let _ = call_upsert(&fixture, DATE, 0);
    let _ = call_get(&fixture, "nope");
    counts.push(rates_row_count(&fixture));
    break_audit(&fixture);
    let _ = call_upsert(&fixture, "2026-12-01", 5);
    counts.push(rates_row_count(&fixture));

    assert!(
        counts.windows(2).all(|pair| pair[0] <= pair[1]),
        "{counts:?}"
    );
    assert_eq!(*counts.last().unwrap(), 2);
}

fn past_idle_beat() -> Beat {
    let now = Beat::now();
    let by = IDLE_TIMEOUT + Duration::from_secs(1);
    Beat {
        mono: now.mono + by,
        wall: now.wall + by,
    }
}

fn run_in_transaction(fixture: &Fixture, beat: Beat) -> Result<(), AppError> {
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    database(fixture)
        .with_tx(|tx| upsert_rate_in_transaction(tx, &session, beat, DATE, 370_000).map(|_| ()))
        .map_err(AppError::from)
}

#[test]
fn the_transactional_write_revalidates_the_permission_inside_the_transaction() {
    let fixture = fixture();
    seed_rate(&fixture, DATE, 365_000);
    let stored_before = stored_rates(&fixture);
    let audit_before = audit_actions(&fixture);
    revoke_owner_rates_manage(&fixture);

    let outcome = run_in_transaction(&fixture, Beat::now());

    assert_eq!(outcome.unwrap_err(), AppError::forbidden());
    assert_eq!(stored_rates(&fixture), stored_before);
    assert_eq!(audit_actions(&fixture), audit_before);
}

#[test]
fn the_transactional_write_revalidates_the_idle_lock_and_keeps_its_audit_for_the_next_attempt() {
    let fixture = fixture();
    seed_rate(&fixture, DATE, 365_000);
    let stored_before = stored_rates(&fixture);
    let audit_before = audit_actions(&fixture);

    let outcome = run_in_transaction(&fixture, past_idle_beat());

    assert_eq!(outcome.unwrap_err().code, AppErrorCode::SessionLocked);
    assert_eq!(stored_rates(&fixture), stored_before);
    assert_eq!(audit_actions(&fixture), audit_before);
    let next = call_upsert(&fixture, OTHER_DATE, 366_000);
    assert_eq!(next.unwrap_err().code, AppErrorCode::SessionLocked);
    assert_eq!(session_locked_rows(&fixture), 1);
}
