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
use crate::features::payment_methods::repository;
use crate::features::users::repository::{insert_user, NewUserRow};

const OWNER_ROLE: i64 = 1;
const SEEDED_METHODS: i64 = 5;
const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";
const ONLY_ACTIVE: PaymentMethodFilter = PaymentMethodFilter {
    include_inactive: false,
};
const INCLUDING_INACTIVE: PaymentMethodFilter = PaymentMethodFilter {
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
    let catalog_manager = add_role(&conn, "Gestor catalogo", &["catalog.read", "catalog.write"]);
    let catalog_reader = add_role(&conn, "Lector catalogo", &["catalog.read"]);
    let payments_reader = add_role(&conn, "Lector pagos", &["payments.read"]);
    let catalog_writer_only = add_role(&conn, "Escritor catalogo", &["catalog.write"]);
    let payments_writer_only = add_role(&conn, "Escritor pagos", &["payments.write"]);
    let without_permissions = add_role(&conn, "Sin permisos", &[]);
    add_user(&conn, "propietaria", OWNER_ROLE);
    add_user(&conn, "recepcion", 2);
    add_user(&conn, "lectura", 3);
    add_user(&conn, "gestora", catalog_manager);
    add_user(&conn, "lectorcatalogo", catalog_reader);
    add_user(&conn, "lectorpagos", payments_reader);
    add_user(&conn, "soloescritura", catalog_writer_only);
    add_user(&conn, "escritorpagos", payments_writer_only);
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

fn call_list(
    fixture: &Fixture,
    filter: PaymentMethodFilter,
) -> Result<Vec<PaymentMethodSummary>, AppError> {
    list_payment_methods(filter, fixture.app.state(), fixture.app.state())
}

fn call_create(fixture: &Fixture, name: &str) -> Result<PaymentMethodSummary, AppError> {
    create_payment_method(
        PaymentMethodInput {
            name: name.to_string(),
        },
        fixture.app.state(),
        fixture.app.state(),
    )
}

fn call_update(
    fixture: &Fixture,
    update: PaymentMethodUpdate,
) -> Result<PaymentMethodSummary, AppError> {
    update_payment_method(update, fixture.app.state(), fixture.app.state())
}

fn call_set_active(
    fixture: &Fixture,
    id: i64,
    active: bool,
) -> Result<PaymentMethodSummary, AppError> {
    set_payment_method_active(
        PaymentMethodActivation { id, active },
        fixture.app.state(),
        fixture.app.state(),
    )
}

fn rename_to(method: &PaymentMethodSummary, name: &str) -> PaymentMethodUpdate {
    PaymentMethodUpdate {
        id: method.id,
        name: name.to_string(),
    }
}

fn seed_method(fixture: &Fixture, name: &str) -> PaymentMethodSummary {
    sign_in_as(fixture, "propietaria");
    call_create(fixture, name).unwrap()
}

fn database(fixture: &Fixture) -> tauri::State<'_, Database> {
    fixture.app.state()
}

