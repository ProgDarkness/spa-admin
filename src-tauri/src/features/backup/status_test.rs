use super::*;
use crate::db::DbError;
use crate::features::auth::service::AuthError;
use crate::features::backup::fixture_test::{
    backup_fixture, execute, sign_in_as, BackupFixture, OWNER, RECEPTION,
};

const NOW: &str = "2026-12-10T12:00:00.000Z";

fn insert_row(fixture: &BackupFixture, action: &str, local: &str, utc: &str) {
    execute(
        fixture,
        &format!(
            "INSERT INTO audit_log (occurred_at, occurred_at_utc, action, entity) \
             VALUES ('{local}', '{utc}', '{action}', 'system')"
        ),
    );
}

fn status_at_now(fixture: &BackupFixture) -> Result<BackupStatus, BackupError> {
    backup_status_at(&fixture.database, &fixture.session, NOW)
}

fn signed_in_fixture() -> BackupFixture {
    let fixture = backup_fixture();
    sign_in_as(&fixture, OWNER);
    fixture
}

#[test]
fn without_any_backup_the_reminder_is_due() {
    let fixture = signed_in_fixture();

    let status = status_at_now(&fixture).unwrap();

    assert_eq!(status.last_backup_at, None);
    assert!(status.is_due);
}

#[test]
fn six_days_twenty_three_hours_and_fifty_nine_seconds_is_not_due() {
    let fixture = signed_in_fixture();
    insert_row(
        &fixture,
        "backup_created",
        "2026-12-03T08:00:01",
        "2026-12-03T12:00:01.000Z",
    );

    let status = status_at_now(&fixture).unwrap();

    assert!(!status.is_due);
    assert_eq!(
        status.last_backup_at.as_deref(),
        Some("2026-12-03T08:00:01")
    );
}

#[test]
fn exactly_seven_days_is_due() {
    let fixture = signed_in_fixture();
    insert_row(
        &fixture,
        "backup_created",
        "2026-12-03T08:00:00",
        "2026-12-03T12:00:00.000Z",
    );

    assert!(status_at_now(&fixture).unwrap().is_due);
}

#[test]
fn a_restore_counts_as_a_backup() {
    let fixture = signed_in_fixture();
    insert_row(
        &fixture,
        "backup_restored",
        "2026-12-09T08:00:00",
        "2026-12-09T12:00:00.000Z",
    );

    let status = status_at_now(&fixture).unwrap();

    assert!(!status.is_due);
    assert_eq!(
        status.last_backup_at.as_deref(),
        Some("2026-12-09T08:00:00")
    );
}

#[test]
fn the_most_recent_of_creations_and_restores_is_reported() {
    let fixture = signed_in_fixture();
    insert_row(
        &fixture,
        "backup_restored",
        "2026-11-01T08:00:00",
        "2026-11-01T12:00:00.000Z",
    );
    insert_row(
        &fixture,
        "backup_created",
        "2026-12-08T08:00:00",
        "2026-12-08T12:00:00.000Z",
    );
    insert_row(
        &fixture,
        "backup_created",
        "2026-11-20T08:00:00",
        "2026-11-20T12:00:00.000Z",
    );

    let status = status_at_now(&fixture).unwrap();

    assert_eq!(
        status.last_backup_at.as_deref(),
        Some("2026-12-08T08:00:00")
    );
}

#[test]
fn other_audit_actions_are_not_backups() {
    let fixture = signed_in_fixture();
    insert_row(
        &fixture,
        "logout",
        "2026-12-10T08:00:00",
        "2026-12-10T11:59:00.000Z",
    );

    let status = status_at_now(&fixture).unwrap();

    assert_eq!(status.last_backup_at, None);
    assert!(status.is_due);
}

#[test]
fn the_status_requires_the_backup_permission() {
    let fixture = backup_fixture();
    sign_in_as(&fixture, RECEPTION);

    let outcome = status_at_now(&fixture);

    assert!(matches!(
        outcome,
        Err(BackupError::Auth(AuthError::Forbidden))
    ));
}

#[test]
fn the_status_requires_a_session() {
    let fixture = backup_fixture();

    let outcome = status_at_now(&fixture);

    assert!(matches!(
        outcome,
        Err(BackupError::Auth(AuthError::Unauthenticated))
    ));
}

#[test]
fn an_invalid_reference_instant_is_rejected() {
    let fixture = signed_in_fixture();

    let outcome = backup_status_at(&fixture.database, &fixture.session, "ayer");

    assert!(matches!(
        outcome,
        Err(BackupError::Db(DbError::InvalidInstant))
    ));
}

#[test]
fn the_production_status_measures_against_the_current_clock() {
    let fixture = signed_in_fixture();
    assert!(
        get_backup_status(&fixture.database, &fixture.session)
            .unwrap()
            .is_due
    );
    execute(
        &fixture,
        "INSERT INTO audit_log (occurred_at, occurred_at_utc, action, entity) \
         VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'), \
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'backup_created', 'system')",
    );

    let status = get_backup_status(&fixture.database, &fixture.session).unwrap();

    assert!(!status.is_due);
    assert!(status.last_backup_at.is_some());
}

fn insert_row_relative_to_now(fixture: &BackupFixture, offset: &str) {
    execute(
        fixture,
        &format!(
            "INSERT INTO audit_log (occurred_at, occurred_at_utc, action, entity) \
             VALUES (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'), \
                     strftime('%Y-%m-%dT%H:%M:%fZ', 'now', {offset}), \
                     'backup_created', 'system')"
        ),
    );
}

#[test]
fn the_production_status_with_a_backup_thirty_seconds_short_of_seven_days_is_not_due() {
    let fixture = signed_in_fixture();
    insert_row_relative_to_now(&fixture, "'-7 days', '+30 seconds'");

    let status = get_backup_status(&fixture.database, &fixture.session).unwrap();

    assert!(!status.is_due);
}

#[test]
fn the_production_status_with_a_backup_thirty_seconds_past_seven_days_is_due() {
    let fixture = signed_in_fixture();
    insert_row_relative_to_now(&fixture, "'-7 days', '-30 seconds'");

    let status = get_backup_status(&fixture.database, &fixture.session).unwrap();

    assert!(status.is_due);
    assert!(status.last_backup_at.is_some());
}
