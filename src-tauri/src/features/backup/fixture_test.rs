use std::fs;
use std::path::PathBuf;

use tempfile::TempDir;

use super::crypto::{seal, BackupPassphrase};
use super::format::KdfParams;
use super::leftovers::{find, Leftover};
use super::model::BackupSource;
use crate::db::migrations::supported_version;
use crate::db::Database;
use crate::features::audit::AuditEntry;
use crate::features::auth::model::SessionUser;
use crate::features::auth::repository::permissions_of_role_for_user;
use crate::features::auth::service::{Beat, SessionState};
use crate::features::users::repository::{insert_user, NewUserRow};
use crate::setup::{bootstrap, DATABASE_FILE_NAME};
use crate::test_support::isolated_store;

pub(crate) const OWNER_ROLE: i64 = 1;
pub(crate) const RECEPTION_ROLE: i64 = 2;
pub(crate) const OWNER: &str = "propietaria";
pub(crate) const RECEPTION: &str = "recepcion";
pub(crate) const PASSPHRASE: &str = "frase-de-respaldo-larga";

pub(crate) struct BackupFixture {
    pub(crate) dir: TempDir,
    pub(crate) database: Database,
    pub(crate) session: SessionState,
    pub(crate) source: BackupSource,
}

pub(crate) fn backup_fixture() -> BackupFixture {
    let fixture = first_run_fixture();
    add_user(&fixture.database, OWNER, OWNER_ROLE);
    add_user(&fixture.database, RECEPTION, RECEPTION_ROLE);
    fixture
}

pub(crate) fn first_run_fixture() -> BackupFixture {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let store = isolated_store();
    let database = bootstrap(&data_dir, &store).unwrap().database;
    fs::create_dir(dir.path().join("out")).unwrap();
    BackupFixture {
        database,
        session: SessionState::default(),
        source: BackupSource {
            database_path: data_dir.join(DATABASE_FILE_NAME),
            key_store: store,
        },
        dir,
    }
}

pub(crate) fn add_user(database: &Database, username: &str, role_id: i64) {
    let row = NewUserRow {
        username: username.to_string(),
        password_hash: "hash-opaco".to_string(),
        role_id,
    };
    database
        .with_conn(|conn| insert_user(conn, &row, None))
        .unwrap();
}

pub(crate) fn sign_in_as(fixture: &BackupFixture, username: &str) -> i64 {
    let user = fixture
        .database
        .with_conn(|conn| {
            let (id, role_name): (i64, String) = conn.query_row(
                "SELECT u.id, r.name FROM users u JOIN roles r ON r.id = u.role_id \
                 WHERE u.username = ?1",
                [username],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            Ok(SessionUser {
                id,
                username: username.to_string(),
                role_name,
                permissions: permissions_of_role_for_user(conn, id)?,
            })
        })
        .unwrap();
    let user_id = user.id;
    fixture.session.start(user, Beat::now()).unwrap();
    user_id
}

pub(crate) fn execute(fixture: &BackupFixture, sql: &str) {
    fixture
        .database
        .with_conn(|conn| Ok(conn.execute_batch(sql)?))
        .unwrap();
}

pub(crate) fn destination(fixture: &BackupFixture, file_name: &str) -> PathBuf {
    fixture.dir.path().join("out").join(file_name)
}

pub(crate) fn database_bytes(fixture: &BackupFixture) -> Vec<u8> {
    fs::read(&fixture.source.database_path).unwrap()
}

pub(crate) fn stored_key_bytes(fixture: &BackupFixture) -> Vec<u8> {
    let key = fixture.source.key_store.read().unwrap().unwrap();
    hex::decode(key.as_hex()).unwrap()
}

pub(crate) fn files_in_out_dir(fixture: &BackupFixture) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(fixture.dir.path().join("out"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

pub(crate) fn backup_audit_rows(fixture: &BackupFixture, action: &str) -> Vec<AuditEntry> {
    fixture
        .database
        .with_conn(crate::features::audit::repository::list_all)
        .unwrap()
        .into_iter()
        .filter(|entry| entry.action.as_str() == action)
        .collect()
}

pub(crate) fn seal_raw(
    fixture: &BackupFixture,
    header_schema_version: u32,
    file_name: &str,
) -> PathBuf {
    let mut plaintext = stored_key_bytes(fixture);
    plaintext.extend_from_slice(&database_bytes(fixture));
    seal_plaintext(fixture, header_schema_version, file_name, &plaintext)
}

pub(crate) fn seal_plaintext(
    fixture: &BackupFixture,
    header_schema_version: u32,
    file_name: &str,
    plaintext: &[u8],
) -> PathBuf {
    let sealed = seal(
        &BackupPassphrase::new(PASSPHRASE.to_string()).unwrap(),
        KdfParams::LOWEST_ACCEPTED,
        header_schema_version,
        plaintext,
    )
    .unwrap();
    let path = destination(fixture, file_name);
    fs::write(&path, sealed).unwrap();
    path
}

pub(crate) fn current_backup_file(fixture: &BackupFixture, file_name: &str) -> PathBuf {
    seal_raw(fixture, supported_version(), file_name)
}

pub(crate) const MARKER_USER: &str = "invitada-del-respaldo";

pub(crate) fn source_with_marker() -> BackupFixture {
    let source = backup_fixture();
    add_user(&source.database, MARKER_USER, OWNER_ROLE);
    source
}

pub(crate) struct Untouched {
    pub(crate) database: Vec<u8>,
    pub(crate) key: Vec<u8>,
}

pub(crate) fn snapshot_of(target: &BackupFixture) -> Untouched {
    Untouched {
        database: database_bytes(target),
        key: stored_key_bytes(target),
    }
}

pub(crate) fn assert_untouched(target: &BackupFixture, before: &Untouched) {
    assert_eq!(database_bytes(target), before.database);
    assert_eq!(stored_key_bytes(target), before.key);
    assert!(target.source.key_store.read_pending().unwrap().is_none());
    assert!(find(&target.source.database_path, Leftover::Restoring)
        .unwrap()
        .is_empty());
}
