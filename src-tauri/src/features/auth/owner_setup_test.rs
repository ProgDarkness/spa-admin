use std::sync::Arc;

use rusqlite::Connection;
use tauri::test::mock_app;
use tauri::Manager;
use zeroize::Zeroizing;

use super::*;
use crate::db::migrate;
use crate::errors::{AppError, AppErrorCode};
use crate::features::audit::repository::list_all;
use crate::features::audit::ClockRollback;
use crate::features::audit::{AuditAction, ClockRollbackNotice};
use crate::features::auth::commands::{setup_owner, setup_status};
use crate::features::auth::model::{PermissionKey, SessionView};
use crate::features::auth::repository::{insert_user, NewUser};

const OWNER_PASSWORD: &str = "clave-propietaria-1";
const OWNER_USERNAME: &str = "  Propietaria ";
const RACING_CALLERS: usize = 4;
const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";

struct Fixture {
    database: Database,
    passwords: Arc<PasswordPolicy>,
    session: SessionState,
}

fn fixture() -> Fixture {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    Fixture {
        database: Database::new(conn),
        passwords: Arc::new(PasswordPolicy::new().unwrap()),
        session: SessionState::default(),
    }
}

fn status_of(conn: &Connection) -> Result<SetupStatus, DbError> {
    setup_status_of(conn, &ClockRollbackNotice(None))
}

fn input(username: &str, password: &str) -> OwnerSetup {
    OwnerSetup {
        username: username.to_string(),
        password: password.to_string(),
    }
}

fn run_setup(fixture: &Fixture, input: OwnerSetup) -> Result<OwnerSetupResult, AuthError> {
    tauri::async_runtime::block_on(create_owner(
        &fixture.database,
        Arc::clone(&fixture.passwords),
        &fixture.session,
        input,
    ))
}

fn setup_valid_owner(fixture: &Fixture) -> OwnerSetupResult {
    run_setup(fixture, input(OWNER_USERNAME, OWNER_PASSWORD)).unwrap()
}

fn user_count(fixture: &Fixture) -> i64 {
    fixture.database.with_conn(count_users).unwrap()
}

fn add_existing_user(fixture: &Fixture) {
    let user = NewUser {
        username: "existente".to_string(),
        password_hash: fixture.passwords.hash("clave-existente-1").unwrap(),
        role_id: 2,
    };
    fixture
        .database
        .with_conn(|conn| insert_user(conn, &user))
        .unwrap();
}

fn stored_hashes(fixture: &Fixture) -> (String, Option<String>) {
    fixture
        .database
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT password_hash, recovery_code_hash FROM users",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?)
        })
        .unwrap()
}

fn audit_dump(fixture: &Fixture) -> String {
    let entries = fixture.database.with_conn(list_all).unwrap();
    format!("{entries:?}").to_lowercase()
}

fn canonical_of(result: &OwnerSetupResult) -> String {
    RecoveryCode::parse(&result.recovery_code)
        .unwrap()
        .canonical()
        .to_string()
}

#[test]
fn setup_status_reports_needs_owner() {
    let fixture = fixture();

    let before = fixture.database.with_conn(status_of).unwrap();
    setup_valid_owner(&fixture);
    let after = fixture.database.with_conn(status_of).unwrap();

    assert!(before.needs_owner);
    assert!(before.clock_rollback.is_none());
    assert!(!after.needs_owner);
}

#[test]
fn setup_owner_rejected_when_user_exists() {
    let fixture = fixture();
    add_existing_user(&fixture);

    let failure = run_setup(&fixture, input("propietaria", OWNER_PASSWORD)).unwrap_err();

    assert!(matches!(failure, AuthError::SetupClosed));
    assert_eq!(AppError::from(failure).code, AppErrorCode::Forbidden);
    assert_eq!(user_count(&fixture), 1);
    assert!(fixture.session.observe(Beat::now()).unwrap().is_none());
}

