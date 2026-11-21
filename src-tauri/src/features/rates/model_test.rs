use super::*;
use crate::db::DbError;
use crate::errors::AppErrorCode;
use crate::features::audit::{AuditAction, AuditEntity};
use crate::features::auth::service::AuthError;

#[test]
fn max_rate_matches_the_frontend_limit() {
    assert_eq!(MAX_RATE_E4, 100_000_000_000);
}

#[test]
fn exchange_rate_serializes_in_camel_case() {
    let rate = ExchangeRate {
        date: "2026-11-12".into(),
        rate_bs_per_usd_e4: 365_000,
    };

    let json = serde_json::to_value(&rate).unwrap();

    assert_eq!(
        json,
        serde_json::json!({"date": "2026-11-12", "rateBsPerUsdE4": 365000})
    );
}

#[test]
fn real_calendar_dates_are_accepted() {
    for date in [
        "2026-01-01",
        "2026-11-12",
        "2026-12-31",
        "2026-04-30",
        "2026-02-28",
        "2024-02-29",
        "2000-02-29",
        "2000-01-01",
        "2099-12-31",
    ] {
        assert!(is_calendar_date(date), "{date}");
    }
}

#[test]
fn impossible_calendar_dates_are_rejected() {
    for date in [
        "2026-02-30",
        "2026-02-29",
        "1900-02-29",
        "2100-02-29",
        "2024-02-30",
        "2026-04-31",
        "2026-06-31",
        "2026-09-31",
        "2026-11-31",
        "2026-13-01",
        "2026-00-10",
        "2026-01-00",
        "2026-01-32",
        "0000-01-01",
    ] {
        assert!(!is_calendar_date(date), "{date}");
    }
}

#[test]
fn dates_outside_the_supported_years_are_rejected() {
    for date in ["0001-01-01", "1999-12-31", "2100-01-01", "9999-12-31"] {
        assert!(!is_calendar_date(date), "{date}");
    }
}

#[test]
fn malformed_dates_are_rejected() {
    for date in [
        "",
        "2026-1-12",
        "2026-11-1",
        "12-11-2026",
        "2026/11/12",
        "2026/11-12",
        "2026-11/12",
        "2026-11-12 ",
        " 2026-11-12",
        "2026-11-12T10:00",
        "20261112",
        "2026-11-123",
        "26-11-12",
        "abcd-ef-gh",
        "2026-11-1a",
        "+026-11-12",
        "２０２６-11-12",
        "2026-11-1\u{0663}",
        "2026-11-12\n",
        "2026–11–12",
    ] {
        assert!(!is_calendar_date(date), "{date:?}");
    }
}

#[test]
fn validation_maps_to_validation_with_field() {
    let mapped = AppError::from(RatesError::Validation { field: "date" });

    assert_eq!(mapped.code, AppErrorCode::Validation);
    assert_eq!(mapped.field.as_deref(), Some("date"));
}

#[test]
fn auth_errors_delegate_to_the_auth_mapping() {
    assert_eq!(
        AppError::from(RatesError::Auth(AuthError::Forbidden)),
        AppError::forbidden()
    );
    assert_eq!(
        AppError::from(RatesError::Auth(AuthError::Locked)),
        AppError::session_locked()
    );
    assert_eq!(
        AppError::from(RatesError::Auth(AuthError::Unauthenticated)),
        AppError::unauthenticated()
    );
}

#[test]
fn database_errors_map_to_internal_without_the_cause() {
    let error = RatesError::Db(DbError::Sqlite(rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
        Some("UNIQUE constraint failed: exchange_rates.date".into()),
    )));

    let mapped = AppError::from(error);

    assert_eq!(mapped, AppError::internal());
    assert!(!format!("{mapped:?}").contains("exchange_rates"));
}

#[test]
fn log_scope_names_the_slice() {
    assert_eq!(LOG_SCOPE, "rates");
}

#[test]
fn the_audit_vocabulary_allows_create_and_update_of_exchange_rates() {
    assert!(AuditAction::Create.allows(AuditEntity::ExchangeRate));
    assert!(AuditAction::Update.allows(AuditEntity::ExchangeRate));
    assert_eq!(AuditEntity::ExchangeRate.as_str(), "exchange_rate");
}
