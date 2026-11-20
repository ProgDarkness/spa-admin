use tauri::{Manager, State};

use super::tests::{
    audit_actions, call_create_user, call_login, call_reset, call_update, database, deactivation,
    fixture, id_of, session, sign_in_as, users_count, Fixture, NEW_PASSWORD, PASSWORD,
    READ_ONLY_ROLE, RECEPTION_ROLE,
};
use super::*;
use crate::errors::AppError;
use crate::errors::AppErrorCode;
use crate::features::audit::repository::list_all;
use crate::features::auth::model::PermissionKey;
use crate::features::auth::repository::{
    find_credentials_by_id, record_persisted_failure, UserCredentialRow,
};
use crate::features::auth::service::{require_permission, AuthError, Beat, SessionState};
use crate::features::users::repository;

const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";
const FAILURES_TO_LOCK_OUT: u32 = 5;

fn credentials_of(fixture: &Fixture, id: i64) -> UserCredentialRow {
    database(fixture)
        .with_conn(|conn| find_credentials_by_id(conn, id))
        .unwrap()
        .unwrap()
}

fn all_audit_text(fixture: &Fixture) -> String {
    let rows = database(fixture).with_conn(list_all).unwrap();
    format!("{rows:?}").to_lowercase()
}

fn stored_hash(fixture: &Fixture, id: i64) -> String {
    database(fixture)
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT password_hash FROM users WHERE id = ?1",
                [id],
                |row| row.get(0),
            )?)
        })
        .unwrap()
}

fn lock_out(fixture: &Fixture, id: i64) {
    database(fixture)
        .with_tx(|tx| -> Result<(), crate::db::DbError> {
            for _ in 0..FAILURES_TO_LOCK_OUT {
                record_persisted_failure(tx, id)?;
            }
            Ok(())
        })
        .unwrap();
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
fn create_user_audited_without_password_hash() {
    let fixture = fixture();
    let owner = sign_in_as(&fixture, "propietaria");

    let created = call_create_user(&fixture, "  Nueva ", PASSWORD, RECEPTION_ROLE).unwrap();

    assert_eq!(created.username, "Nueva");
    assert_eq!(audit_actions(&fixture), vec!["user_created"]);
    let dump = all_audit_text(&fixture);
    assert!(!dump.contains(&PASSWORD.to_lowercase()));
    assert!(!dump.contains(&stored_hash(&fixture, created.id).to_lowercase()));
    assert!(!dump.contains("argon2"));
    let row = database(&fixture).with_conn(list_all).unwrap().remove(0);
    assert_eq!(row.actor_user_id, Some(owner.id));
    call_login(&fixture, "nueva", PASSWORD).unwrap();
}

#[test]
fn weak_password_rejected() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");
    let target = id_of(&fixture, "lectura");

    let on_create = call_create_user(&fixture, "nueva", "corta", RECEPTION_ROLE).unwrap_err();
    let on_reset = call_reset(&fixture, target, "corta").unwrap_err();

    for error in [on_create, on_reset] {
        assert_eq!(error.code, AppErrorCode::Validation);
        assert_eq!(error.field.as_deref(), Some("password"));
    }
    assert_eq!(users_count(&fixture), 3);
    assert!(audit_actions(&fixture).is_empty());
}

#[test]
fn reset_password_clears_lockout_and_ends_target_session() {
    let fixture = fixture();
    let target = id_of(&fixture, "recepcion");
    sign_in_as(&fixture, "propietaria");
    lock_out(&fixture, target);
    assert!(credentials_of(&fixture, target).is_locked_out);

    call_reset(&fixture, target, NEW_PASSWORD).unwrap();

    assert!(!credentials_of(&fixture, target).is_locked_out);
    assert!(session(&fixture).locked_user_id().unwrap().is_none());
    assert_eq!(audit_actions(&fixture), vec!["password_reset"]);
    call_login(&fixture, "recepcion", NEW_PASSWORD).unwrap();
    assert_eq!(
        call_login(&fixture, "recepcion", PASSWORD)
            .unwrap_err()
            .code,
        AppErrorCode::InvalidCredentials
    );
    assert!(!all_audit_text(&fixture).contains(&NEW_PASSWORD.to_lowercase()));
}

