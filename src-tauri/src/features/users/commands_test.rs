use std::sync::Arc;

use tauri::test::{mock_app, MockRuntime};
use tauri::{App, Manager, State};

use super::*;
use crate::db::{migrate, Database};
use crate::errors::AppError;
use crate::errors::AppErrorCode;
use crate::features::audit::repository::list_all;
use crate::features::auth::commands::login;
use crate::features::auth::model::{LoginCredentials, SessionUser};
use crate::features::auth::password::PasswordPolicy;
use crate::features::auth::repository::permissions_of_role_for_user;
use crate::features::auth::service::{Beat, SessionState};
use crate::features::auth::throttle::LoginThrottle;
use crate::features::users::repository::{self, NewUserRow};

pub(super) const OWNER_ROLE: i64 = 1;
pub(super) const RECEPTION_ROLE: i64 = 2;
pub(super) const READ_ONLY_ROLE: i64 = 3;
pub(super) const PASSWORD: &str = "clave-segura-12";
pub(super) const NEW_PASSWORD: &str = "clave-nueva-3456";

pub(super) struct Fixture {
    pub(super) app: App<MockRuntime>,
}

pub(super) fn fixture() -> Fixture {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    let policy = PasswordPolicy::new().unwrap();
    let hash = policy.hash(PASSWORD).unwrap();
    for (username, role_id) in [
        ("propietaria", OWNER_ROLE),
        ("recepcion", RECEPTION_ROLE),
        ("lectura", READ_ONLY_ROLE),
    ] {
        let row = NewUserRow {
            username: username.to_string(),
            password_hash: hash.clone(),
            role_id,
        };
        repository::insert_user(&conn, &row, None).unwrap();
    }
    let app = mock_app();
    app.manage(Database::new(conn));
    app.manage(Arc::new(policy));
    app.manage(LoginThrottle::default());
    app.manage(SessionState::default());
    Fixture { app }
}

pub(super) fn database(fixture: &Fixture) -> State<'_, Database> {
    fixture.app.state()
}

pub(super) fn session(fixture: &Fixture) -> State<'_, SessionState> {
    fixture.app.state()
}

pub(super) fn id_of(fixture: &Fixture, username: &str) -> i64 {
    database(fixture)
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT id FROM users WHERE username = ?1 COLLATE NOCASE",
                [username],
                |row| row.get(0),
            )?)
        })
        .unwrap()
}

pub(super) fn sign_in_as(fixture: &Fixture, username: &str) -> SessionUser {
    let id = id_of(fixture, username);
    let user = database(fixture)
        .with_conn(|conn| {
            let role_name: String = conn.query_row(
                "SELECT r.name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?1",
                [id],
                |row| row.get(0),
            )?;
            Ok(SessionUser {
                id,
                username: username.to_string(),
                role_name,
                permissions: permissions_of_role_for_user(conn, id)?,
            })
        })
        .unwrap();
    session(fixture).start(user.clone(), Beat::now()).unwrap();
    user
}

pub(super) fn audit_actions(fixture: &Fixture) -> Vec<String> {
    database(fixture)
        .with_conn(list_all)
        .unwrap()
        .into_iter()
        .map(|entry| entry.action.as_str().to_string())
        .collect()
}

pub(super) fn users_count(fixture: &Fixture) -> usize {
    database(fixture)
        .with_conn(repository::list_users)
        .unwrap()
        .len()
}

pub(super) fn call_create_user(
    fixture: &Fixture,
    username: &str,
    password: &str,
    role_id: i64,
) -> Result<UserSummary, AppError> {
    let input = NewUserInput {
        username: username.to_string(),
        password: password.to_string(),
        role_id,
    };
    tauri::async_runtime::block_on(create_user(
        input,
        fixture.app.state(),
        fixture.app.state(),
        fixture.app.state(),
    ))
}

pub(super) fn call_reset(fixture: &Fixture, user_id: i64, password: &str) -> Result<(), AppError> {
    let reset = PasswordReset {
        user_id,
        new_password: password.to_string(),
    };
    tauri::async_runtime::block_on(reset_user_password(
        reset,
        fixture.app.state(),
        fixture.app.state(),
        fixture.app.state(),
    ))
}

pub(super) fn call_update(fixture: &Fixture, update: UserUpdate) -> Result<UserSummary, AppError> {
    update_user(update, fixture.app.state(), fixture.app.state())
}

