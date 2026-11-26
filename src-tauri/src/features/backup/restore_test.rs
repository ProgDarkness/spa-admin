use std::fs;
use std::path::PathBuf;

use super::*;
use crate::db::migrations::{migrate_to, supported_version};
use crate::db::open_encrypted;
use crate::features::backup::fixture_test::{
    assert_untouched, backup_fixture, current_backup_file, database_bytes, seal_plaintext,
    seal_raw, snapshot_of, source_with_marker, stored_key_bytes, BackupFixture, MARKER_USER,
    PASSPHRASE,
};
use crate::features::backup::format::MAX_BACKUP_BYTES;
use crate::features::backup::leftovers::{find, Leftover};

const KEY_BYTES: usize = 32;
const OLD_SCHEMA: u32 = 5;

fn passphrase(raw: &str) -> BackupPassphrase {
    BackupPassphrase::new(raw.to_string()).unwrap()
}

fn stage(target: &BackupFixture, file: &Path, raw: &str) -> Result<StagedRestore, BackupError> {
    stage_restore(&target.source.database_path, file, &passphrase(raw))
}

fn user_version_of(path: &Path, key: &DbKey) -> i64 {
    open_encrypted(path, key)
        .unwrap()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap()
}

fn old_schema_database_file(target: &BackupFixture) -> PathBuf {
    let scratch = tempfile::tempdir().unwrap();
    let path = scratch.path().join("old.db");
    let key = DbKey::generate().unwrap();
    {
        let mut conn = open_encrypted(&path, &key).unwrap();
        migrate_to(&mut conn, OLD_SCHEMA).unwrap();
    }
    let mut plaintext = hex::decode(key.as_hex()).unwrap();
    plaintext.extend_from_slice(&fs::read(&path).unwrap());
    seal_plaintext(target, OLD_SCHEMA, "antiguo.spabak", &plaintext)
}

