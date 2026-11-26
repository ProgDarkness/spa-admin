use std::fs;
use std::path::PathBuf;

use rusqlite::Connection;
use tempfile::TempDir;

use super::*;
use crate::db::migrations::apply;
use crate::db::{open_encrypted, DbError, DbKey};

const OLDEST_NAME: &str = "spa.db.0000000000000000.v1.bak";

fn key_of(digit: &str) -> DbKey {
    DbKey::from_hex(digit.repeat(64)).unwrap()
}

fn database_at_version(version: i64) -> (TempDir, PathBuf, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("spa.db");
    let conn = open_encrypted(&path, &key_of("a")).unwrap();
    conn.execute_batch("CREATE TABLE t(v TEXT); INSERT INTO t VALUES ('hello');")
        .unwrap();
    conn.pragma_update(None, "user_version", version).unwrap();
    (dir, path, conn)
}

fn backups_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .filter(|name| name.ends_with(".bak"))
        .collect();
    names.sort();
    names
}

fn user_version(conn: &Connection) -> i64 {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap()
}

#[test]
fn no_copy_when_current() {
    let (_dir, _path, conn) = database_at_version(i64::from(supported_version()));
    assert_eq!(pending_from(&conn).unwrap(), None);
}

#[test]
fn no_copy_for_fresh_database() {
    let (_dir, _path, conn) = database_at_version(0);
    assert_eq!(pending_from(&conn).unwrap(), None);
}

#[test]
fn no_pending_when_schema_is_newer_than_supported() {
    let (_dir, _path, conn) = database_at_version(i64::from(supported_version()) + 1);
    assert_eq!(pending_from(&conn).unwrap(), None);
}

#[test]
fn pending_reports_current_version_for_older_schema() {
    let (_dir, _path, conn) = database_at_version(2);
    assert_eq!(pending_from(&conn).unwrap(), Some(2));
    conn.pragma_update(None, "user_version", 1).unwrap();
    assert_eq!(pending_from(&conn).unwrap(), Some(1));
}

#[test]
fn copy_created_when_pending() {
    let (dir, path, _conn) = database_at_version(2);

    let copy = snapshot_before_migrate(&path, 2).unwrap();

    assert_eq!(copy.parent().unwrap(), dir.path());
    let name = copy.file_name().unwrap().to_str().unwrap();
    let stamp = name
        .strip_prefix("spa.db.")
        .and_then(|rest| rest.strip_suffix(".v2.bak"))
        .unwrap();
    assert_eq!(stamp.len(), 16);
    assert!(stamp.bytes().all(|byte| byte.is_ascii_digit()));
    assert_eq!(fs::read(&copy).unwrap(), fs::read(&path).unwrap());
}

#[test]
fn copy_opens_with_same_key() {
    let (_dir, path, _conn) = database_at_version(2);

    let copy = snapshot_before_migrate(&path, 2).unwrap();

    let reopened = open_encrypted(&copy, &key_of("a")).unwrap();
    let value: String = reopened
        .query_row("SELECT v FROM t", [], |row| row.get(0))
        .unwrap();
    assert_eq!(value, "hello");
    assert!(matches!(
        open_encrypted(&copy, &key_of("b")),
        Err(DbError::NotADatabase)
    ));
}

#[test]
fn failing_migration_leaves_original() {
    let (dir, path, mut conn) = database_at_version(2);
    let copy = snapshot_before_migrate(&path, 2).unwrap();

    let outcome = apply(&mut conn, &[(3, "CREATE TABLE added(x); NOT VALID SQL")]);

    assert!(outcome.is_err());
    assert_eq!(user_version(&conn), 2);
    let added: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name = 'added'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(added, 0);
    assert!(copy.exists());
    let preserved = open_encrypted(&copy, &key_of("a")).unwrap();
    assert_eq!(user_version(&preserved), 2);
    assert_eq!(backups_in(dir.path()).len(), 1);
}

#[cfg(unix)]
#[test]
fn copy_is_0600() {
    use std::os::unix::fs::PermissionsExt;
    let (_dir, path, _conn) = database_at_version(2);

    let copy = snapshot_before_migrate(&path, 2).unwrap();

    let mode = fs::metadata(&copy).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, SNAPSHOT_MODE);
}

#[test]
fn keeps_only_three() {
    let (dir, path, _conn) = database_at_version(2);

    for millis in 1..=5 {
        snapshot_at(&path, 2, millis).unwrap();
    }

    assert_eq!(
        backups_in(dir.path()),
        vec![
            "spa.db.0000000000000003.v2.bak",
            "spa.db.0000000000000004.v2.bak",
            "spa.db.0000000000000005.v2.bak",
        ]
    );
}

