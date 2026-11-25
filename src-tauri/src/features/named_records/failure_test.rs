use super::*;
use crate::errors::AppErrorCode;

fn constraint_failure() -> DbError {
    DbError::Sqlite(rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
        Some("UNIQUE constraint failed: services.name_key".into()),
    ))
}

#[test]
fn validation_maps_to_validation_with_the_field() {
    let mapped = RecordFailure::Validation { field: "name" }.into_app_error("catalog");

    assert_eq!(mapped.code, AppErrorCode::Validation);
    assert_eq!(mapped.field.as_deref(), Some("name"));
}

#[test]
fn database_failure_maps_to_internal_without_leaking_the_cause() {
    let mapped = RecordFailure::Db(constraint_failure()).into_app_error("catalog");

    assert_eq!(mapped, AppError::internal());
    assert!(!format!("{mapped:?}").contains("services"));
}

#[test]
fn log_line_carries_the_scope_prefix_and_the_cause() {
    let line = log_line("payment_methods", &constraint_failure());

    assert!(line.starts_with("payment_methods: "));
    assert_eq!(line, "payment_methods: database error");
}

#[test]
fn log_line_distinguishes_the_scope() {
    let cause = constraint_failure();

    assert_ne!(log_line("catalog", &cause), log_line("resources", &cause));
    assert!(log_line("resources", &cause).starts_with("resources: "));
}
