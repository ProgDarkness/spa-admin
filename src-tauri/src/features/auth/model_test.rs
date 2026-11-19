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
