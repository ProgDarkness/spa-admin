use std::fs;

use super::*;
use crate::db::migrations::supported_version;
use crate::db::open_encrypted;
use crate::features::audit::AuditEntity;
use crate::features::auth::service::AuthError;
use crate::features::backup::crypto::open;
use crate::features::backup::fixture_test::{
    backup_audit_rows, backup_fixture, database_bytes, destination, execute, files_in_out_dir,
    sign_in_as, stored_key_bytes, BackupFixture, OWNER, PASSPHRASE, RECEPTION,
};
use crate::keystore::KeyStoreError;

const FILE_NAME: &str = "respaldo.spabak";
const KEY_BYTES: usize = 32;

fn passphrase() -> BackupPassphrase {
    BackupPassphrase::new(PASSPHRASE.to_string()).unwrap()
}

fn export_fast(fixture: &BackupFixture, target: &Path) -> Result<BackupExported, BackupError> {
    export_with_kdf(
        &fixture.database,
        &fixture.session,
        &fixture.source,
        &passphrase(),
        target,
        KdfParams::LOWEST_ACCEPTED,
    )
}

#[test]
fn the_owner_exports_a_file_that_holds_the_key_and_the_database_bytes() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let target = destination(&fixture, FILE_NAME);
    let bytes_before = database_bytes(&fixture);
    let key_before = stored_key_bytes(&fixture);

    export_fast(&fixture, &target).unwrap();

    let opened = open(&passphrase(), &fs::read(&target).unwrap()).unwrap();
    assert_eq!(opened.plaintext[..KEY_BYTES], key_before[..]);
    assert_eq!(opened.plaintext[KEY_BYTES..], bytes_before[..]);
    assert_eq!(opened.header.schema_version, supported_version());
}

#[test]
fn the_production_export_uses_the_documented_key_derivation_cost() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let target = destination(&fixture, FILE_NAME);

    export_to(
        &fixture.database,
        &fixture.session,
        &fixture.source,
        &passphrase(),
        &target,
    )
    .unwrap();

    let opened = open(&passphrase(), &fs::read(&target).unwrap()).unwrap();
    assert_eq!(opened.header.kdf, KdfParams::EXPORT);
}

#[test]
fn the_recovered_bytes_open_as_the_same_encrypted_database_with_the_recovered_key() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let target = destination(&fixture, FILE_NAME);
    export_fast(&fixture, &target).unwrap();
    let opened = open(&passphrase(), &fs::read(&target).unwrap()).unwrap();
    let recovered_path = fixture.dir.path().join("recovered.db");
    fs::write(&recovered_path, &opened.plaintext[KEY_BYTES..]).unwrap();
    let recovered_key =
        crate::db::DbKey::from_hex(hex::encode(&opened.plaintext[..KEY_BYTES])).unwrap();

    let conn = open_encrypted(&recovered_path, &recovered_key).unwrap();

    let roles: i64 = conn
        .query_row("SELECT count(*) FROM roles", [], |row| row.get(0))
        .unwrap();
    assert_eq!(roles, 3);
}

#[test]
fn the_export_is_audited_with_the_actor_and_a_diff_without_key_or_path() {
    let fixture = backup_fixture();
    let owner_id = sign_in_as(&fixture, OWNER);
    let target = destination(&fixture, FILE_NAME);

    export_fast(&fixture, &target).unwrap();

    let rows = backup_audit_rows(&fixture, "backup_created");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].actor_user_id, Some(owner_id));
    assert_eq!(rows[0].entity, AuditEntity::System);
    let diff = rows[0].diff.clone().unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&diff).unwrap();
    assert_eq!(parsed["schemaVersion"], supported_version());
    assert_eq!(parsed["fileName"], FILE_NAME);
    assert_eq!(parsed.as_object().unwrap().len(), 2);
    let key_hex = hex::encode(stored_key_bytes(&fixture));
    assert!(!diff.contains(&key_hex));
    assert!(!diff.contains(target.parent().unwrap().to_str().unwrap()));
    assert!(!diff.contains(PASSPHRASE));
}

#[test]
fn the_result_names_the_file_and_carries_the_audit_timestamp() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let target = destination(&fixture, FILE_NAME);

    let exported = export_fast(&fixture, &target).unwrap();

    let rows = backup_audit_rows(&fixture, "backup_created");
    assert_eq!(exported.file_name, FILE_NAME);
    assert_eq!(exported.created_at, rows[0].occurred_at);
    assert_eq!(exported.created_at.len(), 19);
}

