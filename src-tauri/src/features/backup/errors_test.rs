use super::*;
use crate::errors::AppError;

#[test]
fn backup_specific_failures_map_to_their_own_codes() {
    assert_eq!(
        AppError::from(BackupError::NotRecognized),
        AppError::backup_not_recognized()
    );
    assert_eq!(
        AppError::from(BackupError::FromNewerApp),
        AppError::backup_from_newer_app()
    );
    assert_eq!(
        AppError::from(BackupError::Unreadable),
        AppError::backup_unreadable()
    );
}

#[test]
fn validation_keeps_the_offending_field() {
    let error = AppError::from(BackupError::Validation {
        field: "passphrase",
    });

    assert_eq!(error, AppError::validation("passphrase"));
}

#[test]
fn auth_failures_keep_their_auth_mapping() {
    assert_eq!(
        AppError::from(BackupError::Auth(AuthError::Forbidden)),
        AppError::forbidden()
    );
    assert_eq!(
        AppError::from(BackupError::Auth(AuthError::Locked)),
        AppError::session_locked()
    );
    assert_eq!(
        AppError::from(BackupError::Auth(AuthError::Unauthenticated)),
        AppError::unauthenticated()
    );
}

#[test]
fn infrastructure_failures_do_not_leak_details() {
    let failures = [
        BackupError::Db(DbError::OperationPanicked),
        BackupError::Io(io::Error::other("/secret/path")),
        BackupError::KeyStore(KeyStoreError::Malformed),
        BackupError::Crypto,
        BackupError::TooLarge,
        BackupError::RollbackFailed,
    ];

    for failure in failures {
        assert_eq!(AppError::from(failure), AppError::internal());
    }
}

#[test]
fn a_failed_rollback_has_a_fixed_message_that_leaks_nothing() {
    assert_eq!(
        BackupError::RollbackFailed.to_string(),
        "restore could not be undone"
    );
}