#[test]
fn a_valid_backup_is_staged_as_an_openable_database_with_the_backups_key() {
    let source = source_with_marker();
    let target = backup_fixture();
    let file = current_backup_file(&source, "respaldo.spabak");

    let staged = stage(&target, &file, PASSPHRASE).unwrap();

    assert_eq!(
        hex::decode(staged.key.as_hex()).unwrap(),
        stored_key_bytes(&source)
    );
    assert_eq!(
        staged.restoring_path.parent(),
        target.source.database_path.parent()
    );
    let conn = open_encrypted(&staged.restoring_path, &staged.key).unwrap();
    let marker: i64 = conn
        .query_row(
            "SELECT count(*) FROM users WHERE username = ?1",
            [MARKER_USER],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(marker, 1);
    assert_eq!(staged.source_schema_version, supported_version());
}

#[test]
fn staging_does_not_touch_the_live_database_or_its_key() {
    let source = source_with_marker();
    let target = backup_fixture();
    let before = snapshot_of(&target);
    let file = current_backup_file(&source, "respaldo.spabak");

    let staged = stage(&target, &file, PASSPHRASE).unwrap();

    assert_eq!(database_bytes(&target), before.database);
    assert_eq!(stored_key_bytes(&target), before.key);
    assert!(target.source.key_store.read_pending().unwrap().is_none());
    assert_eq!(
        find(&target.source.database_path, Leftover::Restoring).unwrap(),
        [staged.restoring_path]
    );
}

#[cfg(unix)]
#[test]
fn the_staged_file_is_private_to_the_owner() {
    use std::os::unix::fs::PermissionsExt;
    let source = source_with_marker();
    let target = backup_fixture();
    let file = current_backup_file(&source, "respaldo.spabak");

    let staged = stage(&target, &file, PASSPHRASE).unwrap();

    let mode = fs::metadata(&staged.restoring_path)
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
}

#[test]
fn a_backup_from_a_newer_app_is_refused_by_its_header_before_any_key_derivation() {
    let source = backup_fixture();
    let target = backup_fixture();
    let before = snapshot_of(&target);
    let file = seal_raw(&source, supported_version() + 1, "futuro.spabak");

    let outcome = stage(&target, &file, "una-frase-que-no-es-la-correcta");

    assert!(matches!(outcome, Err(BackupError::FromNewerApp)));
    assert_untouched(&target, &before);
}

#[test]
fn a_database_whose_internal_version_is_newer_is_refused_even_with_a_current_header() {
    let source = backup_fixture();
    source
        .database
        .with_conn(|conn| Ok(conn.pragma_update(None, "user_version", supported_version() + 1)?))
        .unwrap();
    let target = backup_fixture();
    let before = snapshot_of(&target);
    let file = seal_raw(&source, supported_version(), "futuro-interno.spabak");

    let outcome = stage(&target, &file, PASSPHRASE);

    assert!(matches!(outcome, Err(BackupError::FromNewerApp)));
    assert_untouched(&target, &before);
}

#[test]
fn a_header_that_disagrees_with_the_internal_version_is_unreadable() {
    let source = backup_fixture();
    let target = backup_fixture();
    let before = snapshot_of(&target);
    let file = seal_raw(&source, supported_version() - 1, "incoherente.spabak");

    let outcome = stage(&target, &file, PASSPHRASE);

    assert!(matches!(outcome, Err(BackupError::Unreadable)));
    assert_untouched(&target, &before);
}

#[test]
fn a_valid_envelope_around_garbage_is_unreadable() {
    let target = backup_fixture();
    let before = snapshot_of(&target);
    let mut plaintext = vec![7u8; KEY_BYTES];
    plaintext.extend_from_slice(&[0xAB; 8192]);
    let file = seal_plaintext(&target, supported_version(), "basura.spabak", &plaintext);

    let outcome = stage(&target, &file, PASSPHRASE);

    assert!(matches!(outcome, Err(BackupError::Unreadable)));
    assert_untouched(&target, &before);
}

#[test]
fn a_valid_envelope_with_less_than_a_key_inside_is_unreadable() {
    let target = backup_fixture();
    let before = snapshot_of(&target);
    let file = seal_plaintext(&target, supported_version(), "corto.spabak", &[1u8; 10]);

    let outcome = stage(&target, &file, PASSPHRASE);

    assert!(matches!(outcome, Err(BackupError::Unreadable)));
    assert_untouched(&target, &before);
}

#[test]
fn a_database_with_a_damaged_page_is_unreadable() {
    let source = backup_fixture();
    let target = backup_fixture();
    let before = snapshot_of(&target);
    let mut plaintext = stored_key_bytes(&source);
    let mut bytes = database_bytes(&source);
    let damaged_offset = 3 * 4096 + 100;
    assert!(bytes.len() > damaged_offset + 4096);
    bytes[damaged_offset] ^= 0xFF;
    plaintext.extend_from_slice(&bytes);
    let file = seal_plaintext(&target, supported_version(), "danado.spabak", &plaintext);

    let outcome = stage(&target, &file, PASSPHRASE);

    assert!(matches!(outcome, Err(BackupError::Unreadable)));
    assert_untouched(&target, &before);
}

#[test]
fn a_database_without_a_schema_version_is_unreadable() {
    let target = backup_fixture();
    let before = snapshot_of(&target);
    let scratch = tempfile::tempdir().unwrap();
    let path = scratch.path().join("vacia.db");
    let key = DbKey::generate().unwrap();
    open_encrypted(&path, &key)
        .unwrap()
        .execute_batch("CREATE TABLE t(v TEXT)")
        .unwrap();
    let mut plaintext = hex::decode(key.as_hex()).unwrap();
    plaintext.extend_from_slice(&fs::read(&path).unwrap());
    let file = seal_plaintext(&target, 1, "sin-version.spabak", &plaintext);

    let outcome = stage(&target, &file, PASSPHRASE);

    assert!(matches!(outcome, Err(BackupError::Unreadable)));
    assert_untouched(&target, &before);
}

#[test]
fn a_wrong_passphrase_is_unreadable() {
    let source = backup_fixture();
    let target = backup_fixture();
    let before = snapshot_of(&target);
    let file = current_backup_file(&source, "respaldo.spabak");

    let outcome = stage(&target, &file, "otra-frase-igual-de-larga");

    assert!(matches!(outcome, Err(BackupError::Unreadable)));
    assert_untouched(&target, &before);
}

#[test]
fn a_truncated_backup_is_unreadable() {
    let source = backup_fixture();
    let target = backup_fixture();
    let before = snapshot_of(&target);
    let file = current_backup_file(&source, "respaldo.spabak");
    let mut bytes = fs::read(&file).unwrap();
    bytes.pop();
    fs::write(&file, bytes).unwrap();

    let outcome = stage(&target, &file, PASSPHRASE);

    assert!(matches!(outcome, Err(BackupError::Unreadable)));
    assert_untouched(&target, &before);
}

#[test]
fn a_file_that_is_not_a_backup_is_not_recognized() {
    let target = backup_fixture();
    let before = snapshot_of(&target);
    let file = target.dir.path().join("out").join("ajeno.spabak");
    fs::write(&file, b"esto no es un respaldo").unwrap();

    let outcome = stage(&target, &file, PASSPHRASE);

    assert!(matches!(outcome, Err(BackupError::NotRecognized)));
    assert_untouched(&target, &before);
}

#[test]
fn a_file_larger_than_the_limit_is_refused_without_reading_it() {
    let target = backup_fixture();
    let before = snapshot_of(&target);
    let file = target.dir.path().join("out").join("enorme.spabak");
    let handle = fs::File::create(&file).unwrap();
    handle.set_len(MAX_BACKUP_BYTES + 1).unwrap();
    drop(handle);

    let outcome = stage(&target, &file, PASSPHRASE);

    assert!(matches!(outcome, Err(BackupError::NotRecognized)));
    assert_untouched(&target, &before);
}

#[test]
fn a_missing_file_is_an_io_failure() {
    let target = backup_fixture();
    let before = snapshot_of(&target);
    let file = target.dir.path().join("out").join("no-existe.spabak");

    let outcome = stage(&target, &file, PASSPHRASE);

    assert!(matches!(outcome, Err(BackupError::Io(_))));
    assert_untouched(&target, &before);
}

#[test]
fn a_backup_from_an_older_schema_is_migrated_up_to_the_supported_version() {
    let target = backup_fixture();
    let file = old_schema_database_file(&target);

    let staged = stage(&target, &file, PASSPHRASE).unwrap();

    assert_eq!(staged.source_schema_version, OLD_SCHEMA);
    assert_eq!(
        user_version_of(&staged.restoring_path, &staged.key),
        i64::from(supported_version())
    );
}

#[test]
fn staging_creates_no_snapshot_copy_of_the_older_database() {
    let target = backup_fixture();
    let file = old_schema_database_file(&target);

    stage(&target, &file, PASSPHRASE).unwrap();

    let snapshots = crate::db::snapshot::all_snapshots(&target.source.database_path).unwrap();
    assert!(snapshots.is_empty());
}

#[test]
fn a_reader_that_yields_exactly_the_limit_is_read_completely() {
    let bytes = read_bounded(std::io::repeat(7).take(16), 16).unwrap();

    assert_eq!(bytes, vec![7u8; 16]);
}

#[test]
fn a_reader_that_never_ends_is_refused_once_it_passes_the_limit() {
    let outcome = read_bounded(std::io::repeat(7), 16);

    assert!(matches!(outcome, Err(BackupError::NotRecognized)));
}

#[test]
fn a_reader_one_byte_over_the_limit_is_refused() {
    let outcome = read_bounded(std::io::repeat(7).take(17), 16);

    assert!(matches!(outcome, Err(BackupError::NotRecognized)));
}

struct CountingReader {
    consumed: std::cell::Cell<u64>,
}

impl Read for &CountingReader {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        buffer.fill(7);
        self.consumed.set(self.consumed.get() + buffer.len() as u64);
        Ok(buffer.len())
    }
}

