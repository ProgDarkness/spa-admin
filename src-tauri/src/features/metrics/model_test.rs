use super::*;
use crate::errors::{AppError, AppErrorCode};

#[test]
fn metrics_serialize_with_camel_case_keys_and_iso_currency_buckets() {
    let metrics = MonthlyMetrics {
        month: "2026-11".to_string(),
        new_clients: 2,
        recurring_clients: 1,
        appointments: AppointmentCounts {
            in_progress: 3,
            no_show: 4,
            ..AppointmentCounts::default()
        },
        revenue_by_currency: AmountsByCurrency { usd: 10, ves: 20 },
        collected_on_non_completed_by_currency: AmountsByCurrency::default(),
        pending_by_currency: AmountsByCurrency::default(),
    };

    let value = serde_json::to_value(metrics).unwrap();

    assert_eq!(value["newClients"], 2);
    assert_eq!(value["recurringClients"], 1);
    assert_eq!(value["appointments"]["inProgress"], 3);
    assert_eq!(value["appointments"]["noShow"], 4);
    assert_eq!(value["revenueByCurrency"]["USD"], 10);
    assert_eq!(value["revenueByCurrency"]["VES"], 20);
    assert!(value["collectedOnNonCompletedByCurrency"].is_object());
    assert!(value["pendingByCurrency"].is_object());
}

#[test]
fn an_invalid_month_maps_to_a_validation_error_on_the_month_field() {
    let error = AppError::from(MetricsError::Validation { field: "month" });

    assert_eq!(error.code, AppErrorCode::Validation);
    assert_eq!(error.field.as_deref(), Some("month"));
}

#[test]
fn database_failures_do_not_leak() {
    let error = AppError::from(MetricsError::Db(crate::db::DbError::OperationPanicked));

    assert_eq!(error, AppError::internal());
}

#[test]
fn an_unknown_status_maps_to_a_controlled_internal_error() {
    let error = AppError::from(MetricsError::UnknownStatus);

    assert_eq!(error, AppError::internal());
}

#[test]
fn a_total_above_the_safe_range_maps_to_a_controlled_internal_error() {
    let error = AppError::from(MetricsError::TotalExceedsSafeRange);

    assert_eq!(error, AppError::internal());
}