#[test]
fn a_successful_export_leaves_no_partial_file_behind() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let target = destination(&fixture, FILE_NAME);

    export_fast(&fixture, &target).unwrap();

    assert_eq!(files_in_out_dir(&fixture), [FILE_NAME]);
}

#[cfg(unix)]
#[test]
fn the_exported_file_is_private_to_the_owner() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let target = destination(&fixture, FILE_NAME);

    export_fast(&fixture, &target).unwrap();

    let mode = fs::metadata(&target).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
}

#[test]
fn exporting_over_an_existing_file_replaces_it() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let target = destination(&fixture, FILE_NAME);
    fs::write(&target, b"anterior").unwrap();

    export_fast(&fixture, &target).unwrap();

    assert!(open(&passphrase(), &fs::read(&target).unwrap()).is_ok());
    assert_eq!(files_in_out_dir(&fixture), [FILE_NAME]);
}

#[test]
fn without_a_session_the_export_is_unauthenticated_and_writes_nothing() {
    let fixture = backup_fixture();
    let target = destination(&fixture, FILE_NAME);

    let outcome = export_fast(&fixture, &target);

    assert!(matches!(
        outcome,
        Err(BackupError::Auth(AuthError::Unauthenticated))
    ));
    assert!(files_in_out_dir(&fixture).is_empty());
    assert!(backup_audit_rows(&fixture, "backup_created").is_empty());
}

#[test]
fn a_role_without_backup_manage_is_forbidden_and_writes_nothing() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, RECEPTION);
    let target = destination(&fixture, FILE_NAME);

    let outcome = export_fast(&fixture, &target);

    assert!(matches!(
        outcome,
        Err(BackupError::Auth(AuthError::Forbidden))
    ));
    assert!(files_in_out_dir(&fixture).is_empty());
    assert!(backup_audit_rows(&fixture, "backup_created").is_empty());
}

#[test]
fn a_locked_session_cannot_export() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    fixture.session.force_lock().unwrap();
    let target = destination(&fixture, FILE_NAME);

    let outcome = export_fast(&fixture, &target);

    assert!(matches!(outcome, Err(BackupError::Auth(AuthError::Locked))));
    assert!(files_in_out_dir(&fixture).is_empty());
}

#[test]
fn a_permission_revoked_after_the_first_check_rejects_the_write_inside_the_transaction() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let target = destination(&fixture, FILE_NAME);
    let snapshot =
        read_export_snapshot(&fixture.database, &fixture.session, &fixture.source).unwrap();
    let sealed = seal(
        &passphrase(),
        KdfParams::LOWEST_ACCEPTED,
        snapshot.schema_version,
        &snapshot.plaintext,
    )
    .unwrap();
    execute(
        &fixture,
        "DELETE FROM role_permissions WHERE role_id = 1 AND permission_key = 'backup.manage'",
    );

    let outcome = write_export(
        &fixture.database,
        &fixture.session,
        &target,
        snapshot.schema_version,
        &sealed,
    );

    assert!(matches!(
        outcome,
        Err(BackupError::Auth(AuthError::Forbidden))
    ));
    assert!(files_in_out_dir(&fixture).is_empty());
    assert!(backup_audit_rows(&fixture, "backup_created").is_empty());
}

#[test]
fn a_failed_write_leaves_no_audit_row_and_no_partial_file() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let target = fixture.dir.path().join("no-existe").join(FILE_NAME);

    let outcome = export_fast(&fixture, &target);

    assert!(matches!(outcome, Err(BackupError::Io(_))));
    assert!(backup_audit_rows(&fixture, "backup_created").is_empty());
    assert!(!target.exists());
    assert!(files_in_out_dir(&fixture).is_empty());
}

#[test]
fn a_failed_commit_deletes_the_destination_and_leaves_no_audit_row() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    execute(
        &fixture,
        "CREATE TABLE parent_probe (id INTEGER PRIMARY KEY);
         CREATE TABLE child_probe (
             parent_id INTEGER REFERENCES parent_probe(id) DEFERRABLE INITIALLY DEFERRED);
         CREATE TRIGGER break_commit AFTER INSERT ON audit_log
         BEGIN INSERT INTO child_probe (parent_id) VALUES (999); END;",
    );
    let target = destination(&fixture, FILE_NAME);

    let outcome = export_fast(&fixture, &target);

    assert!(matches!(outcome, Err(BackupError::Db(_))));
    assert!(files_in_out_dir(&fixture).is_empty());
    assert!(backup_audit_rows(&fixture, "backup_created").is_empty());
}

