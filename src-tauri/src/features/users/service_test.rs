use rusqlite::Connection;

use super::*;
use crate::db::{migrate, Database};
use crate::features::audit::repository::list_all;
use crate::features::audit::AuditEntry;
use crate::features::auth::service::AuthError;
use crate::features::users::repository::{self, NewUserRow};

pub(super) const OWNER_ROLE: i64 = 1;
pub(super) const RECEPTION_ROLE: i64 = 2;
pub(super) const READ_ONLY_ROLE: i64 = 3;
pub(super) const SECRET: &str = "clave-secreta-9X";
const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";

pub(super) struct Fixture {
    pub(super) database: Database,
}

pub(super) fn fixture() -> Fixture {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    Fixture {
        database: Database::new(conn),
    }
}

pub(super) fn seed(fixture: &Fixture, username: &str, role_id: i64) -> i64 {
    let row = NewUserRow {
        username: username.to_string(),
        password_hash: "hash-opaco".to_string(),
        role_id,
    };
    fixture
        .database
        .with_conn(|conn| repository::insert_user(conn, &row, None))
        .unwrap()
}

pub(super) fn run<T>(
    fixture: &Fixture,
    operation: impl FnOnce(&Connection) -> Result<T, UsersError>,
) -> Result<T, UsersError> {
    fixture.database.with_tx(|tx| operation(tx))
}

pub(super) fn audit_rows(fixture: &Fixture) -> Vec<AuditEntry> {
    fixture.database.with_conn(list_all).unwrap()
}

pub(super) fn user_of(fixture: &Fixture, id: i64) -> UserSummary {
    fixture
        .database
        .with_conn(|conn| repository::find_user(conn, id))
        .unwrap()
        .unwrap()
}

pub(super) fn break_audit(fixture: &Fixture) {
    fixture
        .database
        .with_conn(|conn| {
            conn.execute_batch(FAIL_AUDIT_INSERTS)?;
            Ok(())
        })
        .unwrap();
}

fn update(id: i64) -> UserUpdate {
    UserUpdate {
        id,
        username: None,
        role_id: None,
        active: None,
    }
}

fn new_row(username: &str, role_id: i64) -> NewUserRow {
    NewUserRow {
        username: username.to_string(),
        password_hash: "hash-argon2-simulado".to_string(),
        role_id,
    }
}

fn is_field(error: UsersError, expected: &str) -> bool {
    matches!(error, UsersError::Validation { field } if field == expected)
}

fn is_last_admin(error: UsersError, expected: &str) -> bool {
    matches!(error, UsersError::LastAdmin { field } if field == expected)
}

#[test]
fn create_user_audited_without_password_hash() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);

    let created = run(&fixture, |conn| {
        create_user(conn, actor, &new_row("Ana", RECEPTION_ROLE))
    })
    .unwrap();

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action.as_str(), "user_created");
    assert_eq!(rows[0].entity.as_str(), "user");
    assert_eq!(rows[0].entity_id, Some(created.id));
    assert_eq!(rows[0].actor_user_id, Some(actor));
    let diff: serde_json::Value = serde_json::from_str(rows[0].diff.as_ref().unwrap()).unwrap();
    assert_eq!(diff["username"], "Ana");
    assert_eq!(diff["roleId"], RECEPTION_ROLE);
    assert_eq!(diff["active"], true);
    assert!(!format!("{rows:?}").contains("hash-argon2-simulado"));
    assert_eq!(created.username, "Ana");
}

#[test]
fn validated_new_user_normalizes_username_and_takes_password() {
    let mut input = NewUserInput {
        username: "  Ana  ".into(),
        password: SECRET.into(),
        role_id: RECEPTION_ROLE,
    };

    let validated = validated_new_user(&mut input).unwrap();

    assert_eq!(validated.username, "Ana");
    assert_eq!(validated.password.as_str(), SECRET);
    assert_eq!(validated.role_id, RECEPTION_ROLE);
    assert!(input.password.is_empty());
}

#[test]
fn weak_password_rejected() {
    let mut input = NewUserInput {
        username: "ana".into(),
        password: "corta".into(),
        role_id: RECEPTION_ROLE,
    };
    let mut reset = PasswordReset {
        user_id: 1,
        new_password: "corta".into(),
    };

    let created = validated_new_user(&mut input).err().unwrap();
    let reseted = validated_reset(&mut reset).err().unwrap();

    assert!(matches!(
        created,
        UsersError::Auth(AuthError::Validation("password"))
    ));
    assert!(matches!(
        reseted,
        UsersError::Auth(AuthError::Validation("password"))
    ));
}

#[test]
fn blank_or_oversized_username_is_validation() {
    for username in ["   ".to_string(), "x".repeat(65)] {
        let mut input = NewUserInput {
            username,
            password: SECRET.into(),
            role_id: RECEPTION_ROLE,
        };
        let error = validated_new_user(&mut input).err().unwrap();
        assert!(is_field(error, "username"));
    }
}

