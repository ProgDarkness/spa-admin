use tauri::Manager;

use super::*;
use crate::errors::{AppError, AppErrorCode};
use crate::features::auth::service::{Beat, SessionState, IDLE_TIMEOUT};
use crate::features::metrics::model::AppointmentCounts;
use crate::features::payments::commands_fixture_test::{
    app_fixture, database, end_session, lock_session, revoke_owner, sign_in_as, AppFixture,
};

const NOVEMBER: &str = "2026-11";

fn call_metrics(fixture: &AppFixture, month: &str) -> Result<MonthlyMetrics, AppError> {
    get_monthly_metrics(month.to_string(), fixture.app.state(), fixture.app.state())
}

#[test]
fn the_owner_gets_the_month_metrics() {
    let fixture = app_fixture();
    sign_in_as(&fixture, "propietaria");

    let metrics = call_metrics(&fixture, NOVEMBER).unwrap();

    assert_eq!(metrics.month, NOVEMBER);
    assert_eq!(metrics.appointments.completed, 1);
    assert_eq!(metrics.new_clients, 1);
    assert_eq!(metrics.recurring_clients, 0);
}

#[test]
fn a_month_without_appointments_is_all_zeros() {
    let fixture = app_fixture();
    sign_in_as(&fixture, "propietaria");

    let metrics = call_metrics(&fixture, "2026-10").unwrap();

    assert_eq!(metrics.appointments, AppointmentCounts::default());
    assert_eq!(metrics.new_clients, 0);
}

#[test]
fn every_role_without_the_metrics_permission_is_forbidden() {
    for username in [
        "recepcion",
        "lectura",
        "pagoescritor",
        "citasclientes",
        "sinpermisos",
    ] {
        let fixture = app_fixture();
        sign_in_as(&fixture, username);

        let error = call_metrics(&fixture, NOVEMBER).unwrap_err();

        assert_eq!(error, AppError::forbidden(), "{username}");
    }
}

#[test]
fn the_permission_is_decided_before_validating_the_month() {
    let fixture = app_fixture();
    sign_in_as(&fixture, "recepcion");

    let error = call_metrics(&fixture, "not-a-month").unwrap_err();

    assert_eq!(error, AppError::forbidden());
}

#[test]
fn an_invalid_month_is_a_validation_error_on_the_month_field() {
    let fixture = app_fixture();
    sign_in_as(&fixture, "propietaria");

    let error = call_metrics(&fixture, "2026-13").unwrap_err();

    assert_eq!(error.code, AppErrorCode::Validation);
    assert_eq!(error.field.as_deref(), Some("month"));
}

#[test]
fn without_session_or_with_a_locked_one_the_metrics_are_refused() {
    let fixture = app_fixture();
    sign_in_as(&fixture, "propietaria");
    lock_session(&fixture);
    let locked = call_metrics(&fixture, NOVEMBER).unwrap_err();
    end_session(&fixture);
    let unauthenticated = call_metrics(&fixture, NOVEMBER).unwrap_err();

    assert_eq!(locked.code, AppErrorCode::SessionLocked);
    assert_eq!(unauthenticated.code, AppErrorCode::Unauthenticated);
}

#[test]
fn losing_the_permission_blocks_the_next_read() {
    let fixture = app_fixture();
    sign_in_as(&fixture, "propietaria");
    revoke_owner(&fixture, "metrics.read");

    let error = call_metrics(&fixture, NOVEMBER).unwrap_err();

    assert_eq!(error, AppError::forbidden());
}

#[test]
fn the_read_revalidates_the_permission_inside_the_transaction() {
    let fixture = app_fixture();
    sign_in_as(&fixture, "propietaria");
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    authorize_outside_transaction(&database(&fixture), &session).unwrap();
    revoke_owner(&fixture, "metrics.read");

    let outcome = database(&fixture)
        .with_tx(|tx| metrics_in_transaction(tx, &session, Beat::now(), NOVEMBER))
        .map_err(AppError::from);

    assert_eq!(outcome.unwrap_err(), AppError::forbidden());
}

#[test]
fn an_idle_session_found_inside_the_transaction_is_locked() {
    let fixture = app_fixture();
    sign_in_as(&fixture, "propietaria");
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    let now = Beat::now();
    let by = IDLE_TIMEOUT + std::time::Duration::from_secs(1);
    let late = Beat {
        mono: now.mono + by,
        wall: now.wall + by,
    };

    let outcome = database(&fixture)
        .with_tx(|tx| metrics_in_transaction(tx, &session, late, NOVEMBER))
        .map_err(AppError::from);

    assert_eq!(outcome.unwrap_err().code, AppErrorCode::SessionLocked);
}
