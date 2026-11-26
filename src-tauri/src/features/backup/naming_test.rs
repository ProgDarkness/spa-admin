use std::path::PathBuf;

use super::*;

#[test]
fn the_default_name_carries_the_local_date_and_minute() {
    assert_eq!(
        default_file_name_at("2026-11-25-2231"),
        "spa-respaldo-2026-11-25-2231.spabak"
    );
}

#[test]
fn the_local_stamp_is_year_month_day_hour_minute() {
    let conn = Connection::open_in_memory().unwrap();

    let stamp = local_stamp_now(&conn).unwrap();

    let shape: Vec<usize> = stamp.split('-').map(str::len).collect();
    assert_eq!(shape, [4, 2, 2, 4]);
    assert!(stamp.chars().all(|c| c.is_ascii_digit() || c == '-'));
}

#[test]
fn the_local_stamp_follows_the_local_clock_not_utc() {
    let conn = Connection::open_in_memory().unwrap();
    let local_minute = || -> String {
        conn.query_row(
            "SELECT strftime('%Y-%m-%d-%H%M', 'now', 'localtime')",
            [],
            |row| row.get(0),
        )
        .unwrap()
    };
    let before = local_minute();

    let stamp = local_stamp_now(&conn).unwrap();

    assert!(stamp == before || stamp == local_minute(), "{stamp}");
}

#[test]
fn a_path_without_extension_gets_it_appended() {
    let path = with_backup_extension(PathBuf::from("/media/usb/respaldo")).unwrap();

    assert_eq!(path, PathBuf::from("/media/usb/respaldo.spabak"));
}

#[test]
fn a_path_that_already_has_the_extension_is_untouched() {
    let path = with_backup_extension(PathBuf::from("/media/usb/respaldo.spabak")).unwrap();

    assert_eq!(path, PathBuf::from("/media/usb/respaldo.spabak"));
}

#[test]
fn the_extension_check_ignores_case() {
    let path = with_backup_extension(PathBuf::from("/media/usb/RESPALDO.SPABAK")).unwrap();

    assert_eq!(path, PathBuf::from("/media/usb/RESPALDO.SPABAK"));
}

#[test]
fn a_different_extension_is_kept_and_the_backup_one_is_appended() {
    let path = with_backup_extension(PathBuf::from("/media/usb/respaldo.2026.txt")).unwrap();

    assert_eq!(path, PathBuf::from("/media/usb/respaldo.2026.txt.spabak"));
}

#[test]
fn a_path_without_file_name_is_rejected() {
    let failure = with_backup_extension(PathBuf::from("/")).unwrap_err();

    assert!(matches!(failure, BackupError::Io(_)));
}