#[test]
fn duplicate_username_nocase_validation() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);
    let other = seed(&fixture, "Ana", RECEPTION_ROLE);

    let on_create = run(&fixture, |conn| {
        create_user(conn, actor, &new_row("aNA", RECEPTION_ROLE))
    })
    .unwrap_err();
    let on_rename = run(&fixture, |conn| {
        update_user(
            conn,
            actor,
            &UserUpdate {
                username: Some("DUENA".into()),
                ..update(other)
            },
        )
    })
    .unwrap_err();

    assert!(is_field(on_create, "username"));
    assert!(is_field(on_rename, "username"));
    assert_eq!(audit_rows(&fixture).len(), 0);
}

#[test]
fn renaming_to_own_name_with_other_casing_is_allowed() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);

    let renamed = run(&fixture, |conn| {
        update_user(
            conn,
            actor,
            &UserUpdate {
                username: Some("Duena".into()),
                ..update(actor)
            },
        )
    })
    .unwrap();

    assert_eq!(renamed.username, "Duena");
}

#[test]
fn unknown_role_validation() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);
    let target = seed(&fixture, "ana", RECEPTION_ROLE);

    let on_create = run(&fixture, |conn| {
        create_user(conn, actor, &new_row("nueva", 999))
    })
    .unwrap_err();
    let on_update = run(&fixture, |conn| {
        update_user(
            conn,
            actor,
            &UserUpdate {
                role_id: Some(999),
                ..update(target)
            },
        )
    })
    .unwrap_err();

    assert!(is_field(on_create, "roleId"));
    assert!(is_field(on_update, "roleId"));
}

#[test]
fn unknown_user_validation() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);

    let on_update = run(&fixture, |conn| update_user(conn, actor, &update(999))).unwrap_err();
    let on_reset = run(&fixture, |conn| reset_password(conn, actor, 999, "hash")).unwrap_err();

    assert!(is_field(on_update, "userId"));
    assert!(is_field(on_reset, "userId"));
}

#[test]
fn user_update_audited_with_diff_before_after() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);
    let target = seed(&fixture, "ana", RECEPTION_ROLE);

    let updated = run(&fixture, |conn| {
        update_user(
            conn,
            actor,
            &UserUpdate {
                id: target,
                username: Some("ana2".into()),
                role_id: Some(READ_ONLY_ROLE),
                active: Some(false),
            },
        )
    })
    .unwrap();

    assert_eq!(updated.role_name, "Solo lectura");
    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action.as_str(), "user_updated");
    assert_eq!(rows[0].actor_user_id, Some(actor));
    assert_eq!(rows[0].entity_id, Some(target));
    let diff: serde_json::Value = serde_json::from_str(rows[0].diff.as_ref().unwrap()).unwrap();
    assert_eq!(diff["username"]["before"], "ana");
    assert_eq!(diff["username"]["after"], "ana2");
    assert_eq!(diff["roleId"]["before"], RECEPTION_ROLE);
    assert_eq!(diff["roleId"]["after"], READ_ONLY_ROLE);
    assert_eq!(diff["active"]["before"], true);
    assert_eq!(diff["active"]["after"], false);
}

#[test]
fn reactivation_is_audited_as_user_updated_with_active_diff() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);
    let target = seed(&fixture, "ana", RECEPTION_ROLE);
    let toggle = |active| UserUpdate {
        active: Some(active),
        ..update(target)
    };

    run(&fixture, |conn| update_user(conn, actor, &toggle(false))).unwrap();
    run(&fixture, |conn| update_user(conn, actor, &toggle(true))).unwrap();

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 2);
    let diff: serde_json::Value = serde_json::from_str(rows[1].diff.as_ref().unwrap()).unwrap();
    assert_eq!(diff["active"]["before"], false);
    assert_eq!(diff["active"]["after"], true);
    assert!(user_of(&fixture, target).active);
}

