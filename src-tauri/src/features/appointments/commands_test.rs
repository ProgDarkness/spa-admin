use std::time::Duration;

use tauri::test::{mock_app, MockRuntime};
use tauri::{App, Manager};

use super::*;
use crate::db::{migrate, Database};
use crate::errors::{AppError, AppErrorCode};
use crate::features::appointments::model::{AppointmentStatus, AppointmentTransition};
use crate::features::appointments::repository;
use crate::features::audit::repository::list_all;
use crate::features::auth::model::SessionUser;
use crate::features::auth::repository::permissions_of_role_for_user;
use crate::features::auth::service::{Beat, LockReason, SessionState, IDLE_TIMEOUT};
use crate::features::users::repository::{insert_user, NewUserRow};

const OWNER_ROLE: i64 = 1;
const RECEPTION_ROLE: i64 = 2;
const SLOT: &str = "2026-11-12T10:00";
const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";

pub(super) struct Fixture {
    pub(super) app: App<MockRuntime>,
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

pub(super) fn fixture() -> Fixture {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    let writer_only = add_role(&conn, "Escritor citas", &["appointments.write"]);
    let without_permissions = add_role(&conn, "Sin permisos", &[]);
    let resources_only = add_role(&conn, "Recursos", &["resources.manage"]);
    add_user(&conn, "propietaria", OWNER_ROLE);
    add_user(&conn, "recepcion", RECEPTION_ROLE);
    add_user(&conn, "lectura", 3);
    add_user(&conn, "escritor", writer_only);
    add_user(&conn, "sinpermisos", without_permissions);
    add_user(&conn, "recursos", resources_only);
    conn.execute_batch(
        "INSERT INTO clients (id, first_name, last_name, national_id, phone, search_key) VALUES
            (1, 'Ana', 'Perez', 'V-12345678', '0414', 'k');
         INSERT INTO services (id, name, name_key, price_cents, duration_min) VALUES
            (1, 'Facial', 'facial', 3500, 60);",
    )
    .unwrap();
    let app = mock_app();
    app.manage(Database::new(conn));
    app.manage(SessionState::default());
    Fixture { app }
}

pub(super) fn sign_in_as(fixture: &Fixture, username: &str) {
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

fn database(fixture: &Fixture) -> tauri::State<'_, Database> {
    fixture.app.state()
}

fn lock_session(fixture: &Fixture) {
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    session.force_lock().unwrap();
}

fn session_end(fixture: &Fixture) {
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    session.end().unwrap();
}

fn booking(resource_id: i64, starts_at: &str) -> AppointmentInput {
    AppointmentInput {
        client_id: 1,
        service_id: 1,
        resource_id,
        starts_at: starts_at.to_string(),
        notes: None,
    }
}

fn day(day: &str, resource_id: Option<i64>) -> AppointmentRange {
    AppointmentRange {
        from: day.to_string(),
        to: day.to_string(),
        resource_id,
    }
}

fn call_list(
    fixture: &Fixture,
    range: AppointmentRange,
) -> Result<Vec<AppointmentSummary>, AppError> {
    list_appointments(range, fixture.app.state(), fixture.app.state())
}

fn call_create(fixture: &Fixture, input: AppointmentInput) -> Result<AppointmentSummary, AppError> {
    create_appointment(input, fixture.app.state(), fixture.app.state())
}

fn call_move(fixture: &Fixture, id: i64, starts_at: &str) -> Result<AppointmentSummary, AppError> {
    move_appointment(
        AppointmentMove {
            id,
            starts_at: starts_at.to_string(),
            resource_id: 1,
        },
        fixture.app.state(),
        fixture.app.state(),
    )
}

fn call_transition(
    fixture: &Fixture,
    id: i64,
    transition: AppointmentTransition,
) -> Result<AppointmentSummary, AppError> {
    transition_appointment(
        AppointmentTransitionRequest { id, transition },
        fixture.app.state(),
        fixture.app.state(),
    )
}

fn seed_appointment(fixture: &Fixture) -> AppointmentSummary {
    sign_in_as(fixture, "propietaria");
    call_create(fixture, booking(1, SLOT)).unwrap()
}

fn stored(fixture: &Fixture) -> Vec<AppointmentSummary> {
    database(fixture)
        .with_conn(|conn| repository::list_appointments(conn, &day("2026-11-12", None)))
        .unwrap()
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

fn write_commands(fixture: &Fixture, target: &AppointmentSummary) -> Outcomes {
    vec![
        (
            "create_appointment",
            call_create(fixture, booking(2, "2026-11-12T15:00")).map(|_| ()),
        ),
        (
            "move_appointment",
            call_move(fixture, target.id, "2026-11-12T16:00").map(|_| ()),
        ),
        (
            "transition_appointment",
            call_transition(fixture, target.id, AppointmentTransition::Cancel).map(|_| ()),
        ),
    ]
}

fn every_command(fixture: &Fixture, target: &AppointmentSummary) -> Outcomes {
    let mut outcomes: Outcomes = vec![(
        "list_appointments",
        call_list(fixture, day("2026-11-12", None)).map(|_| ()),
    )];
    outcomes.extend(write_commands(fixture, target));
    outcomes
}

fn assert_all_fail_with(outcomes: Outcomes, code: AppErrorCode) {
    for (name, outcome) in outcomes {
        assert_eq!(outcome.expect_err(name).code, code, "{name}");
    }
}

#[test]
fn every_appointment_command_without_session_is_unauthenticated() {
    let fixture = fixture();
    let target = seed_appointment(&fixture);
    session_end(&fixture);

    assert_all_fail_with(
        every_command(&fixture, &target),
        AppErrorCode::Unauthenticated,
    );

    assert_eq!(stored(&fixture), vec![target]);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn every_appointment_command_with_a_locked_session_is_session_locked() {
    let fixture = fixture();
    let target = seed_appointment(&fixture);
    lock_session(&fixture);

    assert_all_fail_with(
        every_command(&fixture, &target),
        AppErrorCode::SessionLocked,
    );

    assert_eq!(stored(&fixture), vec![target]);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn a_read_only_user_can_list_and_every_write_is_forbidden() {
    let fixture = fixture();
    let target = seed_appointment(&fixture);
    sign_in_as(&fixture, "lectura");

    assert_all_fail_with(write_commands(&fixture, &target), AppErrorCode::Forbidden);

    assert_eq!(
        call_list(&fixture, day("2026-11-12", None)).unwrap(),
        vec![target.clone()]
    );
    assert_eq!(stored(&fixture), vec![target]);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn a_writer_without_the_read_permission_can_still_list_and_write() {
    let fixture = fixture();
    let target = seed_appointment(&fixture);
    sign_in_as(&fixture, "escritor");

    let listed = call_list(&fixture, day("2026-11-12", None)).unwrap();
    let created = call_create(&fixture, booking(2, "2026-11-12T15:00")).unwrap();

    assert_eq!(listed, vec![target]);
    assert_eq!(created.resource_id, 2);
}

#[test]
fn users_without_any_appointment_permission_are_forbidden_everywhere() {
    for username in ["sinpermisos", "recursos"] {
        let fixture = fixture();
        let target = seed_appointment(&fixture);
        sign_in_as(&fixture, username);

        assert_all_fail_with(every_command(&fixture, &target), AppErrorCode::Forbidden);

        assert_eq!(stored(&fixture), vec![target], "{username}");
        assert_eq!(audit_actions(&fixture), ["create"], "{username}");
    }
}

#[test]
fn the_receptionist_runs_the_lifecycle_but_cannot_reopen() {
    let fixture = fixture();
    sign_in_as(&fixture, "recepcion");
    let created = call_create(&fixture, booking(1, "2020-01-02T08:00")).unwrap();

    call_move(&fixture, created.id, "2020-01-02T09:00").unwrap();
    call_transition(&fixture, created.id, AppointmentTransition::Complete).unwrap();
    let reopen = call_transition(&fixture, created.id, AppointmentTransition::Reopen);

    assert_eq!(reopen.unwrap_err(), AppError::forbidden());
    assert_eq!(
        stored_status(&fixture, created.id),
        AppointmentStatus::Completed
    );
    assert_eq!(audit_actions(&fixture), ["create", "update", "update"]);
}

fn stored_status(fixture: &Fixture, id: i64) -> AppointmentStatus {
    database(fixture)
        .with_conn(|conn| repository::find_appointment(conn, id))
        .unwrap()
        .unwrap()
        .status
}

#[test]
fn the_owner_can_reopen_a_completed_appointment() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");
    let created = call_create(&fixture, booking(1, "2020-01-02T08:00")).unwrap();
    call_transition(&fixture, created.id, AppointmentTransition::Complete).unwrap();

    let reopened = call_transition(&fixture, created.id, AppointmentTransition::Reopen).unwrap();

    assert_eq!(reopened.status, AppointmentStatus::Scheduled);
    assert_eq!(audit_actions(&fixture), ["create", "update", "update"]);
}

#[test]
fn a_forbidden_reopen_is_decided_before_looking_the_appointment_up() {
    let fixture = fixture();
    sign_in_as(&fixture, "recepcion");

    let error = call_transition(&fixture, 99, AppointmentTransition::Reopen).unwrap_err();

    assert_eq!(error, AppError::forbidden());
}

#[test]
fn every_write_attributes_the_audit_and_the_stamp_to_the_signed_in_user() {
    let fixture = fixture();
    sign_in_as(&fixture, "recepcion");
    let actor: i64 = database(&fixture)
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT id FROM users WHERE username = 'recepcion'",
                [],
                |row| row.get(0),
            )?)
        })
        .unwrap();

