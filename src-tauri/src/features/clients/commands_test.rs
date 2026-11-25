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
use crate::features::users::repository::{insert_user, NewUserRow};

const OWNER_ROLE: i64 = 1;
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
    let writer_only = add_role(&conn, "Escritor clientes", &["clients.write"]);
    let catalog_only = add_role(&conn, "Catalogo", &["catalog.read", "catalog.write"]);
    let without_permissions = add_role(&conn, "Sin permisos", &[]);
    add_user(&conn, "propietaria", OWNER_ROLE);
    add_user(&conn, "recepcion", 2);
    add_user(&conn, "lectura", 3);
    add_user(&conn, "escritor", writer_only);
    add_user(&conn, "catalogo", catalog_only);
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

fn database(fixture: &Fixture) -> tauri::State<'_, Database> {
    fixture.app.state()
}

fn filter(query: &str, include_deleted: bool) -> ClientFilter {
    ClientFilter {
        query: query.to_string(),
        include_deleted,
    }
}

fn maria() -> ClientInput {
    ClientInput {
        first_name: "María".to_string(),
        last_name: "González".to_string(),
        national_id: "V-12345678".to_string(),
        phone: "0414-1234567".to_string(),
    }
}

fn ana() -> ClientInput {
    ClientInput {
        first_name: "Ana".to_string(),
        last_name: "Pérez".to_string(),
        national_id: "V-16789012".to_string(),
        phone: "0412-3456789".to_string(),
    }
}

fn update_of(id: i64, client: &ClientInput) -> ClientUpdate {
    ClientUpdate {
        id,
        first_name: client.first_name.clone(),
        last_name: client.last_name.clone(),
        national_id: client.national_id.clone(),
        phone: client.phone.clone(),
    }
}

fn call_list(fixture: &Fixture, filter: ClientFilter) -> Result<Vec<ClientSummary>, AppError> {
    list_clients(filter, fixture.app.state(), fixture.app.state())
}

fn call_get(fixture: &Fixture, id: i64) -> Result<ClientSummary, AppError> {
    get_client(id, fixture.app.state(), fixture.app.state())
}

fn call_create(fixture: &Fixture, input: ClientInput) -> Result<ClientSummary, AppError> {
    create_client(input, fixture.app.state(), fixture.app.state())
}

fn call_update(fixture: &Fixture, update: ClientUpdate) -> Result<ClientSummary, AppError> {
    update_client(update, fixture.app.state(), fixture.app.state())
}

fn call_set_deleted(fixture: &Fixture, id: i64, deleted: bool) -> Result<ClientSummary, AppError> {
    set_client_deleted(
        ClientDeletion { id, deleted },
        fixture.app.state(),
        fixture.app.state(),
    )
}

fn seed_client(fixture: &Fixture, input: ClientInput) -> ClientSummary {
    sign_in_as(fixture, "propietaria");
    call_create(fixture, input).unwrap()
}

