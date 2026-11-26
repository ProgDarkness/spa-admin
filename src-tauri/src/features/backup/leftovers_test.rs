use std::fs;

use super::*;
use crate::db::snapshot::all_snapshots;

const STAMP: &str = "0000000000000042";

fn database_in(dir: &Path) -> PathBuf {
    let path = dir.join("spa.db");
    fs::write(&path, b"x").unwrap();
    path
}

#[test]
fn each_kind_builds_a_distinct_sibling_of_the_database() {
    let database = Path::new("/datos/spa.db");

    assert_eq!(
        path_for(database, STAMP, Leftover::Restoring),
        Path::new("/datos/spa.db.0000000000000042.restoring")
    );
    assert_eq!(
        path_for(database, STAMP, Leftover::Prev),
        Path::new("/datos/spa.db.0000000000000042.prev")
    );
    assert_eq!(
        path_for(database, STAMP, Leftover::Failed),
        Path::new("/datos/spa.db.0000000000000042.failed")
    );
}

#[test]
fn leftovers_are_never_mistaken_for_pruneable_snapshots() {
    let dir = tempfile::tempdir().unwrap();
    let database = database_in(dir.path());
    for kind in [Leftover::Restoring, Leftover::Prev, Leftover::Failed] {
        fs::write(path_for(&database, STAMP, kind), b"x").unwrap();
    }

    assert!(all_snapshots(&database).unwrap().is_empty());
}

#[test]
fn find_returns_only_the_requested_kind_oldest_first() {
    let dir = tempfile::tempdir().unwrap();
    let database = database_in(dir.path());
    let older = path_for(&database, "0000000000000001", Leftover::Prev);
    let newer = path_for(&database, "0000000000000009", Leftover::Prev);
    fs::write(&newer, b"x").unwrap();
    fs::write(&older, b"x").unwrap();
    fs::write(path_for(&database, STAMP, Leftover::Failed), b"x").unwrap();
    fs::write(dir.path().join("otro.db.0000000000000001.prev"), b"x").unwrap();

    assert_eq!(find(&database, Leftover::Prev).unwrap(), [older, newer]);
    assert!(find(&database, Leftover::Restoring).unwrap().is_empty());
}

#[test]
fn the_stamp_has_sixteen_digits_and_does_not_decrease() {
    let first = stamp_now().unwrap();
    let second = stamp_now().unwrap();

    assert_eq!(first.len(), 16);
    assert!(first.bytes().all(|byte| byte.is_ascii_digit()));
    assert!(second >= first);
}

fn write_with_sidecars(database: &Path, kind: Leftover) -> Vec<PathBuf> {
    let main = path_for(database, STAMP, kind);
    let sidecars: Vec<PathBuf> = SIDECAR_SUFFIXES
        .iter()
        .map(|suffix| PathBuf::from(format!("{}{suffix}", main.display())))
        .collect();
    fs::write(&main, b"x").unwrap();
    sidecars
        .iter()
        .for_each(|path| fs::write(path, b"x").unwrap());
    sidecars
}

#[test]
fn sidecars_are_found_apart_from_the_leftover_itself() {
    let dir = tempfile::tempdir().unwrap();
    let database = database_in(dir.path());
    let mut sidecars = write_with_sidecars(&database, Leftover::Restoring);
    sidecars.sort();

    assert_eq!(
        find(&database, Leftover::Restoring).unwrap(),
        [path_for(&database, STAMP, Leftover::Restoring)]
    );
    assert_eq!(
        find_sidecars(&database, Leftover::Restoring).unwrap(),
        sidecars
    );
    assert!(find_sidecars(&database, Leftover::Prev).unwrap().is_empty());
}

#[test]
fn sidecars_are_never_mistaken_for_pruneable_snapshots() {
    let dir = tempfile::tempdir().unwrap();
    let database = database_in(dir.path());
    write_with_sidecars(&database, Leftover::Restoring);

    assert!(all_snapshots(&database).unwrap().is_empty());
}

#[test]
fn discarding_a_file_removes_its_sidecars_and_tolerates_missing_ones() {
    let dir = tempfile::tempdir().unwrap();
    let database = database_in(dir.path());
    let main = path_for(&database, STAMP, Leftover::Restoring);
    write_with_sidecars(&database, Leftover::Restoring);
    fs::remove_file(format!("{}-wal", main.display())).unwrap();

    discard_with_sidecars(&main).unwrap();

    let names: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
    assert_eq!(names.len(), 1);
}