    let created = call_create(&fixture, booking(1, SLOT)).unwrap();
    call_move(&fixture, created.id, "2026-11-12T12:00").unwrap();
    call_transition(&fixture, created.id, AppointmentTransition::Cancel).unwrap();

    let actors: Vec<Option<i64>> = database(&fixture)
        .with_conn(list_all)
        .unwrap()
        .into_iter()
        .map(|entry| entry.actor_user_id)
        .collect();
    let (created_by, updated_by): (i64, i64) = database(&fixture)
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT created_by, updated_by FROM appointments WHERE id = ?1",
                [created.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?)
        })
        .unwrap();
    assert_eq!(actors, vec![Some(actor); 3]);
    assert_eq!((created_by, updated_by), (actor, actor));
}

#[test]
fn list_honours_the_range_and_the_resource_filter() {
    let fixture = fixture();
    let first = seed_appointment(&fixture);
    call_create(&fixture, booking(2, SLOT)).unwrap();
    call_create(&fixture, booking(1, "2026-11-13T10:00")).unwrap();

    let only_first_resource = call_list(&fixture, day("2026-11-12", Some(1))).unwrap();
    let both_days = call_list(
        &fixture,
        AppointmentRange {
            from: "2026-11-12".into(),
            to: "2026-11-13".into(),
            resource_id: None,
        },
    )
    .unwrap();

    assert_eq!(only_first_resource, vec![first]);
    assert_eq!(both_days.len(), 3);
}

