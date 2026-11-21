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
use crate::features::catalog::repository;
use crate::features::users::repository::{insert_user, NewUserRow};

const OWNER_ROLE: i64 = 1;
const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";
const ONLY_ACTIVE: ServiceFilter = ServiceFilter {
    include_inactive: false,
};
const INCLUDING_INACTIVE: ServiceFilter = ServiceFilter {
    include_inactive: true,
};

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
    let writer_only = add_role(&conn, "Solo escritura", &["catalog.write"]);
    let without_permissions = add_role(&conn, "Sin permisos", &[]);
    let appointments_only = add_role(&conn, "Solo citas", &["appointments.read"]);
    add_user(&conn, "propietaria", OWNER_ROLE);
    add_user(&conn, "recepcion", 2);
    add_user(&conn, "lectura", 3);
    add_user(&conn, "escritora", writer_only);
    add_user(&conn, "sinpermisos", without_permissions);
    add_user(&conn, "citas", appointments_only);
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

fn call_list(fixture: &Fixture, filter: ServiceFilter) -> Result<Vec<ServiceSummary>, AppError> {
    list_services(filter, fixture.app.state(), fixture.app.state())
}

fn call_create(fixture: &Fixture, name: &str) -> Result<ServiceSummary, AppError> {
    create_service(
        ServiceInput {
            name: name.to_string(),
            price_cents: 3500,
            duration_min: 60,
        },
        fixture.app.state(),
        fixture.app.state(),
    )
}

fn call_update(fixture: &Fixture, update: ServiceUpdate) -> Result<ServiceSummary, AppError> {
    update_service(update, fixture.app.state(), fixture.app.state())
}

fn call_set_active(fixture: &Fixture, id: i64, active: bool) -> Result<ServiceSummary, AppError> {
    set_service_active(
        ServiceActivation { id, active },
        fixture.app.state(),
        fixture.app.state(),
    )
}

fn update_to(service: &ServiceSummary, price_cents: i64) -> ServiceUpdate {
    ServiceUpdate {
        id: service.id,
        name: service.name.clone(),
        price_cents,
        duration_min: service.duration_min,
    }
}

fn seed_service(fixture: &Fixture, name: &str) -> ServiceSummary {
    sign_in_as(fixture, "propietaria");
    call_create(fixture, name).unwrap()
}

fn database(fixture: &Fixture) -> tauri::State<'_, Database> {
    fixture.app.state()
}