#[test]
fn the_reader_is_never_consumed_beyond_one_byte_past_the_limit() {
    let source = CountingReader {
        consumed: std::cell::Cell::new(0),
    };

    let outcome = read_bounded(&source, 16);

    assert!(matches!(outcome, Err(BackupError::NotRecognized)));
    assert_eq!(source.consumed.get(), 17);
}

#[cfg(unix)]
#[test]
fn a_file_that_reports_no_size_but_streams_forever_is_refused_while_reading() {
    let target = backup_fixture();
    let before = snapshot_of(&target);
    let passphrase = BackupPassphrase::new(PASSPHRASE.to_string()).unwrap();

    let outcome = stage_restore_within(
        &target.source.database_path,
        std::path::Path::new("/dev/zero"),
        &passphrase,
        1024,
    );

    assert!(matches!(outcome, Err(BackupError::NotRecognized)));
    assert_untouched(&target, &before);
}

#[test]
fn the_verification_connection_does_not_trust_the_schema_of_the_backup_and_is_defensive() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("verificar.db");
    let key = DbKey::from_hex("ab".repeat(32)).unwrap();
    open_encrypted(&path, &key).unwrap();

    let conn = open_for_verification(&path, &key).unwrap();

    let trusted: i64 = conn
        .query_row("PRAGMA trusted_schema", [], |row| row.get(0))
        .unwrap();
    assert_eq!(trusted, 0);
    assert!(conn
        .db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_DEFENSIVE)
        .unwrap());
}
