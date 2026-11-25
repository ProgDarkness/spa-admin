use serde_json::json;

use super::*;
use crate::errors::{AppError, AppErrorCode};

#[test]
fn amounts_serialize_with_iso_currency_keys() {
    let amounts = AmountsByCurrency {
        usd: 1500,
        ves: 73_000,
    };

    assert_eq!(
        serde_json::to_value(amounts).unwrap(),
        json!({ "USD": 1500, "VES": 73_000 })
    );
}

#[test]
fn empty_amounts_are_zero_in_both_currencies() {
    assert_eq!(
        AmountsByCurrency::default(),
        AmountsByCurrency { usd: 0, ves: 0 }
    );
}

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
