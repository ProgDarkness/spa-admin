use super::tests::{
    audit_rows, break_audit, fixture, run, seed, user_of, Fixture, OWNER_ROLE, RECEPTION_ROLE,
};
use super::*;
use crate::features::users::repository;

fn grant(role_id: i64, permissions: &[PermissionKey]) -> RolePermissionsUpdate {
    RolePermissionsUpdate {
        role_id,
        permissions: permissions.to_vec(),
    }
}

fn new_role(name: &str, permissions: &[PermissionKey]) -> NewRole {
    NewRole {
        name: name.to_string(),
        permissions: permissions.to_vec(),
    }
}

fn role_of(fixture: &Fixture, id: i64) -> RoleSummary {
    fixture
        .database
        .with_conn(|conn| repository::find_role(conn, id))
        .unwrap()
        .unwrap()
}

fn managing_role(fixture: &Fixture, actor: i64, name: &str) -> i64 {
    run(fixture, |conn| {
        create_role(conn, actor, &new_role(name, &[PermissionKey::UsersManage]))
    })
    .unwrap()
    .id
}

#[test]
fn create_role_dedups_permissions() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);

    let role = run(&fixture, |conn| {
        create_role(
            conn,
            actor,
            &new_role(
                "  Caja ",
                &[
                    PermissionKey::PaymentsRead,
                    PermissionKey::ClientsRead,
                    PermissionKey::PaymentsRead,
                    PermissionKey::ClientsRead,
                ],
            ),
        )
    })
    .unwrap();

    assert_eq!(role.name, "Caja");
    assert_eq!(
        role.permissions,
        vec![PermissionKey::ClientsRead, PermissionKey::PaymentsRead]
    );
    assert_eq!(role.user_count, 0);
    let stored: i64 = fixture
        .database
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT count(*) FROM role_permissions WHERE role_id = ?1",
                [role.id],
                |row| row.get(0),
            )?)
        })
        .unwrap();
    assert_eq!(stored, 2);
}

#[test]
fn create_role_audited_with_created_diff() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);

    let role = run(&fixture, |conn| {
        create_role(
            conn,
            actor,
            &new_role("Caja", &[PermissionKey::PaymentsRead]),
        )
    })
    .unwrap();

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action.as_str(), "role_created");
    assert_eq!(rows[0].entity.as_str(), "role");
    assert_eq!(rows[0].entity_id, Some(role.id));
    assert_eq!(rows[0].actor_user_id, Some(actor));
    let diff: serde_json::Value = serde_json::from_str(rows[0].diff.as_ref().unwrap()).unwrap();
    assert_eq!(diff["name"], "Caja");
    assert_eq!(diff["permissions"][0], "payments.read");
}

#[test]
fn role_name_validation() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);

    let blank = run(&fixture, |conn| {
        create_role(conn, actor, &new_role("  ", &[]))
    });
    let duplicate = run(&fixture, |conn| {
        create_role(conn, actor, &new_role("RECEPCIÓN", &[]))
    });
    let oversized = run(&fixture, |conn| {
        create_role(conn, actor, &new_role(&"r".repeat(65), &[]))
    });

    for outcome in [blank, duplicate, oversized] {
        assert!(matches!(
            outcome,
            Err(UsersError::Validation { field: "name" })
        ));
    }
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn set_role_permissions_audited_with_diff() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);

    let role = run(&fixture, |conn| {
        set_role_permissions(
            conn,
            actor,
            &grant(
                RECEPTION_ROLE,
                &[
                    PermissionKey::ClientsRead,
                    PermissionKey::ClientsRead,
                    PermissionKey::AuditRead,
                ],
            ),
        )
    })
    .unwrap();

    assert_eq!(
        role.permissions,
        vec![PermissionKey::ClientsRead, PermissionKey::AuditRead]
    );
    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action.as_str(), "role_permissions_changed");
    assert_eq!(rows[0].entity.as_str(), "role");
    assert_eq!(rows[0].entity_id, Some(RECEPTION_ROLE));
    let diff: serde_json::Value = serde_json::from_str(rows[0].diff.as_ref().unwrap()).unwrap();
    let before = diff["permissions"]["before"].as_array().unwrap();
    let after = diff["permissions"]["after"].as_array().unwrap();
    assert!(before.iter().any(|key| key == "payments.write"));
    assert_eq!(after.len(), 2);
    assert_eq!(after[1], "audit.read");
}