fn stored_services(fixture: &Fixture) -> Vec<ServiceSummary> {
    database(fixture)
        .with_conn(|conn| repository::list_services(conn, INCLUDING_INACTIVE))
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

fn write_commands(fixture: &Fixture, target: i64) -> Vec<(&'static str, Result<(), AppError>)> {
    vec![
        ("create_service", call_create(fixture, "Nuevo").map(|_| ())),
        (
            "update_service",
            call_update(
                fixture,
                ServiceUpdate {
                    id: target,
                    name: "Editado".into(),
                    price_cents: 100,
                    duration_min: 30,
                },
            )
            .map(|_| ()),
        ),
        (
            "set_service_active",
            call_set_active(fixture, target, false).map(|_| ()),
        ),
    ]
}

fn every_command(fixture: &Fixture, target: i64) -> Vec<(&'static str, Result<(), AppError>)> {
    let mut outcomes = vec![(
        "list_services",
        call_list(fixture, INCLUDING_INACTIVE).map(|_| ()),
    )];
    outcomes.extend(write_commands(fixture, target));
    outcomes
}

fn assert_all_fail_with(outcomes: Vec<(&'static str, Result<(), AppError>)>, code: AppErrorCode) {
    for (name, outcome) in outcomes {
        assert_eq!(outcome.expect_err(name).code, code, "{name}");
    }
}

#[test]
fn list_services_requires_a_session() {
    let fixture = fixture();

    let error = call_list(&fixture, ONLY_ACTIVE).unwrap_err();

    assert_eq!(error, AppError::unauthenticated());
}

#[test]
fn every_catalog_command_without_session_is_unauthenticated() {
    let fixture = fixture();
    let target = seed_service(&fixture, "Masaje").id;
    session_end(&fixture);

    assert_all_fail_with(
        every_command(&fixture, target),
        AppErrorCode::Unauthenticated,
    );

    assert_eq!(stored_services(&fixture).len(), 1);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

fn session_end(fixture: &Fixture) {
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    session.end().unwrap();
}

#[test]
fn every_catalog_command_with_a_locked_session_is_session_locked() {
    let fixture = fixture();
    let target = seed_service(&fixture, "Masaje").id;
    lock_session(&fixture);

    assert_all_fail_with(every_command(&fixture, target), AppErrorCode::SessionLocked);

    assert_eq!(stored_services(&fixture).len(), 1);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn users_with_catalog_read_but_not_write_can_list_and_cannot_write() {
    for username in ["recepcion", "lectura"] {
        let fixture = fixture();
        let target = seed_service(&fixture, "Masaje").id;
        sign_in_as(&fixture, username);

        let listed = call_list(&fixture, ONLY_ACTIVE).unwrap();
        let writes = write_commands(&fixture, target);

        assert_eq!(listed.len(), 1, "{username}");
        assert_all_fail_with(writes, AppErrorCode::Forbidden);
        assert_eq!(stored_services(&fixture), listed, "{username}");
        assert_eq!(audit_actions(&fixture), ["create"], "{username}");
    }
}

#[test]
fn a_user_with_catalog_write_but_not_read_can_list_and_write() {
    let fixture = fixture();
    seed_service(&fixture, "Masaje");
    sign_in_as(&fixture, "escritora");

    let listed = call_list(&fixture, ONLY_ACTIVE).unwrap();
    let created = call_create(&fixture, "Facial").unwrap();
    let updated = call_update(&fixture, update_to(&created, 999)).unwrap();
    let retired = call_set_active(&fixture, created.id, false).unwrap();

    assert_eq!(listed.len(), 1);
    assert_eq!(updated.price_cents, 999);
    assert!(!retired.active);
}

#[test]
fn users_without_any_catalog_permission_are_forbidden_everywhere() {
    for username in ["sinpermisos", "citas"] {
        let fixture = fixture();
        let target = seed_service(&fixture, "Masaje").id;
        sign_in_as(&fixture, username);

        assert_all_fail_with(every_command(&fixture, target), AppErrorCode::Forbidden);

        assert_eq!(stored_services(&fixture).len(), 1, "{username}");
        assert_eq!(audit_actions(&fixture), ["create"], "{username}");
    }
}

#[test]
fn create_service_through_the_command_persists_and_audits() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");

    let created = call_create(&fixture, "  Masaje  ").unwrap();

    assert_eq!(created.name, "Masaje");
    assert_eq!(stored_services(&fixture), vec![created]);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn list_services_honours_the_include_inactive_filter() {
    let fixture = fixture();
    let retired = seed_service(&fixture, "Masaje");
    call_create(&fixture, "Facial").unwrap();
    call_set_active(&fixture, retired.id, false).unwrap();

    let active: Vec<String> = call_list(&fixture, ONLY_ACTIVE)
        .unwrap()
        .into_iter()
        .map(|service| service.name)
        .collect();
    let all: Vec<String> = call_list(&fixture, INCLUDING_INACTIVE)
        .unwrap()
        .into_iter()
        .map(|service| service.name)
        .collect();

    assert_eq!(active, ["Facial"]);
    assert_eq!(all, ["Facial", "Masaje"]);
}

#[test]
fn update_and_deactivate_through_the_commands_are_audited() {
    let fixture = fixture();
    let created = seed_service(&fixture, "Masaje");

    call_update(&fixture, update_to(&created, 4200)).unwrap();
    call_set_active(&fixture, created.id, false).unwrap();
    call_set_active(&fixture, created.id, true).unwrap();

    assert_eq!(
        audit_actions(&fixture),
        ["create", "update", "deactivate", "reactivate"]
    );
}

#[test]
fn domain_validation_errors_reach_the_caller_with_their_field() {
    let fixture = fixture();
    let created = seed_service(&fixture, "Masaje");

    let duplicate = call_create(&fixture, "MASAJE").unwrap_err();
    let free_price = call_update(&fixture, update_to(&created, 0)).unwrap_err();
    let unknown = call_set_active(&fixture, 999, false).unwrap_err();

    assert_eq!(duplicate, AppError::validation("name"));
    assert_eq!(free_price, AppError::validation("priceCents"));
    assert_eq!(unknown, AppError::validation("id"));
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
    let created = seed_service(&fixture, "Masaje");
    break_audit(&fixture);

    let on_create = call_create(&fixture, "Facial").unwrap_err();
    let on_update = call_update(&fixture, update_to(&created, 9900)).unwrap_err();
    let on_deactivate = call_set_active(&fixture, created.id, false).unwrap_err();

    assert_eq!(on_create, AppError::internal());
    assert_eq!(on_update, AppError::internal());
    assert_eq!(on_deactivate, AppError::internal());
    assert_eq!(stored_services(&fixture), vec![created]);
}

#[test]
fn losing_the_permission_between_calls_blocks_the_next_write() {
    let fixture = fixture();
    let created = seed_service(&fixture, "Masaje");
    database(&fixture)
        .with_conn(|conn| {
            conn.execute(
                "DELETE FROM role_permissions WHERE role_id = ?1 AND permission_key = 'catalog.write'",
                [OWNER_ROLE],
            )?;
            Ok(())
        })
        .unwrap();

    let error = call_update(&fixture, update_to(&created, 1)).unwrap_err();

    assert_eq!(error, AppError::forbidden());
    assert_eq!(stored_services(&fixture), vec![created]);
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
    for command in ["create_service", "update_service", "set_service_active"] {
        let fixture = fixture();
        let target = seed_service(&fixture, "Masaje");
        sign_in_idle_past_timeout(&fixture, "propietaria");

        let outcome = match command {
            "create_service" => call_create(&fixture, "Nuevo").map(|_| ()),
            "update_service" => call_update(&fixture, update_to(&target, 1)).map(|_| ()),
            _ => call_set_active(&fixture, target.id, false).map(|_| ()),
        };

        assert_eq!(
            outcome.unwrap_err().code,
            AppErrorCode::SessionLocked,
            "{command}"
        );
        assert_eq!(session_locked_rows(&fixture), 1, "{command}");
        assert_eq!(stored_services(&fixture), vec![target], "{command}");
    }
}

fn services_row_count(fixture: &Fixture) -> i64 {
    database(fixture)
        .with_conn(
            |conn| Ok(conn.query_row("SELECT COUNT(*) FROM services", [], |row| row.get(0))?),
        )
        .unwrap()
}

#[test]
fn no_catalog_command_ever_reduces_the_number_of_services() {
    let fixture = fixture();
    let first = seed_service(&fixture, "Masaje");
    let second = call_create(&fixture, "Facial").unwrap();
    let mut counts = vec![services_row_count(&fixture)];

    for service in [&first, &second] {
        call_set_active(&fixture, service.id, false).unwrap();
        counts.push(services_row_count(&fixture));
        call_update(&fixture, update_to(service, 1)).unwrap();
        counts.push(services_row_count(&fixture));
        call_set_active(&fixture, service.id, true).unwrap();
        counts.push(services_row_count(&fixture));
    }
    call_list(&fixture, INCLUDING_INACTIVE).unwrap();
    counts.push(services_row_count(&fixture));
    let _ = call_set_active(&fixture, 9999, false);
    let _ = call_create(&fixture, "masaje");
    counts.push(services_row_count(&fixture));

    assert!(
        counts.windows(2).all(|pair| pair[0] <= pair[1]),
        "{counts:?}"
    );
    assert_eq!(*counts.last().unwrap(), 2);
}

const TRANSACTIONAL_WRITES: [&str; 3] = ["create_service", "update_service", "set_service_active"];

fn past_idle_beat() -> Beat {
    let now = Beat::now();
    let by = IDLE_TIMEOUT + Duration::from_secs(1);
    Beat {
        mono: now.mono + by,
        wall: now.wall + by,
    }
}

fn run_in_transaction(
    fixture: &Fixture,
    target: &ServiceSummary,
    beat: Beat,
    write: &str,
) -> Result<(), AppError> {
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    let outcome = database(fixture).with_tx(|tx| match write {
        "create_service" => {
            let input = ServiceInput {
                name: "Nuevo".to_string(),
                price_cents: 3500,
                duration_min: 60,
            };
            create_service_in_transaction(tx, &session, beat, &input).map(|_| ())
        }
        "update_service" => {
            update_service_in_transaction(tx, &session, beat, &update_to(target, 9900)).map(|_| ())
        }
        _ => {
            let activation = ServiceActivation {
                id: target.id,
                active: false,
            };
            set_service_active_in_transaction(tx, &session, beat, &activation).map(|_| ())
        }
    });
    outcome.map_err(AppError::from)
}

#[test]
fn every_transactional_write_revalidates_the_permission_inside_the_transaction() {
    for write in TRANSACTIONAL_WRITES {
        let fixture = fixture();
        let target = seed_service(&fixture, "Masaje");
        let stored_before = stored_services(&fixture);
        let audit_before = audit_actions(&fixture);
        database(&fixture)
            .with_conn(|conn| {
                conn.execute(
                    "DELETE FROM role_permissions WHERE role_id = ?1 AND permission_key = 'catalog.write'",
                    [OWNER_ROLE],
                )?;
                Ok(())
            })
            .unwrap();

        let outcome = run_in_transaction(&fixture, &target, Beat::now(), write);

        assert_eq!(outcome.unwrap_err(), AppError::forbidden(), "{write}");
        assert_eq!(stored_services(&fixture), stored_before, "{write}");
        assert_eq!(audit_actions(&fixture), audit_before, "{write}");
    }
}

#[test]
fn every_transactional_write_revalidates_the_idle_lock_and_keeps_its_audit_for_the_next_attempt() {
    for write in TRANSACTIONAL_WRITES {
        let fixture = fixture();
        let target = seed_service(&fixture, "Masaje");
        let stored_before = stored_services(&fixture);
        let audit_before = audit_actions(&fixture);

        let outcome = run_in_transaction(&fixture, &target, past_idle_beat(), write);

        assert_eq!(
            outcome.unwrap_err().code,
            AppErrorCode::SessionLocked,
            "{write}"
        );
        assert_eq!(stored_services(&fixture), stored_before, "{write}");
        assert_eq!(audit_actions(&fixture), audit_before, "{write}");
        let next = call_create(&fixture, "Despues");
        assert_eq!(
            next.unwrap_err().code,
            AppErrorCode::SessionLocked,
            "{write}"
        );
        assert_eq!(session_locked_rows(&fixture), 1, "{write}");
    }
}
