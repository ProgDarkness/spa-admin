use tauri::Manager;

use super::*;
use crate::errors::{AppError, AppErrorCode};
use crate::features::payments::commands_fixture_test::{
    app_fixture, database, end_session, lock_session, revoke_owner, sign_in_as, AppFixture,
};

const CLIENT: i64 = 1;

fn call_history(fixture: &AppFixture, client_id: i64) -> Result<ClientHistory, AppError> {
    get_client_history(client_id, fixture.app.state(), fixture.app.state())
}

fn add_payment(fixture: &AppFixture) {
    database(fixture)
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO appointment_payments (appointment_id, method_id, currency, \
                 amount_cents, usd_equivalent_cents, paid_at) \
                 VALUES (1, 1, 'USD', 3500, 3500, '2026-11-12T11:00')",
                [],
            )?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn the_owner_gets_the_history_with_entries_and_totals() {
    let fixture = app_fixture();
    add_payment(&fixture);
    sign_in_as(&fixture, "propietaria");

    let history = call_history(&fixture, CLIENT).unwrap();

    assert_eq!(history.client.id, CLIENT);
    assert_eq!(history.entries.len(), 1);
    assert_eq!(history.entries[0].payments.len(), 1);
    assert_eq!(history.total_minutes, 60);
    assert_eq!(history.paid_by_currency.usd, 3500);
}

#[test]
fn the_read_only_role_has_the_three_permissions_and_can_read_the_history() {
    let fixture = app_fixture();
    sign_in_as(&fixture, "lectura");

    assert!(call_history(&fixture, CLIENT).is_ok());
}

#[test]
fn missing_any_of_the_three_read_permissions_is_forbidden() {
    for username in [
        "citasclientes",
        "pagoscitas",
        "pagosclientes",
        "pagoescritor",
        "sinpermisos",
    ] {
        let fixture = app_fixture();
        sign_in_as(&fixture, username);

        let error = call_history(&fixture, CLIENT).unwrap_err();

        assert_eq!(error, AppError::forbidden(), "{username}");
    }
}

#[test]
fn the_permission_is_decided_before_looking_the_client_up() {
    let fixture = app_fixture();
    sign_in_as(&fixture, "citasclientes");

    let error = call_history(&fixture, 999).unwrap_err();

    assert_eq!(error, AppError::forbidden());
}

#[test]
fn an_unknown_client_is_not_found_for_an_authorized_user() {
    let fixture = app_fixture();
    sign_in_as(&fixture, "propietaria");

    let error = call_history(&fixture, 999).unwrap_err();

    assert_eq!(error, AppError::not_found());
}

#[test]
fn without_session_or_with_a_locked_one_the_history_is_refused() {
    let fixture = app_fixture();
    sign_in_as(&fixture, "propietaria");
    lock_session(&fixture);
    let locked = call_history(&fixture, CLIENT).unwrap_err();
    end_session(&fixture);
    let unauthenticated = call_history(&fixture, CLIENT).unwrap_err();

    assert_eq!(locked.code, AppErrorCode::SessionLocked);
    assert_eq!(unauthenticated.code, AppErrorCode::Unauthenticated);
}

#[test]
fn losing_one_permission_blocks_the_next_read() {
    let fixture = app_fixture();
    sign_in_as(&fixture, "propietaria");
    revoke_owner(&fixture, "payments.read");

    let error = call_history(&fixture, CLIENT).unwrap_err();

    assert_eq!(error, AppError::forbidden());
}