#[test]
fn setup_owner_does_not_hash_when_closed() {
    let fixture = fixture();
    add_existing_user(&fixture);
    let hashes_before = fixture.passwords.hash_count();

    run_setup(&fixture, input("propietaria", OWNER_PASSWORD)).unwrap_err();

    assert_eq!(fixture.passwords.hash_count(), hashes_before);
}

#[test]
fn invalid_input_is_rejected_before_hashing() {
    let fixture = fixture();
    let hashes_before = fixture.passwords.hash_count();

    let weak = run_setup(&fixture, input("propietaria", "corta")).unwrap_err();
    let blank = run_setup(&fixture, input("   ", OWNER_PASSWORD)).unwrap_err();
    let long = run_setup(&fixture, input(&"u".repeat(65), OWNER_PASSWORD)).unwrap_err();

    assert!(matches!(weak, AuthError::Validation("password")));
    assert!(matches!(blank, AuthError::Validation("username")));
    assert!(matches!(long, AuthError::Validation("username")));
    assert_eq!(fixture.passwords.hash_count(), hashes_before);
    assert_eq!(user_count(&fixture), 0);
}

#[test]
fn register_owner_rechecks_inside_the_transaction() {
    let fixture = fixture();
    let credentials = prepare_credentials(
        Arc::clone(&fixture.passwords),
        Zeroizing::new(OWNER_PASSWORD.to_string()),
    );
    let credentials = tauri::async_runtime::block_on(credentials).unwrap();
    add_existing_user(&fixture);

    let failure = register_owner(&fixture.database, "propietaria", &credentials).unwrap_err();

    assert!(matches!(failure, AuthError::SetupClosed));
    assert_eq!(user_count(&fixture), 1);
    assert!(audit_dump(&fixture).contains("[]"));
}

#[test]
fn concurrent_setup_owner_only_one_wins() {
    let fixture = fixture();

    let outcomes: Vec<Result<OwnerSetupResult, AuthError>> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..RACING_CALLERS)
            .map(|index| {
                let fixture = &fixture;
                scope.spawn(move || {
                    run_setup(
                        fixture,
                        input(&format!("propietaria{index}"), OWNER_PASSWORD),
                    )
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });

    let winners = outcomes.iter().filter(|outcome| outcome.is_ok()).count();
    assert_eq!(winners, 1);
    assert!(outcomes
        .iter()
        .filter_map(|outcome| outcome.as_ref().err())
        .all(|failure| matches!(failure, AuthError::SetupClosed)));
    assert_eq!(user_count(&fixture), 1);
    let created = fixture
        .database
        .with_conn(list_all)
        .unwrap()
        .into_iter()
        .filter(|entry| entry.action == AuditAction::OwnerCreated)
        .count();
    assert_eq!(created, 1);
}

#[test]
fn setup_owner_starts_session_with_owner_permissions() {
    let fixture = fixture();

    let result = setup_valid_owner(&fixture);

    let observed = fixture
        .session
        .observe(Beat::now())
        .unwrap()
        .expect("session started");
    assert_eq!(observed.view, SessionView::active(result.user.clone()));
    assert_eq!(result.user.username, "Propietaria");
    assert_eq!(result.user.role_name, "Propietaria");
    assert_eq!(result.user.permissions, PermissionKey::ALL.to_vec());
}

#[test]
fn setup_owner_audits_owner_created_without_hashes() {
    let fixture = fixture();

    let result = setup_valid_owner(&fixture);

    let entries = fixture.database.with_conn(list_all).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].action.as_str(), "owner_created");
    assert_eq!(entries[0].actor_user_id, Some(result.user.id));
    assert_eq!(entries[0].entity.as_str(), "user");
    assert_eq!(entries[0].entity_id, Some(result.user.id));
    let diff = entries[0].diff.clone().unwrap();
    assert!(diff.contains("Propietaria"));
    assert!(diff.contains("roleId"));
    let dump = audit_dump(&fixture);
    assert!(!dump.contains("argon2"));
    assert!(!dump.contains("hash"));
}

