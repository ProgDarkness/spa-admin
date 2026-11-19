use rusqlite::Connection;

use super::*;
use crate::db::migrate;

const FRONTEND_KEYS: [&str; 15] = [
    "clients.read",
    "clients.write",
    "catalog.read",
    "catalog.write",
    "resources.manage",
    "appointments.read",
    "appointments.write",
    "appointments.reopen",
    "payments.read",
    "payments.write",
    "rates.manage",
    "metrics.read",
    "audit.read",
    "users.manage",
    "backup.manage",
];

fn migrated_permission_keys() -> Vec<String> {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate(&mut conn).unwrap();
    let mut statement = conn
        .prepare("SELECT key FROM permissions ORDER BY rowid")
        .unwrap();
    let keys = statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    keys
}

#[test]
fn all_matches_frontend_order() {
    let keys: Vec<&str> = PermissionKey::ALL.iter().map(|key| key.as_str()).collect();
    assert_eq!(keys, FRONTEND_KEYS);
}

#[test]
fn all_matches_migration_permissions_in_order() {
    let keys: Vec<&str> = PermissionKey::ALL.iter().map(|key| key.as_str()).collect();
    assert_eq!(keys, migrated_permission_keys());
}

#[test]
fn parse_and_as_str_roundtrip_for_every_key() {
    for key in PermissionKey::ALL {
        assert_eq!(PermissionKey::parse(key.as_str()), Some(key));
    }
}

#[test]
fn parse_rejects_unknown_and_malformed_keys() {
    assert_eq!(PermissionKey::parse("clients.delete"), None);
    assert_eq!(PermissionKey::parse(""), None);
    assert_eq!(PermissionKey::parse("Clients.Read"), None);
}

#[test]
fn permission_key_serializes_to_dotted_name_and_back() {
    let value = serde_json::to_value(PermissionKey::ClientsRead).unwrap();
    assert_eq!(value, "clients.read");
    let parsed: PermissionKey = serde_json::from_value(value).unwrap();
    assert_eq!(parsed, PermissionKey::ClientsRead);
}

#[test]
fn every_variant_serializes_to_its_as_str() {
    for key in PermissionKey::ALL {
        assert_eq!(serde_json::to_value(key).unwrap(), key.as_str());
    }
}

#[test]
fn session_user_serializes_camel_case() {
    let user = SessionUser {
        id: 7,
        username: "ana".to_string(),
        role_name: "Recepción".to_string(),
        permissions: vec![PermissionKey::ClientsRead],
    };
    let value = serde_json::to_value(user).unwrap();
    assert_eq!(value["roleName"], "Recepción");
    assert_eq!(value["permissions"][0], "clients.read");
    assert!(value.get("role_name").is_none());
}

#[test]
fn login_credentials_deserialize_from_camel_case_payload() {
    let credentials: LoginCredentials =
        serde_json::from_str(r#"{"username":"ana","password":"secreto"}"#).unwrap();
    assert_eq!(credentials.username, "ana");
    assert_eq!(credentials.password, "secreto");
}

#[test]
fn wipe_clears_the_password() {
    let mut credentials = LoginCredentials {
        username: "ana".to_string(),
        password: "secreto".to_string(),
    };
    credentials.wipe();
    assert!(credentials.password.is_empty());
    assert_eq!(credentials.username, "ana");
}

#[test]
fn unlock_credentials_wipe_clears_the_password() {
    let mut credentials = UnlockCredentials {
        password: "secreto".to_string(),
    };
    credentials.wipe();
    assert!(credentials.password.is_empty());
}

#[test]
fn unlock_credentials_deserialize_from_a_password_only_payload() {
    let credentials: UnlockCredentials =
        serde_json::from_value(serde_json::json!({ "password": "secreto" })).unwrap();
    assert_eq!(credentials.password, "secreto");
}

#[test]
fn session_view_serializes_status_in_camel_case_and_locked_has_no_user() {
    let user = SessionUser {
        id: 1,
        username: "ana".to_string(),
        role_name: "Recepción".to_string(),
        permissions: vec![PermissionKey::ClientsRead],
    };
    let active = serde_json::to_value(SessionView::active(user)).unwrap();
    let locked = serde_json::to_value(SessionView::locked()).unwrap();

    assert_eq!(active["status"], "active");
    assert_eq!(active["user"]["username"], "ana");
    assert_eq!(locked["status"], "locked");
    assert_eq!(locked["user"], serde_json::json!(null));
}

#[test]
fn owner_setup_deserializes_and_wipe_clears_the_password() {
    let mut setup: OwnerSetup =
        serde_json::from_value(serde_json::json!({ "username": "ana", "password": "secreto" }))
            .unwrap();
    assert_eq!(setup.username, "ana");
    setup.wipe();
    assert!(setup.password.is_empty());
    assert_eq!(setup.username, "ana");
}

#[test]
fn owner_setup_take_password_leaves_nothing_behind() {
    let mut setup = OwnerSetup {
        username: "ana".to_string(),
        password: "secreto".to_string(),
    };
    let taken = setup.take_password();
    assert_eq!(taken.as_str(), "secreto");
    assert!(setup.password.is_empty());
}

#[test]
fn setup_status_and_owner_result_serialize_camel_case() {
    let status = serde_json::to_value(SetupStatus {
        needs_owner: true,
        clock_rollback: None,
    })
    .unwrap();
    assert_eq!(status["needsOwner"], true);
    assert_eq!(status["clockRollback"], serde_json::json!(null));

    let rollback = serde_json::to_value(ClockRollback {
        last_recorded_at: "2026-01-01T10:00:00".to_string(),
        detected_at: "2025-01-01T10:00:00".to_string(),
    })
    .unwrap();
    assert_eq!(rollback["lastRecordedAt"], "2026-01-01T10:00:00");
    assert_eq!(rollback["detectedAt"], "2025-01-01T10:00:00");
}

#[test]
fn owner_setup_result_serializes_code_but_debug_redacts_it() {
    let result = OwnerSetupResult {
        user: SessionUser {
            id: 1,
            username: "ana".to_string(),
            role_name: "Propietaria".to_string(),
            permissions: vec![],
        },
        recovery_code: "ABCD-EFGH-IJKL-MNOP-QRST".to_string(),
    };
    let value = serde_json::to_value(&result).unwrap();
    assert_eq!(value["recoveryCode"], "ABCD-EFGH-IJKL-MNOP-QRST");
    assert_eq!(value["user"]["username"], "ana");
    assert!(!format!("{result:?}").contains("ABCD"));
}
