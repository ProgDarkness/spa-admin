use std::sync::Arc;

use tauri::{Manager, State};

use super::tests::{
    audit_actions, call_create_user, call_reset, database, fixture, id_of, sign_in_as, users_count,
    Fixture, NEW_PASSWORD, PASSWORD, RECEPTION_ROLE,
};
use super::*;
use crate::errors::AppErrorCode;
use crate::features::auth::password::{PasswordPolicy, MAX_CONCURRENT_OPERATIONS};
use crate::features::auth::service::SessionState;

const CASHIER: &str = "cajera";

#[derive(Clone, Copy)]
struct Actor {
    id: i64,
    role_id: i64,
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

fn during_the_hash<T>(
    fixture: &Fixture,
    command: impl FnOnce() -> T,
    meanwhile: impl FnOnce(&Database, &SessionState) + Send,
) -> T {
    let policy: State<'_, Arc<PasswordPolicy>> = fixture.app.state();
    let db: State<'_, Database> = fixture.app.state();
    let sessions: State<'_, SessionState> = fixture.app.state();
    let permits: Vec<_> = (0..MAX_CONCURRENT_OPERATIONS)
        .map(|_| policy.slots.acquire())
        .collect();
    std::thread::scope(|scope| {
        scope.spawn(|| {
            policy.slots.wait_until_waiting(1);
            meanwhile(&db, &sessions);
            drop(permits);
        });
        command()
    })
}

fn cashier(fixture: &Fixture) -> Actor {
    let role = create_role(
        NewRole {
            name: "Caja".into(),
            permissions: vec![PermissionKey::UsersManage],
        },
        fixture.app.state(),
        fixture.app.state(),
    )
    .unwrap();
    let created = call_create_user(fixture, CASHIER, PASSWORD, role.id).unwrap();
    Actor {
        id: created.id,
        role_id: role.id,
    }
}

fn revoke_users_manage(db: &Database, actor: Actor) {
    db.with_tx(|tx| {
        repository::replace_role_permissions(tx, actor.role_id, &[PermissionKey::CatalogRead])
    })
    .unwrap();
}

fn deactivate(db: &Database, actor: Actor) {
    db.with_conn(|conn| {
        conn.execute("UPDATE users SET active = 0 WHERE id = ?1", [actor.id])?;
        Ok(())
    })
    .unwrap();
}

struct Revocation {
    label: &'static str,
    expected: AppErrorCode,
    apply: fn(&Database, &SessionState, Actor),
}

const REVOCATIONS: [Revocation; 4] = [
    Revocation {
        label: "session ended",
        expected: AppErrorCode::Unauthenticated,
        apply: |_, sessions, _| {
            sessions.end().unwrap();
        },
    },
    Revocation {
        label: "session locked",
        expected: AppErrorCode::SessionLocked,
        apply: |_, sessions, _| sessions.force_lock().unwrap(),
    },
    Revocation {
        label: "permission revoked",
        expected: AppErrorCode::Forbidden,
        apply: |db, _, actor| revoke_users_manage(db, actor),
    },
    Revocation {
        label: "actor deactivated",
        expected: AppErrorCode::Unauthenticated,
        apply: |db, _, actor| deactivate(db, actor),
    },
];

fn fixture_signed_in_as_cashier() -> (Fixture, Actor) {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria");
    let actor = cashier(&fixture);
    sign_in_as(&fixture, CASHIER);
    (fixture, actor)
}

#[test]
fn create_user_fails_and_writes_nothing_when_authorization_is_lost_during_the_hash() {
    for revocation in REVOCATIONS {
        let (fixture, actor) = fixture_signed_in_as_cashier();
        let users_before = users_count(&fixture);
        let audit_before = audit_actions(&fixture);

        let outcome = during_the_hash(
            &fixture,
            || call_create_user(&fixture, "nueva", PASSWORD, RECEPTION_ROLE),
            |db, sessions| (revocation.apply)(db, sessions, actor),
        );

        let error = outcome.expect_err(revocation.label);
        assert_eq!(error.code, revocation.expected, "{}", revocation.label);
        assert_eq!(users_count(&fixture), users_before, "{}", revocation.label);
        assert_eq!(
            audit_actions(&fixture),
            audit_before,
            "{}",
            revocation.label
        );
    }
}

#[test]
fn reset_password_fails_and_writes_nothing_when_authorization_is_lost_during_the_hash() {
    for revocation in REVOCATIONS {
        let (fixture, actor) = fixture_signed_in_as_cashier();
        let target = id_of(&fixture, "lectura");
        let hash_before = stored_hash(&fixture, target);
        let audit_before = audit_actions(&fixture);

        let outcome = during_the_hash(
            &fixture,
            || call_reset(&fixture, target, NEW_PASSWORD),
            |db, sessions| (revocation.apply)(db, sessions, actor),
        );

        let error = outcome.expect_err(revocation.label);
        assert_eq!(error.code, revocation.expected, "{}", revocation.label);
        assert_eq!(
            stored_hash(&fixture, target),
            hash_before,
            "{}",
            revocation.label
        );
        assert_eq!(
            audit_actions(&fixture),
            audit_before,
            "{}",
            revocation.label
        );
    }
}

#[test]
fn authorization_kept_through_the_hash_still_completes_both_commands() {
    let (fixture, _) = fixture_signed_in_as_cashier();
    let target = id_of(&fixture, "lectura");

    let created = during_the_hash(
        &fixture,
        || call_create_user(&fixture, "nueva", PASSWORD, RECEPTION_ROLE),
        |_, _| {},
    );
    let reset = during_the_hash(
        &fixture,
        || call_reset(&fixture, target, NEW_PASSWORD),
        |_, _| {},
    );

    assert_eq!(created.unwrap().username, "nueva");
    assert!(reset.is_ok());
}