#[test]
fn code_stored_only_as_argon2_hash() {
    let fixture = fixture();

    let result = setup_valid_owner(&fixture);

    let canonical = canonical_of(&result);
    let (password_hash, recovery_hash) = stored_hashes(&fixture);
    let recovery_hash = recovery_hash.expect("recovery hash stored");
    assert!(recovery_hash.starts_with("$argon2id$"));
    assert!(password_hash.starts_with("$argon2id$"));
    assert!(!recovery_hash.contains(&canonical));
    assert!(fixture
        .passwords
        .verify(&canonical, Some(&recovery_hash))
        .unwrap());
    assert!(!fixture
        .passwords
        .verify(&canonical, Some(&password_hash))
        .unwrap());
    assert!(fixture
        .passwords
        .verify(OWNER_PASSWORD, Some(&password_hash))
        .unwrap());
}

#[test]
fn code_absent_from_audit() {
    let fixture = fixture();

    let result = setup_valid_owner(&fixture);

    let dump = audit_dump(&fixture);
    let canonical = canonical_of(&result).to_lowercase();
    assert!(!dump.contains(&canonical));
    assert!(!dump.contains(&result.recovery_code.to_lowercase()));
    assert!(!dump.contains(&OWNER_PASSWORD.to_lowercase()));
}

#[test]
fn recovery_code_in_result_is_grouped_for_reading() {
    let fixture = fixture();

    let result = setup_valid_owner(&fixture);

    let groups: Vec<&str> = result.recovery_code.split('-').collect();
    assert_eq!(groups.len(), 5);
    assert!(groups.iter().all(|group| group.len() == 4));
}

#[test]
fn setup_owner_failure_leaves_no_user() {
    let fixture = fixture();
    fixture
        .database
        .with_conn(|conn| {
            conn.execute_batch(FAIL_AUDIT_INSERTS)?;
            Ok(())
        })
        .unwrap();

    let failure = run_setup(&fixture, input("propietaria", OWNER_PASSWORD)).unwrap_err();

    assert!(matches!(failure, AuthError::Db(_)));
    assert_eq!(user_count(&fixture), 0);
    assert!(fixture.session.observe(Beat::now()).unwrap().is_none());
    assert!(fixture.database.with_conn(status_of).unwrap().needs_owner);
}

#[test]
fn commands_expose_status_and_owner_creation_through_tauri_state() {
    let fixture = fixture();
    let app = mock_app();
    app.manage(fixture.database);
    app.manage(fixture.passwords);
    app.manage(fixture.session);
    app.manage(ClockRollbackNotice(None));

    let before = setup_status(app.state(), app.state()).unwrap();
    let created = tauri::async_runtime::block_on(setup_owner(
        input("propietaria", OWNER_PASSWORD),
        app.state(),
        app.state(),
        app.state(),
    ))
    .unwrap();
    let after = setup_status(app.state(), app.state()).unwrap();
    let second = tauri::async_runtime::block_on(setup_owner(
        input("otra", OWNER_PASSWORD),
        app.state(),
        app.state(),
        app.state(),
    ))
    .unwrap_err();

    assert!(before.needs_owner);
    assert_eq!(created.user.username, "propietaria");
    assert!(!after.needs_owner);
    assert_eq!(second.code, AppErrorCode::Forbidden);
}

#[test]
fn clock_rollback_exposed_by_setup_status() {
    let fixture = fixture();
    let rollback = ClockRollback {
        last_recorded_at: "2026-05-02T10:00:00".to_string(),
        detected_at: "2026-05-01T09:00:00".to_string(),
    };
    let app = mock_app();
    app.manage(fixture.database);
    app.manage(ClockRollbackNotice(Some(rollback.clone())));

    let exposed = setup_status(app.state(), app.state()).unwrap();

    assert_eq!(exposed.clock_rollback, Some(rollback));
    assert!(exposed.needs_owner);
}