#[test]
fn set_role_permissions_without_changes_writes_no_audit_row() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);
    let current = role_of(&fixture, RECEPTION_ROLE).permissions;

    run(&fixture, |conn| {
        set_role_permissions(conn, actor, &grant(RECEPTION_ROLE, &current))
    })
    .unwrap();

    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn unknown_role_permissions_update_is_validation() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);

    let outcome = run(&fixture, |conn| {
        set_role_permissions(conn, actor, &grant(999, &[PermissionKey::ClientsRead]))
    });

    assert!(matches!(
        outcome,
        Err(UsersError::Validation { field: "roleId" })
    ));
}

#[test]
fn owner_role_cannot_lose_users_manage() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);
    seed(&fixture, "segunda", OWNER_ROLE);
    let without_manage: Vec<PermissionKey> = PermissionKey::ALL
        .into_iter()
        .filter(|key| *key != PermissionKey::UsersManage)
        .collect();

    let outcome = run(&fixture, |conn| {
        set_role_permissions(conn, actor, &grant(OWNER_ROLE, &without_manage))
    });

    assert!(matches!(
        outcome,
        Err(UsersError::Validation {
            field: "permissions"
        })
    ));
    assert!(role_of(&fixture, OWNER_ROLE)
        .permissions
        .contains(&PermissionKey::UsersManage));
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn strip_users_manage_from_last_admin_role_rejected() {
    let fixture = fixture();
    let owner = seed(&fixture, "duena", OWNER_ROLE);
    let managers = managing_role(&fixture, owner, "Gerencia");
    let manager = seed(&fixture, "gerente", managers);
    run(&fixture, |conn| {
        update_user(
            conn,
            owner,
            &UserUpdate {
                id: owner,
                username: None,
                role_id: None,
                active: Some(false),
            },
        )
    })
    .unwrap();

    let outcome = run(&fixture, |conn| {
        set_role_permissions(
            conn,
            manager,
            &grant(managers, &[PermissionKey::ClientsRead]),
        )
    });

    assert!(matches!(
        outcome,
        Err(UsersError::LastAdmin {
            field: "permissions"
        })
    ));
    assert_eq!(
        role_of(&fixture, managers).permissions,
        vec![PermissionKey::UsersManage]
    );
    assert!(user_of(&fixture, manager).active);
}

#[test]
fn stripping_users_manage_from_a_role_is_allowed_while_another_admin_remains() {
    let fixture = fixture();
    let owner = seed(&fixture, "duena", OWNER_ROLE);
    let managers = managing_role(&fixture, owner, "Gerencia");
    seed(&fixture, "gerente", managers);

    let outcome = run(&fixture, |conn| {
        set_role_permissions(conn, owner, &grant(managers, &[PermissionKey::ClientsRead]))
    });

    assert!(outcome.is_ok());
}

#[test]
fn role_audit_failure_rolls_back() {
    let fixture = fixture();
    let actor = seed(&fixture, "duena", OWNER_ROLE);
    let before = role_of(&fixture, RECEPTION_ROLE);
    break_audit(&fixture);

    let created = run(&fixture, |conn| {
        create_role(
            conn,
            actor,
            &new_role("Caja", &[PermissionKey::ClientsRead]),
        )
    });
    let changed = run(&fixture, |conn| {
        set_role_permissions(conn, actor, &grant(RECEPTION_ROLE, &[]))
    });

    assert!(matches!(created, Err(UsersError::Db(_))));
    assert!(matches!(changed, Err(UsersError::Db(_))));
    assert_eq!(role_of(&fixture, RECEPTION_ROLE), before);
    let roles = fixture.database.with_conn(repository::list_roles).unwrap();
    assert_eq!(roles.len(), 3);
}