#[test]
fn prune_ignores_unrelated_files() {
    let (dir, path, _conn) = database_at_version(2);
    fs::write(dir.path().join("other.db.0.v1.bak"), b"x").unwrap();
    fs::write(dir.path().join("spa.db.0.v1.txt"), b"x").unwrap();

    for millis in 1..=4 {
        snapshot_at(&path, 2, millis).unwrap();
    }

    assert!(dir.path().join("other.db.0.v1.bak").exists());
    assert!(dir.path().join("spa.db.0.v1.txt").exists());
}

#[test]
fn newest_copy_survives_when_older_copies_carry_future_stamps() {
    let (dir, path, _conn) = database_at_version(2);
    for future in [9_990, 9_991, 9_992] {
        let name = format!("spa.db.{future:016}.v2.bak");
        fs::write(dir.path().join(name), b"x").unwrap();
    }

    let copy = snapshot_at(&path, 2, 5).unwrap();

    assert!(copy.exists());
    assert_eq!(
        backups_in(dir.path()),
        vec![
            "spa.db.0000000000000005.v2.bak",
            "spa.db.0000000000009991.v2.bak",
            "spa.db.0000000000009992.v2.bak",
        ]
    );
}

#[test]
fn foreign_backup_names_are_neither_counted_nor_deleted() {
    let (dir, path, _conn) = database_at_version(2);
    let foreign = [
        "spa.db.0.bak",
        "spa.db.bak",
        "spa.db.a.bak",
        "spa.db.000000000000000a.v2.bak",
        "spa.db.0000000000000001.vx.bak",
        "spa.db.0000000000000001.v.bak",
        "spa.db.00000000000000001.v2.bak",
    ];
    for name in foreign {
        fs::write(dir.path().join(name), b"x").unwrap();
    }

    for millis in 1..=5 {
        snapshot_at(&path, 2, millis).unwrap();
    }

    for name in foreign {
        assert!(dir.path().join(name).exists(), "{name} was deleted");
    }
    assert_eq!(
        backups_in(dir.path()).len(),
        foreign.len() + SNAPSHOT_RETENTION
    );
}

#[test]
fn prune_failure_does_not_block() {
    let (dir, path, _conn) = database_at_version(2);
    let stuck = dir.path().join(OLDEST_NAME);
    fs::create_dir(&stuck).unwrap();
    fs::write(stuck.join("inner"), b"x").unwrap();
    for millis in 1..=3 {
        snapshot_at(&path, 2, millis).unwrap();
    }

    let copy = snapshot_at(&path, 2, 4).unwrap();

    assert!(copy.exists());
    assert!(stuck.exists());
}

#[test]
fn never_overwrites_an_existing_copy() {
    let (_dir, path, _conn) = database_at_version(2);
    let first = snapshot_at(&path, 2, 7).unwrap();
    fs::write(&first, b"marker").unwrap();

    let second = snapshot_at(&path, 2, 7);

    assert!(second.is_err());
    assert_eq!(fs::read(&first).unwrap(), b"marker");
}

#[test]
fn failed_copy_leaves_no_partial_file() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("spa.db");

    let outcome = snapshot_before_migrate(&missing, 2);

    assert!(outcome.is_err());
    assert!(backups_in(dir.path()).is_empty());
}

#[test]
fn snapshot_error_message_leaks_nothing() {
    let failure = SnapshotError::Io(std::io::Error::other("/ruta/secreta"));
    assert_eq!(failure.to_string(), "snapshot failed");
}

fn touch(dir: &Path, name: &str) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, b"x").unwrap();
    path
}

#[test]
fn all_snapshots_lists_every_versioned_copy_and_ignores_restore_leftovers() {
    let dir = tempfile::tempdir().unwrap();
    let database = touch(dir.path(), "spa.db");
    let first = touch(dir.path(), "spa.db.0000000000000001.v2.bak");
    let second = touch(dir.path(), "spa.db.0000000000000002.v3.bak");
    touch(dir.path(), "spa.db.0000000000000003.prev");
    touch(dir.path(), "spa.db.0000000000000003.restoring");
    touch(dir.path(), "spa.db.0000000000000003.failed");
    touch(dir.path(), "otro.db.0000000000000001.v2.bak");

    let listed = all_snapshots(&database).unwrap();

    assert_eq!(listed, [first, second]);
}

#[test]
fn all_snapshots_of_a_directory_without_copies_is_empty() {
    let dir = tempfile::tempdir().unwrap();
    let database = touch(dir.path(), "spa.db");

    assert!(all_snapshots(&database).unwrap().is_empty());
}