#[test]
fn reset_password_of_the_session_user_ends_that_session() {
    let fixture = fixture();
    let owner = sign_in_as(&fixture, "propietaria");

    call_reset(&fixture, owner.id, NEW_PASSWORD).unwrap();

    let after = list_users(fixture.app.state(), fixture.app.state()).unwrap_err();
    assert_eq!(after.code, AppErrorCode::Unauthenticated);
}

#[test]
fn reset_password_of_another_user_keeps_the_actor_session() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");

    call_reset(&fixture, id_of(&fixture, "lectura"), NEW_PASSWORD).unwrap();

    assert!(list_users(fixture.app.state(), fixture.app.state()).is_ok());
}

#[test]
fn audit_failure_rolls_back_mutation() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");
    let target = id_of(&fixture, "lectura");
    let hash_before = stored_hash(&fixture, target);
    break_audit(&fixture);

    let created = call_create_user(&fixture, "nueva", PASSWORD, RECEPTION_ROLE).unwrap_err();
    let updated = call_update(&fixture, deactivation(target)).unwrap_err();
    let reset = call_reset(&fixture, target, NEW_PASSWORD).unwrap_err();

    for error in [created, updated, reset] {
        assert_eq!(error, AppError::internal());
    }
    assert_eq!(users_count(&fixture), 3);
    assert_eq!(stored_hash(&fixture, target), hash_before);
    let users = list_users(fixture.app.state(), fixture.app.state()).unwrap();
    assert!(users.iter().all(|user| user.active));
}

#[test]
fn list_roles_counts_users() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");
    call_create_user(&fixture, "otra", PASSWORD, RECEPTION_ROLE).unwrap();

    let roles = list_roles(fixture.app.state(), fixture.app.state()).unwrap();

    let counts: Vec<i64> = roles.iter().map(|role| role.user_count).collect();
    assert_eq!(counts, vec![1, 2, 1]);
}

#[test]
fn list_users_returns_all_accounts_without_hashes() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");

    let users = list_users(fixture.app.state(), fixture.app.state()).unwrap();

    assert_eq!(users.len(), 3);
    assert!(!serde_json::to_string(&users).unwrap().contains("argon2"));
}

#[test]
fn role_without_catalog_write_lacks_permission() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");
    let role = create_role(
        NewRole {
            name: "Caja".into(),
            permissions: vec![PermissionKey::CatalogRead, PermissionKey::UsersManage],
        },
        fixture.app.state(),
        fixture.app.state(),
    )
    .unwrap();
    call_create_user(&fixture, "cajera", PASSWORD, role.id).unwrap();
    let probe = |permission| {
        sign_in_as(&fixture, "cajera");
        let state: State<'_, SessionState> = session(&fixture);
        database(&fixture)
            .with_conn(|conn| Ok(require_permission(conn, &state, permission, Beat::now())))
            .unwrap()
    };

    let denied = probe(PermissionKey::CatalogWrite);
    sign_in_as(&fixture, "propietaria");
    set_role_permissions(
        RolePermissionsUpdate {
            role_id: role.id,
            permissions: vec![PermissionKey::CatalogWrite, PermissionKey::UsersManage],
        },
        fixture.app.state(),
        fixture.app.state(),
    )
    .unwrap();
    let granted = probe(PermissionKey::CatalogWrite);

    assert!(matches!(denied, Err(AuthError::Forbidden)));
    assert!(granted.is_ok());
}

#[test]
fn set_role_permissions_audited_with_diff() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");

    let role = set_role_permissions(
        RolePermissionsUpdate {
            role_id: READ_ONLY_ROLE,
            permissions: vec![PermissionKey::ClientsRead, PermissionKey::AuditRead],
        },
        fixture.app.state(),
        fixture.app.state(),
    )
    .unwrap();

    assert_eq!(role.permissions.len(), 2);
    assert_eq!(audit_actions(&fixture), vec!["role_permissions_changed"]);
    let row = database(&fixture).with_conn(list_all).unwrap().remove(0);
    assert!(row.diff.unwrap().contains("audit.read"));
    let stored = database(&fixture)
        .with_conn(|conn| repository::find_role(conn, READ_ONLY_ROLE))
        .unwrap()
        .unwrap();
    assert_eq!(stored, role);
}
