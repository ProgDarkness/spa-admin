use serde_json::json;

use super::*;

#[test]
fn the_export_result_serializes_with_camel_case_keys() {
    let exported = BackupExported {
        file_name: "respaldo.spabak".to_string(),
        created_at: "2026-11-26T10:30:00".to_string(),
    };

    let value = serde_json::to_value(exported).unwrap();

    assert_eq!(
        value,
        json!({ "fileName": "respaldo.spabak", "createdAt": "2026-11-26T10:30:00" })
    );
}

#[test]
fn the_restore_result_serializes_with_camel_case_keys() {
    let restored = RestoreResult {
        source_schema_version: 5,
        schema_version: 12,
    };

    let value = serde_json::to_value(restored).unwrap();

    assert_eq!(
        value,
        json!({ "sourceSchemaVersion": 5, "schemaVersion": 12 })
    );
}

#[test]
fn the_backup_status_serializes_with_camel_case_keys_and_a_null_when_never_backed_up() {
    let never = BackupStatus {
        last_backup_at: None,
        is_due: true,
    };
    let once = BackupStatus {
        last_backup_at: Some("2026-11-26T10:30:00".to_string()),
        is_due: false,
    };

    assert_eq!(
        serde_json::to_value(never).unwrap(),
        json!({ "lastBackupAt": null, "isDue": true })
    );
    assert_eq!(
        serde_json::to_value(once).unwrap(),
        json!({ "lastBackupAt": "2026-11-26T10:30:00", "isDue": false })
    );
}