#[test]
fn update_without_changes_writes_no_audit_row() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);
    let target = seed(&fixture, "ana", RECEPTION_ROLE);

    let unchanged = run(&fixture, |conn| {
        update_user(
            conn,
            actor,
            &UserUpdate {
                active: Some(true),
                role_id: Some(RECEPTION_ROLE),
                ..update(target)
            },
        )
    })
    .unwrap();

    assert_eq!(unchanged.username, "ana");
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn deactivate_last_admin_rejected_and_rolled_back() {
    let fixture = fixture();
    let admin = seed(&fixture, "duena", OWNER_ROLE);
    seed(&fixture, "ana", RECEPTION_ROLE);

    let error = run(&fixture, |conn| {
        update_user(
            conn,
            admin,
            &UserUpdate {
                active: Some(false),
                ..update(admin)
            },
        )
    })
    .unwrap_err();

    assert!(is_last_admin(error, "active"));
    assert!(user_of(&fixture, admin).active);
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn demote_last_admin_rejected() {
    let fixture = fixture();
    let admin = seed(&fixture, "duena", OWNER_ROLE);

    let error = run(&fixture, |conn| {
        update_user(
            conn,
            admin,
            &UserUpdate {
                role_id: Some(RECEPTION_ROLE),
                ..update(admin)
            },
        )
    })
    .unwrap_err();

    assert!(is_last_admin(error, "roleId"));
    assert_eq!(user_of(&fixture, admin).role_id, OWNER_ROLE);
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn deactivate_non_last_admin_allowed() {
    let fixture = fixture();
    let first = seed(&fixture, "duena", OWNER_ROLE);
    let second = seed(&fixture, "segunda", OWNER_ROLE);

    let own_demotion = run(&fixture, |conn| {
        update_user(
            conn,
            first,
            &UserUpdate {
                role_id: Some(RECEPTION_ROLE),
                ..update(first)
            },
        )
    });
    let blocked = run(&fixture, |conn| {
        update_user(
            conn,
            second,
            &UserUpdate {
                active: Some(false),
                ..update(second)
            },
        )
    });

    assert!(own_demotion.is_ok());
    assert!(is_last_admin(blocked.unwrap_err(), "active"));
}

#[test]
fn deactivated_admin_does_not_count_so_the_remaining_one_is_protected() {
    let fixture = fixture();
    let first = seed(&fixture, "duena", OWNER_ROLE);
    let second = seed(&fixture, "segunda", OWNER_ROLE);

    run(&fixture, |conn| {
        update_user(
            conn,
            first,
            &UserUpdate {
                active: Some(false),
                ..update(second)
            },
        )
    })
    .unwrap();
    let error = run(&fixture, |conn| {
        update_user(
            conn,
            first,
            &UserUpdate {
                role_id: Some(READ_ONLY_ROLE),
                ..update(first)
            },
        )
    })
    .unwrap_err();

    assert!(is_last_admin(error, "roleId"));
}

#[test]
fn reset_password_replaces_hash_and_audits_without_diff() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);
    let target = seed(&fixture, "ana", RECEPTION_ROLE);

    run(&fixture, |conn| {
        reset_password(conn, actor, target, "hash-nuevo-simulado")
    })
    .unwrap();

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action.as_str(), "password_reset");
    assert_eq!(rows[0].entity.as_str(), "user");
    assert_eq!(rows[0].entity_id, Some(target));
    assert_eq!(rows[0].actor_user_id, Some(actor));
    assert_eq!(rows[0].diff, None);
    assert!(!format!("{rows:?}").contains("hash-nuevo-simulado"));
}

#[test]
fn audit_failure_rolls_back_mutation() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);
    let target = seed(&fixture, "ana", RECEPTION_ROLE);
    break_audit(&fixture);

    let created = run(&fixture, |conn| {
        create_user(conn, actor, &new_row("nueva", RECEPTION_ROLE))
    });
    let updated = run(&fixture, |conn| {
        update_user(
            conn,
            actor,
            &UserUpdate {
                role_id: Some(READ_ONLY_ROLE),
                ..update(target)
            },
        )
    });
    let reseted = run(&fixture, |conn| reset_password(conn, actor, target, "h"));

    assert!(matches!(created, Err(UsersError::Db(_))));
    assert!(matches!(updated, Err(UsersError::Db(_))));
    assert!(matches!(reseted, Err(UsersError::Db(_))));
    assert_eq!(user_of(&fixture, target).role_id, RECEPTION_ROLE);
    let users = fixture.database.with_conn(repository::list_users).unwrap();
    assert_eq!(users.len(), 2);
}

#[test]
fn hidden_characters_in_username_are_validation() {
    for username in ["an\u{200B}a", "an\u{202E}a", "an\u{0007}a", "an\u{00A0}a"] {
        let mut input = NewUserInput {
            username: username.to_string(),
            password: SECRET.into(),
            role_id: RECEPTION_ROLE,
        };
        let error = validated_new_user(&mut input).err().unwrap();
        assert!(is_field(error, "username"), "{username:?}");
    }
}

#[test]
fn duplicate_username_with_unicode_case_or_normalization_is_validation() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);
    let other = seed(&fixture, "\u{00F3}scar", RECEPTION_ROLE);

    let on_create = run(&fixture, |conn| {
        create_user(conn, actor, &new_row("\u{00D3}SCAR", RECEPTION_ROLE))
    })
    .unwrap_err();
    let on_rename = run(&fixture, |conn| {
        update_user(
            conn,
            actor,
            &UserUpdate {
                username: Some("DUE\u{00D1}A".into()),
                ..update(actor)
            },
        )
    });

    assert!(is_field(on_create, "username"));
    assert!(on_rename.is_ok());
    let rename_clash = run(&fixture, |conn| {
        update_user(
            conn,
            actor,
            &UserUpdate {
                username: Some("\u{00D3}scar".into()),
                ..update(actor)
            },
        )
    })
    .unwrap_err();
    assert!(is_field(rename_clash, "username"));
    assert_eq!(user_of(&fixture, other).username, "\u{00F3}scar");
}