fn stored_clients(fixture: &Fixture) -> Vec<ClientSummary> {
    database(fixture)
        .with_conn(|conn| repository::list_clients(conn, &filter("", true)))
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

fn write_commands(fixture: &Fixture, target: &ClientSummary) -> Outcomes {
    vec![
        ("create_client", call_create(fixture, ana()).map(|_| ())),
        (
            "update_client",
            call_update(fixture, update_of(target.id, &ana())).map(|_| ()),
        ),
        (
            "set_client_deleted",
            call_set_deleted(fixture, target.id, true).map(|_| ()),
        ),
    ]
}

fn read_commands(fixture: &Fixture, target: &ClientSummary) -> Outcomes {
    vec![
        (
            "list_clients",
            call_list(fixture, filter("", true)).map(|_| ()),
        ),
        ("get_client", call_get(fixture, target.id).map(|_| ())),
    ]
}

fn every_command(fixture: &Fixture, target: &ClientSummary) -> Outcomes {
    let mut outcomes = read_commands(fixture, target);
    outcomes.extend(write_commands(fixture, target));
    outcomes
}

fn assert_all_fail_with(outcomes: Outcomes, code: AppErrorCode) {
    for (name, outcome) in outcomes {
        assert_eq!(outcome.expect_err(name).code, code, "{name}");
    }
}

#[test]
fn every_client_command_without_session_is_unauthenticated() {
    let fixture = fixture();
    let target = seed_client(&fixture, maria());
    session_end(&fixture);

    assert_all_fail_with(
        every_command(&fixture, &target),
        AppErrorCode::Unauthenticated,
    );

    assert_eq!(stored_clients(&fixture), vec![target]);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn every_client_command_with_a_locked_session_is_session_locked() {
    let fixture = fixture();
    let target = seed_client(&fixture, maria());
    lock_session(&fixture);

    assert_all_fail_with(
        every_command(&fixture, &target),
        AppErrorCode::SessionLocked,
    );

    assert_eq!(stored_clients(&fixture), vec![target]);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn a_read_only_user_can_read_and_every_write_is_forbidden() {
    let fixture = fixture();
    let target = seed_client(&fixture, maria());
    sign_in_as(&fixture, "lectura");

    assert_all_fail_with(write_commands(&fixture, &target), AppErrorCode::Forbidden);

    assert_eq!(
        call_list(&fixture, filter("", false)).unwrap(),
        vec![target.clone()]
    );
    assert_eq!(call_get(&fixture, target.id).unwrap(), target);
    assert_eq!(stored_clients(&fixture), vec![target]);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn a_writer_without_the_read_permission_can_still_list_get_and_write() {
    let fixture = fixture();
    let target = seed_client(&fixture, maria());
    sign_in_as(&fixture, "escritor");

    let listed = call_list(&fixture, filter("", false)).unwrap();
    let fetched = call_get(&fixture, target.id).unwrap();
    let created = call_create(&fixture, ana()).unwrap();

    assert_eq!(listed, vec![target.clone()]);
    assert_eq!(fetched, target);
    assert_eq!(created.national_id, "V-16789012");
}

#[test]
fn users_without_any_client_permission_are_forbidden_everywhere() {
    for username in ["sinpermisos", "catalogo"] {
        let fixture = fixture();
        let target = seed_client(&fixture, maria());
        sign_in_as(&fixture, username);

        assert_all_fail_with(every_command(&fixture, &target), AppErrorCode::Forbidden);

        assert_eq!(stored_clients(&fixture), vec![target], "{username}");
        assert_eq!(audit_actions(&fixture), ["create"], "{username}");
    }
}

#[test]
fn the_receptionist_can_run_the_whole_lifecycle_and_it_is_audited() {
    let fixture = fixture();
    sign_in_as(&fixture, "recepcion");

    let created = call_create(&fixture, maria()).unwrap();
    let updated = call_update(&fixture, update_of(created.id, &ana())).unwrap();
    let deleted = call_set_deleted(&fixture, created.id, true).unwrap();
    let reactivated = call_set_deleted(&fixture, created.id, false).unwrap();

    assert_eq!(updated.first_name, "Ana");
    assert!(deleted.deleted_at.is_some());
    assert_eq!(reactivated.deleted_at, None);
    assert_eq!(
        audit_actions(&fixture),
        ["create", "update", "soft_delete", "reactivate"]
    );
}

#[test]
fn every_write_command_attributes_the_audit_and_the_stamp_to_the_signed_in_user() {
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

    let created = call_create(&fixture, maria()).unwrap();
    call_update(&fixture, update_of(created.id, &ana())).unwrap();
    call_set_deleted(&fixture, created.id, true).unwrap();

    let actors: Vec<Option<i64>> = database(&fixture)
        .with_conn(list_all)
        .unwrap()
        .into_iter()
        .map(|entry| entry.actor_user_id)
        .collect();
    let (created_by, updated_by): (i64, i64) = database(&fixture)
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT created_by, updated_by FROM clients WHERE id = ?1",
                [created.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?)
        })
        .unwrap();
    assert_eq!(actors, vec![Some(actor); 3]);
    assert_eq!((created_by, updated_by), (actor, actor));
}

#[test]
fn list_honours_the_query_and_the_include_deleted_filter() {
    let fixture = fixture();
    let first = seed_client(&fixture, maria());
    let second = call_create(&fixture, ana()).unwrap();
    call_set_deleted(&fixture, second.id, true).unwrap();

    let active = call_list(&fixture, filter("", false)).unwrap();
    let everyone = call_list(&fixture, filter("", true)).unwrap();
    let by_name = call_list(&fixture, filter("MARIA gonzalez", true)).unwrap();
    let deleted_hidden = call_list(&fixture, filter("perez", false)).unwrap();

    assert_eq!(active, vec![first.clone()]);
    assert_eq!(everyone.len(), 2);
    assert_eq!(by_name, vec![first]);
    assert!(deleted_hidden.is_empty());
}

#[test]
fn get_returns_a_deleted_client_and_reports_unknown_ids_as_not_found() {
    let fixture = fixture();
    let created = seed_client(&fixture, maria());
    let deleted = call_set_deleted(&fixture, created.id, true).unwrap();

    assert_eq!(call_get(&fixture, created.id).unwrap(), deleted);
    assert_eq!(call_get(&fixture, 99).unwrap_err(), AppError::not_found());
}

#[test]
fn domain_errors_reach_the_caller_with_their_code_field_and_ids() {
    let fixture = fixture();
    let first = seed_client(&fixture, maria());
    let second = call_create(&fixture, ana()).unwrap();
    call_set_deleted(&fixture, second.id, true).unwrap();

    let invalid = call_create(
        &fixture,
        ClientInput {
            phone: "abc".to_string(),
            ..ana()
        },
    )
    .unwrap_err();
    let taken = call_create(&fixture, maria()).unwrap_err();
    let reactivate = call_create(&fixture, ana()).unwrap_err();
    let update_taken = call_update(&fixture, update_of(first.id, &ana())).unwrap_err();
    let update_missing = call_update(&fixture, update_of(99, &ana())).unwrap_err();
    let delete_missing = call_set_deleted(&fixture, 99, true).unwrap_err();

    assert_eq!(invalid, AppError::validation("phone"));
    assert_eq!(taken, AppError::national_id_taken());
    assert_eq!(reactivate, AppError::client_deleted_reactivate(second.id));
    assert_eq!(reactivate.entity_ids, Some(vec![second.id]));
    assert_eq!(update_taken, AppError::national_id_taken());
    assert_eq!(update_missing, AppError::not_found());
    assert_eq!(delete_missing, AppError::not_found());
}

#[test]
fn an_edit_without_changes_through_the_command_does_not_audit() {
    let fixture = fixture();
    let created = seed_client(&fixture, maria());

    call_update(&fixture, update_of(created.id, &maria())).unwrap();
    call_set_deleted(&fixture, created.id, false).unwrap();

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
    let created = seed_client(&fixture, maria());
    let before = stored_clients(&fixture);
    break_audit(&fixture);

    let on_create = call_create(&fixture, ana()).unwrap_err();
    let on_update = call_update(&fixture, update_of(created.id, &ana())).unwrap_err();
    let on_delete = call_set_deleted(&fixture, created.id, true).unwrap_err();

    assert_eq!(on_create, AppError::internal());
    assert_eq!(on_update, AppError::internal());
    assert_eq!(on_delete, AppError::internal());
    assert_eq!(stored_clients(&fixture), before);
}

fn revoke_owner_clients_write(fixture: &Fixture) {
    database(fixture)
        .with_conn(|conn| {
            conn.execute(
                "DELETE FROM role_permissions WHERE role_id = ?1 AND permission_key = 'clients.write'",
                [OWNER_ROLE],
            )?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn losing_the_permission_between_calls_blocks_the_next_write() {
    let fixture = fixture();
    let created = seed_client(&fixture, maria());
    revoke_owner_clients_write(&fixture);

    let error = call_update(&fixture, update_of(created.id, &ana())).unwrap_err();

    assert_eq!(error, AppError::forbidden());
    assert_eq!(stored_clients(&fixture), vec![created]);
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

const TRANSACTIONAL_WRITES: [&str; 3] = ["create_client", "update_client", "set_client_deleted"];

#[test]
fn every_write_command_audits_an_idle_lock_first_seen_on_it_exactly_once() {
    for command in TRANSACTIONAL_WRITES {
        let fixture = fixture();
        let target = seed_client(&fixture, maria());
        let before = stored_clients(&fixture);
        sign_in_idle_past_timeout(&fixture, "propietaria");

        let outcome = match command {
            "create_client" => call_create(&fixture, ana()).map(|_| ()),
            "update_client" => call_update(&fixture, update_of(target.id, &ana())).map(|_| ()),
            _ => call_set_deleted(&fixture, target.id, true).map(|_| ()),
        };

        assert_eq!(
            outcome.unwrap_err().code,
            AppErrorCode::SessionLocked,
            "{command}"
        );
        assert_eq!(session_locked_rows(&fixture), 1, "{command}");
        assert_eq!(stored_clients(&fixture), before, "{command}");
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

fn run_in_transaction(
    fixture: &Fixture,
    target: &ClientSummary,
    beat: Beat,
    write: &str,
) -> Result<(), AppError> {
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    let outcome = database(fixture).with_tx(|tx| match write {
        "create_client" => create_client_in_transaction(tx, &session, beat, &ana()).map(|_| ()),
        "update_client" => {
            update_client_in_transaction(tx, &session, beat, &update_of(target.id, &ana()))
                .map(|_| ())
        }
        _ => {
            let deletion = ClientDeletion {
                id: target.id,
                deleted: true,
            };
            set_client_deleted_in_transaction(tx, &session, beat, &deletion).map(|_| ())
        }
    });
    outcome.map_err(AppError::from)
}

#[test]
fn every_transactional_write_revalidates_the_permission_inside_the_transaction() {
    for write in TRANSACTIONAL_WRITES {
        let fixture = fixture();
        let target = seed_client(&fixture, maria());
        let stored_before = stored_clients(&fixture);
        let audit_before = audit_actions(&fixture);
        revoke_owner_clients_write(&fixture);

        let outcome = run_in_transaction(&fixture, &target, Beat::now(), write);

        assert_eq!(outcome.unwrap_err(), AppError::forbidden(), "{write}");
        assert_eq!(stored_clients(&fixture), stored_before, "{write}");
        assert_eq!(audit_actions(&fixture), audit_before, "{write}");
    }
}

#[test]
fn every_transactional_write_revalidates_the_idle_lock_and_keeps_its_audit_for_the_next_attempt() {
    for write in TRANSACTIONAL_WRITES {
        let fixture = fixture();
        let target = seed_client(&fixture, maria());
        let stored_before = stored_clients(&fixture);
        let audit_before = audit_actions(&fixture);

        let outcome = run_in_transaction(&fixture, &target, past_idle_beat(), write);

        assert_eq!(
            outcome.unwrap_err().code,
            AppErrorCode::SessionLocked,
            "{write}"
        );
        assert_eq!(stored_clients(&fixture), stored_before, "{write}");
        assert_eq!(audit_actions(&fixture), audit_before, "{write}");
        let next = call_create(&fixture, ana());
        assert_eq!(
            next.unwrap_err().code,
            AppErrorCode::SessionLocked,
            "{write}"
        );
        assert_eq!(session_locked_rows(&fixture), 1, "{write}");
    }
}
