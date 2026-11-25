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
use crate::features::resources::model::ResourceKind;
use crate::features::resources::repository;
use crate::features::users::repository::{insert_user, NewUserRow};

const OWNER_ROLE: i64 = 1;
const SEEDED_RESOURCES: i64 = 3;
const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";
const ONLY_ACTIVE: ResourceFilter = ResourceFilter {
    include_inactive: false,
};
const INCLUDING_INACTIVE: ResourceFilter = ResourceFilter {
    include_inactive: true,
};

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
    let manager_only = add_role(&conn, "Solo recursos", &["resources.manage"]);
    let without_permissions = add_role(&conn, "Sin permisos", &[]);
    let catalog_only = add_role(&conn, "Solo catalogo", &["catalog.read", "catalog.write"]);
    add_user(&conn, "propietaria", OWNER_ROLE);
    add_user(&conn, "recepcion", 2);
    add_user(&conn, "lectura", 3);
    add_user(&conn, "gestora", manager_only);
    add_user(&conn, "sinpermisos", without_permissions);
    add_user(&conn, "catalogo", catalog_only);
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

pub(super) fn lock_session(fixture: &Fixture) {
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    session.force_lock().unwrap();
}

pub(super) fn session_end(fixture: &Fixture) {
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    session.end().unwrap();
}

fn call_list(fixture: &Fixture, filter: ResourceFilter) -> Result<Vec<ResourceSummary>, AppError> {
    list_resources(filter, fixture.app.state(), fixture.app.state())
}

fn call_create(fixture: &Fixture, name: &str) -> Result<ResourceSummary, AppError> {
    create_resource(
        ResourceInput {
            name: name.to_string(),
            kind: ResourceKind::Cabin,
        },
        fixture.app.state(),
        fixture.app.state(),
    )
}

fn call_update(fixture: &Fixture, update: ResourceUpdate) -> Result<ResourceSummary, AppError> {
    update_resource(update, fixture.app.state(), fixture.app.state())
}

pub(super) fn call_set_active(
    fixture: &Fixture,
    id: i64,
    active: bool,
) -> Result<ResourceSummary, AppError> {
    set_resource_active(
        ResourceActivation { id, active },
        fixture.app.state(),
        fixture.app.state(),
    )
}

fn rename_to(resource: &ResourceSummary, name: &str) -> ResourceUpdate {
    ResourceUpdate {
        id: resource.id,
        name: name.to_string(),
        kind: resource.kind,
    }
}

fn seed_resource(fixture: &Fixture, name: &str) -> ResourceSummary {
    sign_in_as(fixture, "propietaria");
    call_create(fixture, name).unwrap()
}

fn database(fixture: &Fixture) -> tauri::State<'_, Database> {
    fixture.app.state()
}