#[test]
fn an_invalid_range_reaches_the_caller_as_a_validation_error() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");

    let inverted = call_list(
        &fixture,
        AppointmentRange {
            from: "2026-11-13".into(),
            to: "2026-11-12".into(),
            resource_id: None,
        },
    );

    assert_eq!(inverted.unwrap_err(), AppError::validation("to"));
}

#[test]
fn domain_errors_reach_the_caller_with_their_code_field_and_ids() {
    let fixture = fixture();
    let first = seed_appointment(&fixture);
    let other = call_create(&fixture, booking(1, "2026-11-12T14:00")).unwrap();

    let overlap = call_create(&fixture, booking(1, "2026-11-12T10:30")).unwrap_err();
    let midnight = call_create(&fixture, booking(1, "2026-11-12T23:30")).unwrap_err();
    let inactive = call_create(&fixture, booking(3, SLOT)).unwrap_err();
    let missing_client = call_create(
        &fixture,
        AppointmentInput {
            client_id: 99,
            ..booking(1, SLOT)
        },
    )
    .unwrap_err();
    let invalid_start = call_create(&fixture, booking(1, "ayer")).unwrap_err();
    let not_found = call_move(&fixture, 99, SLOT).unwrap_err();
    let cancel = call_transition(&fixture, first.id, AppointmentTransition::Cancel).unwrap();
    let invalid_move = call_move(&fixture, cancel.id, "2026-11-13T10:00").unwrap_err();
    let moved_onto_other = call_move(&fixture, other.id, "2026-11-12T10:30");

    assert_eq!(overlap, AppError::overlap(vec![first.id]));
    assert_eq!(midnight, AppError::crosses_midnight());
    assert_eq!(inactive, AppError::resource_inactive());
    assert_eq!(missing_client, AppError::missing_reference("clientId"));
    assert_eq!(invalid_start, AppError::validation("startsAt"));
    assert_eq!(not_found, AppError::appointment_not_found());
    assert_eq!(invalid_move, AppError::invalid_transition());
    assert!(moved_onto_other.is_ok());
}