fn stored_methods(fixture: &Fixture) -> Vec<PaymentMethodSummary> {
    database(fixture)
        .with_conn(|conn| repository::list_payment_methods(conn, INCLUDING_INACTIVE))
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

fn write_commands(fixture: &Fixture, target: &PaymentMethodSummary) -> Outcomes {
    vec![
        (
            "create_payment_method",
            call_create(fixture, "Nuevo").map(|_| ()),
        ),
        (
            "update_payment_method",
            call_update(fixture, rename_to(target, "Editado")).map(|_| ()),
        ),
        (
            "set_payment_method_active",
            call_set_active(fixture, target.id, false).map(|_| ()),
        ),
    ]
}

fn every_command(fixture: &Fixture, target: &PaymentMethodSummary) -> Outcomes {
    let mut outcomes = vec![(
        "list_payment_methods",
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
fn list_payment_methods_requires_a_session() {
    let fixture = fixture();

    let error = call_list(&fixture, ONLY_ACTIVE).unwrap_err();

    assert_eq!(error, AppError::unauthenticated());
}

#[test]
fn every_payment_method_command_without_session_is_unauthenticated() {
    let fixture = fixture();
    let target = seed_method(&fixture, "Cheque");
    session_end(&fixture);

    assert_all_fail_with(
        every_command(&fixture, &target),
        AppErrorCode::Unauthenticated,
    );

    assert_eq!(stored_methods(&fixture).len() as i64, SEEDED_METHODS + 1);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn every_payment_method_command_with_a_locked_session_is_session_locked() {
    let fixture = fixture();
    let target = seed_method(&fixture, "Cheque");
    lock_session(&fixture);

    assert_all_fail_with(
        every_command(&fixture, &target),
        AppErrorCode::SessionLocked,
    );

    assert_eq!(stored_methods(&fixture).len() as i64, SEEDED_METHODS + 1);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn users_with_catalog_read_or_payments_read_can_list_and_cannot_write() {
    for username in ["recepcion", "lectura", "lectorcatalogo", "lectorpagos"] {
        let fixture = fixture();
        let target = seed_method(&fixture, "Cheque");
        sign_in_as(&fixture, username);

        let listed = call_list(&fixture, ONLY_ACTIVE).unwrap();
        let writes = write_commands(&fixture, &target);

        assert_eq!(listed.len() as i64, SEEDED_METHODS + 1, "{username}");
        assert_all_fail_with(writes, AppErrorCode::Forbidden);
        assert_eq!(stored_methods(&fixture), listed, "{username}");
        assert_eq!(audit_actions(&fixture), ["create"], "{username}");
    }
}

#[test]
fn a_user_with_catalog_write_and_catalog_read_can_list_and_write() {
    let fixture = fixture();
    sign_in_as(&fixture, "gestora");

    let listed = call_list(&fixture, ONLY_ACTIVE).unwrap();
    let created = call_create(&fixture, "Cheque").unwrap();
    let renamed = call_update(&fixture, rename_to(&created, "Cheque banco")).unwrap();
    let retired = call_set_active(&fixture, created.id, false).unwrap();

    assert_eq!(listed.len() as i64, SEEDED_METHODS);
    assert_eq!(renamed.name, "Cheque banco");
    assert!(!retired.active);
    assert_eq!(audit_actions(&fixture), ["create", "update", "deactivate"]);
}

#[test]
fn every_write_command_attributes_the_audit_and_the_stamp_to_the_signed_in_user() {
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

    let created = call_create(&fixture, "Cheque").unwrap();
    call_update(&fixture, rename_to(&created, "Cheque banco")).unwrap();
    call_set_active(&fixture, created.id, false).unwrap();

    let actors: Vec<Option<i64>> = database(&fixture)
        .with_conn(list_all)
        .unwrap()
        .into_iter()
        .map(|entry| entry.actor_user_id)
        .collect();
    let updated_by: i64 = database(&fixture)
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT updated_by FROM payment_methods WHERE id = ?1",
                [created.id],
                |row| row.get(0),
            )?)
        })
        .unwrap();
    assert_eq!(actors, vec![Some(actor); 3]);
    assert_eq!(updated_by, actor);
}

#[test]
fn catalog_write_alone_can_write_but_cannot_list() {
    let fixture = fixture();
    sign_in_as(&fixture, "soloescritura");

    let listed = call_list(&fixture, ONLY_ACTIVE).unwrap_err();
    let created = call_create(&fixture, "Cheque").unwrap();

    assert_eq!(listed, AppError::forbidden());
    assert_eq!(created.name, "Cheque");
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn users_without_a_usable_payment_method_permission_are_forbidden_everywhere() {
    for username in ["sinpermisos", "escritorpagos"] {
        let fixture = fixture();
        let target = seed_method(&fixture, "Cheque");
        sign_in_as(&fixture, username);

        assert_all_fail_with(every_command(&fixture, &target), AppErrorCode::Forbidden);

        assert_eq!(
            stored_methods(&fixture).len() as i64,
            SEEDED_METHODS + 1,
            "{username}"
        );
        assert_eq!(audit_actions(&fixture), ["create"], "{username}");
    }
}

#[test]
fn create_payment_method_through_the_command_persists_and_audits() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");

    let created = call_create(&fixture, "  Cheque  ").unwrap();

    assert_eq!(created.name, "Cheque");
    assert!(stored_methods(&fixture).contains(&created));
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn list_payment_methods_honours_the_include_inactive_filter() {
    let fixture = fixture();
    let retired = seed_method(&fixture, "Cheque");
    call_set_active(&fixture, retired.id, false).unwrap();

    let names = |filter| -> Vec<String> {
        call_list(&fixture, filter)
            .unwrap()
            .into_iter()
            .map(|method| method.name)
            .collect()
    };

    assert_eq!(
        names(ONLY_ACTIVE),
        [
            "Efectivo",
            "Pago móvil",
            "Punto de venta",
            "Transferencia",
            "Zelle"
        ]
    );
    assert_eq!(
        names(INCLUDING_INACTIVE),
        [
            "Cheque",
            "Efectivo",
            "Pago móvil",
            "Punto de venta",
            "Transferencia",
            "Zelle"
        ]
    );
}

#[test]
fn update_and_deactivate_through_the_commands_are_audited() {
    let fixture = fixture();
    let created = seed_method(&fixture, "Cheque");

    call_update(&fixture, rename_to(&created, "Cheque banco")).unwrap();
    call_set_active(&fixture, created.id, false).unwrap();
    call_set_active(&fixture, created.id, true).unwrap();

    assert_eq!(
        audit_actions(&fixture),
        ["create", "update", "deactivate", "reactivate"]
    );
}

#[test]
fn an_edit_without_changes_through_the_command_does_not_audit() {
    let fixture = fixture();
    let created = seed_method(&fixture, "Cheque");

    let same = call_update(&fixture, rename_to(&created, "  Cheque ")).unwrap();

    assert_eq!(same, created);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn domain_validation_errors_reach_the_caller_with_their_field() {
    let fixture = fixture();
    let created = seed_method(&fixture, "Cheque");

    let duplicate = call_create(&fixture, "CHEQUE").unwrap_err();
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
    let created = seed_method(&fixture, "Cheque");
    let before = stored_methods(&fixture);
    break_audit(&fixture);

    let on_create = call_create(&fixture, "Cripto").unwrap_err();
    let on_update = call_update(&fixture, rename_to(&created, "Otro")).unwrap_err();
    let on_deactivate = call_set_active(&fixture, created.id, false).unwrap_err();

    assert_eq!(on_create, AppError::internal());
    assert_eq!(on_update, AppError::internal());
    assert_eq!(on_deactivate, AppError::internal());
    assert_eq!(stored_methods(&fixture), before);
}

fn revoke_owner_catalog_write(fixture: &Fixture) {
    database(fixture)
        .with_conn(|conn| {
            conn.execute(
                "DELETE FROM role_permissions WHERE role_id = ?1 AND permission_key = 'catalog.write'",
                [OWNER_ROLE],
            )?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn losing_the_permission_between_calls_blocks_the_next_write() {
    let fixture = fixture();
    let created = seed_method(&fixture, "Cheque");
    revoke_owner_catalog_write(&fixture);

    let error = call_update(&fixture, rename_to(&created, "Otro")).unwrap_err();

    assert_eq!(error, AppError::forbidden());
    assert!(stored_methods(&fixture).contains(&created));
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

const TRANSACTIONAL_WRITES: [&str; 3] = [
    "create_payment_method",
    "update_payment_method",
    "set_payment_method_active",
];

#[test]
fn every_write_command_audits_an_idle_lock_first_seen_on_it_exactly_once() {
    for command in TRANSACTIONAL_WRITES {
        let fixture = fixture();
        let target = seed_method(&fixture, "Cheque");
        let before = stored_methods(&fixture);
        sign_in_idle_past_timeout(&fixture, "propietaria");

        let outcome = match command {
            "create_payment_method" => call_create(&fixture, "Nuevo").map(|_| ()),
            "update_payment_method" => {
                call_update(&fixture, rename_to(&target, "Otro")).map(|_| ())
            }
            _ => call_set_active(&fixture, target.id, false).map(|_| ()),
        };

        assert_eq!(
            outcome.unwrap_err().code,
            AppErrorCode::SessionLocked,
            "{command}"
        );
        assert_eq!(session_locked_rows(&fixture), 1, "{command}");
        assert_eq!(stored_methods(&fixture), before, "{command}");
    }
}

fn payment_methods_row_count(fixture: &Fixture) -> i64 {
    database(fixture)
        .with_conn(|conn| {
            Ok(conn.query_row("SELECT COUNT(*) FROM payment_methods", [], |row| row.get(0))?)
        })
        .unwrap()
}

#[test]
fn no_payment_method_command_ever_reduces_the_number_of_methods() {
    let fixture = fixture();
    let first = seed_method(&fixture, "Cheque");
    let second = call_create(&fixture, "Cripto").unwrap();
    let mut counts = vec![payment_methods_row_count(&fixture)];

    for method in [&first, &second] {
        call_set_active(&fixture, method.id, false).unwrap();
        counts.push(payment_methods_row_count(&fixture));
        call_update(&fixture, rename_to(method, "Renombrado")).unwrap();
        counts.push(payment_methods_row_count(&fixture));
        call_set_active(&fixture, method.id, true).unwrap();
        counts.push(payment_methods_row_count(&fixture));
        call_update(&fixture, rename_to(method, &method.name)).unwrap();
        counts.push(payment_methods_row_count(&fixture));
    }
    call_list(&fixture, INCLUDING_INACTIVE).unwrap();
    counts.push(payment_methods_row_count(&fixture));
    let _ = call_set_active(&fixture, 9999, false);
    let _ = call_create(&fixture, "cheque");
    counts.push(payment_methods_row_count(&fixture));

    assert!(
        counts.windows(2).all(|pair| pair[0] <= pair[1]),
        "{counts:?}"
    );
    assert_eq!(*counts.last().unwrap(), SEEDED_METHODS + 2);
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
    target: &PaymentMethodSummary,
    beat: Beat,
    write: &str,
) -> Result<(), AppError> {
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    let outcome = database(fixture).with_tx(|tx| match write {
        "create_payment_method" => {
            let input = PaymentMethodInput {
                name: "Nuevo".to_string(),
            };
            create_payment_method_in_transaction(tx, &session, beat, &input).map(|_| ())
        }
        "update_payment_method" => {
            update_payment_method_in_transaction(tx, &session, beat, &rename_to(target, "Otro"))
                .map(|_| ())
        }
        _ => {
            let activation = PaymentMethodActivation {
                id: target.id,
                active: false,
            };
            set_payment_method_active_in_transaction(tx, &session, beat, &activation).map(|_| ())
        }
    });
    outcome.map_err(AppError::from)
}

#[test]
fn every_transactional_write_revalidates_the_permission_inside_the_transaction() {
    for write in TRANSACTIONAL_WRITES {
        let fixture = fixture();
        let target = seed_method(&fixture, "Cheque");
        let stored_before = stored_methods(&fixture);
        let audit_before = audit_actions(&fixture);
        revoke_owner_catalog_write(&fixture);

        let outcome = run_in_transaction(&fixture, &target, Beat::now(), write);

        assert_eq!(outcome.unwrap_err(), AppError::forbidden(), "{write}");
        assert_eq!(stored_methods(&fixture), stored_before, "{write}");
        assert_eq!(audit_actions(&fixture), audit_before, "{write}");
    }
}

#[test]
fn every_transactional_write_revalidates_the_idle_lock_and_keeps_its_audit_for_the_next_attempt() {
    for write in TRANSACTIONAL_WRITES {
        let fixture = fixture();
        let target = seed_method(&fixture, "Cheque");
        let stored_before = stored_methods(&fixture);
        let audit_before = audit_actions(&fixture);

        let outcome = run_in_transaction(&fixture, &target, past_idle_beat(), write);

        assert_eq!(
            outcome.unwrap_err().code,
            AppErrorCode::SessionLocked,
            "{write}"
        );
        assert_eq!(stored_methods(&fixture), stored_before, "{write}");
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