fn break_commit_on_audit_insert(fixture: &BackupFixture) {
    execute(
        fixture,
        "CREATE TABLE parent_probe (id INTEGER PRIMARY KEY);
         CREATE TABLE child_probe (
             parent_id INTEGER REFERENCES parent_probe(id) DEFERRABLE INITIALLY DEFERRED);
         CREATE TRIGGER break_commit AFTER INSERT ON audit_log
         BEGIN INSERT INTO child_probe (parent_id) VALUES (999); END;",
    );
}

#[test]
fn a_failed_commit_gives_the_previous_file_at_the_destination_back_intact() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    break_commit_on_audit_insert(&fixture);
    let target = destination(&fixture, FILE_NAME);
    fs::write(&target, b"anterior").unwrap();

    let outcome = export_fast(&fixture, &target);

    assert!(matches!(outcome, Err(BackupError::Db(_))));
    assert_eq!(fs::read(&target).unwrap(), b"anterior");
    assert_eq!(files_in_out_dir(&fixture), [FILE_NAME]);
    assert!(backup_audit_rows(&fixture, "backup_created").is_empty());
}

#[test]
fn a_file_name_at_the_filesystem_limit_still_exports() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let name = format!("{}.spabak", "a".repeat(NAME_MAX_BYTES - ".spabak".len()));
    let target = destination(&fixture, &name);

    export_fast(&fixture, &target).unwrap();

    assert_eq!(files_in_out_dir(&fixture), [name]);
}

#[test]
fn a_long_multibyte_file_name_is_shortened_on_a_character_boundary_for_the_partial() {
    let fixture = backup_fixture();
    let name = format!("{}.spabak", "ñ".repeat(120));
    let target = destination(&fixture, &name);

    let partial = partial_path_for(&target).unwrap();

    let partial_name = partial.file_name().unwrap().to_string_lossy().into_owned();
    assert!(partial_name.len() <= NAME_MAX_BYTES);
    assert!(partial_name.contains(".partial-"));
    assert!(!partial_name.contains('\u{FFFD}'));
}

#[test]
fn replacing_an_existing_file_with_a_long_name_still_works() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let name = format!("{}.spabak", "b".repeat(NAME_MAX_BYTES - ".spabak".len()));
    let target = destination(&fixture, &name);
    fs::write(&target, b"anterior").unwrap();

    export_fast(&fixture, &target).unwrap();

    assert!(open(&passphrase(), &fs::read(&target).unwrap()).is_ok());
    assert_eq!(files_in_out_dir(&fixture), [name]);
}

#[test]
fn a_rejected_export_does_not_delete_a_previous_file_at_the_destination() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, RECEPTION);
    let target = destination(&fixture, FILE_NAME);
    fs::write(&target, b"anterior").unwrap();

    export_fast(&fixture, &target).unwrap_err();

    assert_eq!(fs::read(&target).unwrap(), b"anterior");
    assert_eq!(files_in_out_dir(&fixture), [FILE_NAME]);
}

#[test]
fn a_database_too_large_to_restore_is_refused_before_reading_it() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    fs::OpenOptions::new()
        .write(true)
        .open(&fixture.source.database_path)
        .unwrap()
        .set_len(MAX_BACKUP_BYTES)
        .unwrap();
    let target = destination(&fixture, FILE_NAME);

    let outcome = export_fast(&fixture, &target);

    assert!(matches!(outcome, Err(BackupError::TooLarge)));
    assert!(files_in_out_dir(&fixture).is_empty());
}

#[test]
fn a_missing_database_key_aborts_the_export() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    let source = BackupSource {
        database_path: fixture.source.database_path.clone(),
        key_store: crate::test_support::isolated_store(),
    };
    let target = destination(&fixture, FILE_NAME);

    let outcome = export_with_kdf(
        &fixture.database,
        &fixture.session,
        &source,
        &passphrase(),
        &target,
        KdfParams::LOWEST_ACCEPTED,
    );

    assert!(matches!(
        outcome,
        Err(BackupError::KeyStore(KeyStoreError::MissingForExistingDb))
    ));
    assert!(files_in_out_dir(&fixture).is_empty());
}