#[test]
fn a_move_without_changes_through_the_command_does_not_audit() {
    let fixture = fixture();
    let created = seed_appointment(&fixture);

    call_move(&fixture, created.id, SLOT).unwrap();

    assert_eq!(audit_actions(&fixture), ["create"]);
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
fn a_failing_audit_rolls_back_every_write_command_and_reports_internal() {
    let fixture = fixture();
    let created = seed_appointment(&fixture);
    let before = stored(&fixture);
    break_audit(&fixture);

    let on_create = call_create(&fixture, booking(2, "2026-11-12T15:00")).unwrap_err();
    let on_move = call_move(&fixture, created.id, "2026-11-12T16:00").unwrap_err();
    let on_transition =
        call_transition(&fixture, created.id, AppointmentTransition::Cancel).unwrap_err();

    assert_eq!(on_create, AppError::internal());
    assert_eq!(on_move, AppError::internal());
    assert_eq!(on_transition, AppError::internal());
    assert_eq!(stored(&fixture), before);
}

fn revoke_owner(fixture: &Fixture, permission: &str) {
    database(fixture)
        .with_conn(|conn| {
            conn.execute(
                "DELETE FROM role_permissions WHERE role_id = ?1 AND permission_key = ?2",
                rusqlite::params![OWNER_ROLE, permission],
            )?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn losing_the_write_permission_between_calls_blocks_the_next_write() {
    let fixture = fixture();
    let created = seed_appointment(&fixture);
    revoke_owner(&fixture, "appointments.write");

    let error = call_move(&fixture, created.id, "2026-11-12T16:00").unwrap_err();

    assert_eq!(error, AppError::forbidden());
    assert_eq!(stored(&fixture), vec![created]);
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
fn every_write_command_audits_an_idle_lock_first_seen_on_it_exactly_once() {
    for command in [
        "create_appointment",
        "move_appointment",
        "transition_appointment",
    ] {
        let fixture = fixture();
        let target = seed_appointment(&fixture);
        let before = stored(&fixture);
        sign_in_idle_past_timeout(&fixture, "propietaria");

        let outcome = write_commands(&fixture, &target)
            .into_iter()
            .find(|(name, _)| *name == command)
            .map(|(_, outcome)| outcome);

        assert_eq!(
            outcome.unwrap().unwrap_err().code,
            AppErrorCode::SessionLocked,
            "{command}"
        );
        assert_eq!(session_locked_rows(&fixture), 1, "{command}");
        assert_eq!(stored(&fixture), before, "{command}");
    }
}

fn past_idle_beat() -> Beat {
    let now = Beat::now();
    let by = IDLE_TIMEOUT + Duration::from_secs(1);
    Beat {
        mono: now.mono + by,
        wall: now.wall + by,
    }
}

const TRANSACTIONAL_WRITES: [&str; 4] = ["create", "move", "transition", "reopen"];

fn run_in_transaction(
    fixture: &Fixture,
    target: &AppointmentSummary,
    beat: Beat,
    write: &str,
) -> Result<(), AppError> {
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    let outcome = database(fixture).with_tx(|tx| match write {
        "create" => {
            create_appointment_in_transaction(tx, &session, beat, &booking(2, SLOT)).map(|_| ())
        }
        "move" => move_appointment_in_transaction(
            tx,
            &session,
            beat,
            &AppointmentMove {
                id: target.id,
                starts_at: "2026-11-12T16:00".to_string(),
                resource_id: 1,
            },
        )
        .map(|_| ()),
        other => {
            let transition = if other == "reopen" {
                AppointmentTransition::Reopen
            } else {
                AppointmentTransition::Cancel
            };
            let request = AppointmentTransitionRequest {
                id: target.id,
                transition,
            };
            transition_appointment_in_transaction(tx, &session, beat, &request).map(|_| ())
        }
    });
    outcome.map_err(AppError::from)
}

#[test]
fn every_transactional_write_revalidates_the_permission_inside_the_transaction() {
    for write in TRANSACTIONAL_WRITES {
        let fixture = fixture();
        let target = seed_appointment(&fixture);
        database(&fixture)
            .with_tx(|tx| -> Result<(), crate::db::DbError> {
                tx.execute("UPDATE appointments SET status = 'completed'", [])?;
                Ok(())
            })
            .unwrap();
        let stored_before = stored(&fixture);
        let audit_before = audit_actions(&fixture);
        revoke_owner(
            &fixture,
            if write == "reopen" {
                "appointments.reopen"
            } else {
                "appointments.write"
            },
        );

        let outcome = run_in_transaction(&fixture, &target, Beat::now(), write);

        assert_eq!(outcome.unwrap_err(), AppError::forbidden(), "{write}");
        assert_eq!(stored(&fixture), stored_before, "{write}");
        assert_eq!(audit_actions(&fixture), audit_before, "{write}");
    }
}

#[test]
fn every_transactional_write_revalidates_the_idle_lock_inside_the_transaction() {
    for write in TRANSACTIONAL_WRITES {
        let fixture = fixture();
        let target = seed_appointment(&fixture);
        let stored_before = stored(&fixture);
        let audit_before = audit_actions(&fixture);

        let outcome = run_in_transaction(&fixture, &target, past_idle_beat(), write);

        assert_eq!(
            outcome.unwrap_err().code,
            AppErrorCode::SessionLocked,
            "{write}"
        );
        assert_eq!(stored(&fixture), stored_before, "{write}");
        assert_eq!(audit_actions(&fixture), audit_before, "{write}");
    }
}

#[test]
fn reopen_is_rechecked_inside_the_transaction_after_the_outside_check_passed() {
    let fixture = fixture();
    let target = seed_appointment(&fixture);
    database(&fixture)
        .with_tx(|tx| -> Result<(), crate::db::DbError> {
            tx.execute("UPDATE appointments SET status = 'cancelled'", [])?;
            Ok(())
        })
        .unwrap();
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    authorize_outside_transaction(
        &database(&fixture),
        &session,
        Some(AppointmentTransition::Reopen),
    )
    .unwrap();
    revoke_owner(&fixture, "appointments.reopen");

    let outcome = run_in_transaction(&fixture, &target, Beat::now(), "reopen");

    assert_eq!(outcome.unwrap_err(), AppError::forbidden());
    assert_eq!(
        stored_status(&fixture, target.id),
        AppointmentStatus::Cancelled
    );
}
