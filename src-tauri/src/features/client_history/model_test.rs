use super::*;
use crate::errors::{AppError, AppErrorCode};

#[test]
fn a_missing_client_maps_to_not_found() {
    let error = AppError::from(ClientHistoryError::NotFound);

    assert_eq!(error, AppError::not_found());
    assert_eq!(error.code, AppErrorCode::NotFound);
}

#[test]
fn database_failures_do_not_leak() {
    let error = AppError::from(ClientHistoryError::Db(
        crate::db::DbError::OperationPanicked,
    ));

    assert_eq!(error, AppError::internal());
}

#[test]
fn a_total_above_the_safe_range_maps_to_a_controlled_internal_error() {
    let error = AppError::from(ClientHistoryError::TotalExceedsSafeRange);

    assert_eq!(error, AppError::internal());
    assert_eq!(error.code, AppErrorCode::Internal);
}