fn stored_resources(fixture: &Fixture) -> Vec<ResourceSummary> {
    database(fixture)
        .with_conn(|conn| repository::list_resources(conn, INCLUDING_INACTIVE))
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

fn write_commands(fixture: &Fixture, target: &ResourceSummary) -> Outcomes {
    vec![
        ("create_resource", call_create(fixture, "Nueva").map(|_| ())),
        (
            "update_resource",
            call_update(fixture, rename_to(target, "Editada")).map(|_| ()),
        ),
        (
            "set_resource_active",
            call_set_active(fixture, target.id, false).map(|_| ()),
        ),
    ]
}

fn every_command(fixture: &Fixture, target: &ResourceSummary) -> Outcomes {
    let mut outcomes = vec![(
        "list_resources",
        call_list(fixture, INCLUDING_INACTIVE).map(|_| ()),
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
fn list_resources_requires_a_session() {
    let fixture = fixture();

    let error = call_list(&fixture, ONLY_ACTIVE).unwrap_err();

    assert_eq!(error, AppError::unauthenticated());
}

#[test]
fn every_resource_command_without_session_is_unauthenticated() {
    let fixture = fixture();
    let target = seed_resource(&fixture, "Sala");
    session_end(&fixture);

    assert_all_fail_with(
        every_command(&fixture, &target),
        AppErrorCode::Unauthenticated,
    );

    assert_eq!(
        stored_resources(&fixture).len() as i64,
        SEEDED_RESOURCES + 1
    );
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn every_resource_command_with_a_locked_session_is_session_locked() {
    let fixture = fixture();
    let target = seed_resource(&fixture, "Sala");
    lock_session(&fixture);

    assert_all_fail_with(
        every_command(&fixture, &target),
        AppErrorCode::SessionLocked,
    );

    assert_eq!(
        stored_resources(&fixture).len() as i64,
        SEEDED_RESOURCES + 1
    );
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn users_with_appointments_read_but_not_resources_manage_can_list_and_cannot_write() {
    for username in ["recepcion", "lectura"] {
        let fixture = fixture();
        let target = seed_resource(&fixture, "Sala");
        sign_in_as(&fixture, username);

        let listed = call_list(&fixture, ONLY_ACTIVE).unwrap();
        let writes = write_commands(&fixture, &target);

        assert_eq!(listed.len(), 3, "{username}");
        assert_all_fail_with(writes, AppErrorCode::Forbidden);
        assert_eq!(
            stored_resources(&fixture)
                .into_iter()
                .filter(|resource| resource.active)
                .collect::<Vec<_>>(),
            listed,
            "{username}"
        );
        assert_eq!(audit_actions(&fixture), ["create"], "{username}");
    }
}

#[test]
fn a_user_with_resources_manage_but_not_appointments_read_can_list_and_write() {
    let fixture = fixture();
    sign_in_as(&fixture, "gestora");

    let listed = call_list(&fixture, ONLY_ACTIVE).unwrap();
    let created = call_create(&fixture, "Sala").unwrap();
    let renamed = call_update(&fixture, rename_to(&created, "Sala norte")).unwrap();
    let retired = call_set_active(&fixture, created.id, false).unwrap();

    assert_eq!(listed.len(), 2);
    assert_eq!(renamed.name, "Sala norte");
    assert!(!retired.active);
    assert_eq!(audit_actions(&fixture), ["create", "update", "deactivate"]);
}

#[test]
fn users_without_any_resource_permission_are_forbidden_everywhere() {
    for username in ["sinpermisos", "catalogo"] {
        let fixture = fixture();
        let target = seed_resource(&fixture, "Sala");
        sign_in_as(&fixture, username);

        assert_all_fail_with(every_command(&fixture, &target), AppErrorCode::Forbidden);

        assert_eq!(
            stored_resources(&fixture).len() as i64,
            SEEDED_RESOURCES + 1,
            "{username}"
        );
        assert_eq!(audit_actions(&fixture), ["create"], "{username}");
    }
}

#[test]
fn create_resource_through_the_command_persists_and_audits() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");

    let created = call_create(&fixture, "  Sala  ").unwrap();

    assert_eq!(created.name, "Sala");
    assert!(stored_resources(&fixture).contains(&created));
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn list_resources_honours_the_include_inactive_filter() {
    let fixture = fixture();
    let retired = seed_resource(&fixture, "Sala");
    call_set_active(&fixture, retired.id, false).unwrap();

    let names = |filter| -> Vec<String> {
        call_list(&fixture, filter)
            .unwrap()
            .into_iter()
            .map(|resource| resource.name)
            .collect()
    };

    assert_eq!(names(ONLY_ACTIVE), ["Cabina 1", "Cabina 2"]);
    assert_eq!(
        names(INCLUDING_INACTIVE),
        ["Cabina 1", "Cabina 2", "Manicure (Rosa)", "Sala"]
    );
}

#[test]
fn update_and_deactivate_through_the_commands_are_audited() {
    let fixture = fixture();
    let created = seed_resource(&fixture, "Sala");

    call_update(&fixture, rename_to(&created, "Sala norte")).unwrap();
    call_set_active(&fixture, created.id, false).unwrap();
    call_set_active(&fixture, created.id, true).unwrap();

    assert_eq!(
        audit_actions(&fixture),
        ["create", "update", "deactivate", "reactivate"]
    );
}

#[test]
fn the_kind_can_be_changed_through_the_update_command() {
    let fixture = fixture();
    let created = seed_resource(&fixture, "Sala");

    let updated = call_update(
        &fixture,
        ResourceUpdate {
            kind: ResourceKind::Manicure,
            ..rename_to(&created, "Sala")
        },
    )
    .unwrap();

    assert_eq!(updated.kind, ResourceKind::Manicure);
    assert_eq!(audit_actions(&fixture), ["create", "update"]);
}

#[test]
fn domain_validation_errors_reach_the_caller_with_their_field() {
    let fixture = fixture();
    let created = seed_resource(&fixture, "Sala");

    let duplicate = call_create(&fixture, "SALA").unwrap_err();
    let blank = call_update(&fixture, rename_to(&created, "  ")).unwrap_err();
    let unknown = call_set_active(&fixture, 999, false).unwrap_err();

    assert_eq!(duplicate, AppError::validation("name"));
    assert_eq!(blank, AppError::validation("name"));
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
    let created = seed_resource(&fixture, "Sala");
    let before = stored_resources(&fixture);
    break_audit(&fixture);

    let on_create = call_create(&fixture, "Patio").unwrap_err();
    let on_update = call_update(&fixture, rename_to(&created, "Otra")).unwrap_err();
    let on_deactivate = call_set_active(&fixture, created.id, false).unwrap_err();

    assert_eq!(on_create, AppError::internal());
    assert_eq!(on_update, AppError::internal());
    assert_eq!(on_deactivate, AppError::internal());
    assert_eq!(stored_resources(&fixture), before);
}

#[test]
fn losing_the_permission_between_calls_blocks_the_next_write() {
    let fixture = fixture();
    let created = seed_resource(&fixture, "Sala");
    database(&fixture)
        .with_conn(|conn| {
            conn.execute(
                "DELETE FROM role_permissions WHERE role_id = ?1 AND permission_key = 'resources.manage'",
                [OWNER_ROLE],
            )?;
            Ok(())
        })
        .unwrap();

    let error = call_update(&fixture, rename_to(&created, "Otra")).unwrap_err();

    assert_eq!(error, AppError::forbidden());
    assert!(stored_resources(&fixture).contains(&created));
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
    for command in ["create_resource", "update_resource", "set_resource_active"] {
        let fixture = fixture();
        let target = seed_resource(&fixture, "Sala");
        let before = stored_resources(&fixture);
        sign_in_idle_past_timeout(&fixture, "propietaria");

        let outcome = match command {
            "create_resource" => call_create(&fixture, "Nueva").map(|_| ()),
            "update_resource" => call_update(&fixture, rename_to(&target, "Otra")).map(|_| ()),
            _ => call_set_active(&fixture, target.id, false).map(|_| ()),
        };

        assert_eq!(
            outcome.unwrap_err().code,
            AppErrorCode::SessionLocked,
            "{command}"
        );
        assert_eq!(session_locked_rows(&fixture), 1, "{command}");
        assert_eq!(stored_resources(&fixture), before, "{command}");
    }
}

fn resources_row_count(fixture: &Fixture) -> i64 {
    database(fixture)
        .with_conn(|conn| {
            Ok(conn.query_row("SELECT COUNT(*) FROM resources", [], |row| row.get(0))?)
        })
        .unwrap()
}

#[test]
fn no_resource_command_ever_reduces_the_number_of_resources() {
    let fixture = fixture();
    let first = seed_resource(&fixture, "Sala");
    let second = call_create(&fixture, "Patio").unwrap();
    let mut counts = vec![resources_row_count(&fixture)];

    for resource in [&first, &second] {
        call_set_active(&fixture, resource.id, false).unwrap();
        counts.push(resources_row_count(&fixture));
        call_update(&fixture, rename_to(resource, "Renombrada")).unwrap();
        counts.push(resources_row_count(&fixture));
        call_set_active(&fixture, resource.id, true).unwrap();
        counts.push(resources_row_count(&fixture));
        call_update(&fixture, rename_to(resource, &resource.name)).unwrap();
        counts.push(resources_row_count(&fixture));
    }
    call_list(&fixture, INCLUDING_INACTIVE).unwrap();
    counts.push(resources_row_count(&fixture));
    let _ = call_set_active(&fixture, 9999, false);
    let _ = call_create(&fixture, "sala");
    counts.push(resources_row_count(&fixture));

    assert!(
        counts.windows(2).all(|pair| pair[0] <= pair[1]),
        "{counts:?}"
    );
    assert_eq!(*counts.last().unwrap(), SEEDED_RESOURCES + 2);
}

const TRANSACTIONAL_WRITES: [&str; 3] =
    ["create_resource", "update_resource", "set_resource_active"];

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
    target: &ResourceSummary,
    beat: Beat,
    write: &str,
) -> Result<(), AppError> {
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    let outcome = database(fixture).with_tx(|tx| match write {
        "create_resource" => {
            let input = ResourceInput {
                name: "Nueva".to_string(),
                kind: ResourceKind::Cabin,
            };
            create_resource_in_transaction(tx, &session, beat, &input).map(|_| ())
        }
        "update_resource" => {
            update_resource_in_transaction(tx, &session, beat, &rename_to(target, "Otra"))
                .map(|_| ())
        }
        _ => {
            let activation = ResourceActivation {
                id: target.id,
                active: false,
            };
            set_resource_active_in_transaction(tx, &session, beat, &activation).map(|_| ())
        }
    });
    outcome.map_err(AppError::from)
}

#[test]
fn every_transactional_write_revalidates_the_permission_inside_the_transaction() {
    for write in TRANSACTIONAL_WRITES {
        let fixture = fixture();
        let target = seed_resource(&fixture, "Sala");
        let stored_before = stored_resources(&fixture);
        let audit_before = audit_actions(&fixture);
        database(&fixture)
            .with_conn(|conn| {
                conn.execute(
                    "DELETE FROM role_permissions WHERE role_id = ?1 AND permission_key = 'resources.manage'",
                    [OWNER_ROLE],
                )?;
                Ok(())
            })
            .unwrap();

        let outcome = run_in_transaction(&fixture, &target, Beat::now(), write);

        assert_eq!(outcome.unwrap_err(), AppError::forbidden(), "{write}");
        assert_eq!(stored_resources(&fixture), stored_before, "{write}");
        assert_eq!(audit_actions(&fixture), audit_before, "{write}");
    }
}

#[test]
fn every_transactional_write_revalidates_the_idle_lock_and_keeps_its_audit_for_the_next_attempt() {
    for write in TRANSACTIONAL_WRITES {
        let fixture = fixture();
        let target = seed_resource(&fixture, "Sala");
        let stored_before = stored_resources(&fixture);
        let audit_before = audit_actions(&fixture);

        let outcome = run_in_transaction(&fixture, &target, past_idle_beat(), write);

        assert_eq!(
            outcome.unwrap_err().code,
            AppErrorCode::SessionLocked,
            "{write}"
        );
        assert_eq!(stored_resources(&fixture), stored_before, "{write}");
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