pub(super) fn call_login(
    fixture: &Fixture,
    username: &str,
    password: &str,
) -> Result<(), AppError> {
    let credentials = LoginCredentials {
        username: username.to_string(),
        password: password.to_string(),
    };
    tauri::async_runtime::block_on(login(
        credentials,
        fixture.app.state(),
        fixture.app.state(),
        fixture.app.state(),
        fixture.app.state(),
    ))
    .map(|_| ())
}

pub(super) fn deactivation(id: i64) -> UserUpdate {
    UserUpdate {
        id,
        username: None,
        role_id: None,
        active: Some(false),
    }
}

fn every_command(fixture: &Fixture) -> Vec<(&'static str, Result<(), AppError>)> {
    let target = id_of(fixture, "lectura");
    vec![
        (
            "list_users",
            list_users(fixture.app.state(), fixture.app.state()).map(|_| ()),
        ),
        (
            "create_user",
            call_create_user(fixture, "nueva", PASSWORD, RECEPTION_ROLE).map(|_| ()),
        ),
        (
            "update_user",
            call_update(fixture, deactivation(target)).map(|_| ()),
        ),
        (
            "reset_user_password",
            call_reset(fixture, target, NEW_PASSWORD),
        ),
        (
            "list_roles",
            list_roles(fixture.app.state(), fixture.app.state()).map(|_| ()),
        ),
        (
            "create_role",
            create_role(
                NewRole {
                    name: "Caja".into(),
                    permissions: vec![],
                },
                fixture.app.state(),
                fixture.app.state(),
            )
            .map(|_| ()),
        ),
        (
            "set_role_permissions",
            set_role_permissions(
                RolePermissionsUpdate {
                    role_id: RECEPTION_ROLE,
                    permissions: vec![],
                },
                fixture.app.state(),
                fixture.app.state(),
            )
            .map(|_| ()),
        ),
    ]
}

fn assert_every_command_fails_with(fixture: &Fixture, code: AppErrorCode) {
    for (name, outcome) in every_command(fixture) {
        let error = outcome.expect_err(name);
        assert_eq!(error.code, code, "{name}");
    }
}

#[test]
fn create_user_without_users_manage_forbidden() {
    let fixture = fixture();
    sign_in_as(&fixture, "recepcion");

    let error = call_create_user(&fixture, "nueva", PASSWORD, RECEPTION_ROLE).unwrap_err();

    assert_eq!(error, AppError::forbidden());
    assert_eq!(users_count(&fixture), 3);
    assert!(audit_actions(&fixture).is_empty());
}

#[test]
fn every_user_command_without_users_manage_forbidden() {
    let fixture = fixture();
    sign_in_as(&fixture, "lectura");

    assert_every_command_fails_with(&fixture, AppErrorCode::Forbidden);

    assert_eq!(users_count(&fixture), 3);
    assert!(audit_actions(&fixture).is_empty());
}

#[test]
fn every_user_command_without_session_is_unauthenticated() {
    let fixture = fixture();

    assert_every_command_fails_with(&fixture, AppErrorCode::Unauthenticated);

    assert_eq!(users_count(&fixture), 3);
}

#[test]
fn locked_session_cannot_manage_users() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");
    session(&fixture).force_lock().unwrap();

    assert_every_command_fails_with(&fixture, AppErrorCode::SessionLocked);

    assert_eq!(users_count(&fixture), 3);
}

#[test]
fn deactivated_user_cannot_login() {
    let fixture = fixture();
    call_login(&fixture, "recepcion", PASSWORD).unwrap();
    sign_in_as(&fixture, "propietaria");

    call_update(&fixture, deactivation(id_of(&fixture, "recepcion"))).unwrap();
    let outcome = call_login(&fixture, "recepcion", PASSWORD);

    assert_eq!(outcome.unwrap_err().code, AppErrorCode::InvalidCredentials);
}

#[test]
fn deactivating_the_only_administrator_is_rejected_through_the_command() {
    let fixture = fixture();
    let owner = sign_in_as(&fixture, "propietaria");

    let error = call_update(&fixture, deactivation(owner.id)).unwrap_err();

    assert_eq!(error.code, AppErrorCode::Validation);
    assert_eq!(error.field.as_deref(), Some("active"));
    call_login(&fixture, "propietaria", PASSWORD).unwrap();
}
