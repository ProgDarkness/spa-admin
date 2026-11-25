use tauri::Manager;

use super::*;
use crate::errors::{AppError, AppErrorCode};
use crate::features::auth::service::{Beat, SessionState};
use crate::features::payments::commands_fixture_test::{
    app_fixture, audit_actions, break_audit, database, end_session, lock_session, revoke_owner,
    sign_in_as, AppFixture, APPOINTMENT,
};
use crate::features::payments::model::PaymentCurrency;

fn usd_input(amount_cents: i64) -> PaymentInput {
    PaymentInput {
        appointment_id: APPOINTMENT,
        method_id: 1,
        currency: PaymentCurrency::Usd,
        amount_cents,
        rate_bs_per_usd_e4: None,
    }
}

fn ves_input(amount_cents: i64, rate: Option<i64>) -> PaymentInput {
    PaymentInput {
        method_id: 2,
        currency: PaymentCurrency::Ves,
        rate_bs_per_usd_e4: rate,
        ..usd_input(amount_cents)
    }
}

fn void_request(id: i64, reason: &str) -> PaymentVoidRequest {
    PaymentVoidRequest {
        id,
        reason: reason.to_string(),
    }
}

fn call_list(fixture: &AppFixture) -> Result<Vec<PaymentSummary>, AppError> {
    list_payments(APPOINTMENT, fixture.app.state(), fixture.app.state())
}

fn call_list_all(fixture: &AppFixture) -> Result<Vec<PaymentSummary>, AppError> {
    list_all_payments(fixture.app.state(), fixture.app.state())
}

fn call_create(fixture: &AppFixture, input: PaymentInput) -> Result<PaymentSummary, AppError> {
    create_payment(input, fixture.app.state(), fixture.app.state())
}

fn call_void(fixture: &AppFixture, id: i64, reason: &str) -> Result<PaymentSummary, AppError> {
    void_payment(
        void_request(id, reason),
        fixture.app.state(),
        fixture.app.state(),
    )
}

fn seed_payment(fixture: &AppFixture) -> PaymentSummary {
    sign_in_as(fixture, "propietaria");
    call_create(fixture, usd_input(3500)).unwrap()
}

fn stored_payments(fixture: &AppFixture) -> Vec<PaymentSummary> {
    database(fixture)
        .with_conn(repository::list_all_payments)
        .unwrap()
}

type Outcomes = Vec<(&'static str, Result<(), AppError>)>;

fn write_commands(fixture: &AppFixture, target: &PaymentSummary) -> Outcomes {
    vec![
        (
            "create_payment",
            call_create(fixture, usd_input(1000)).map(|_| ()),
        ),
        (
            "void_payment",
            call_void(fixture, target.id, "error").map(|_| ()),
        ),
    ]
}

fn every_command(fixture: &AppFixture, target: &PaymentSummary) -> Outcomes {
    let mut outcomes: Outcomes = vec![
        ("list_payments", call_list(fixture).map(|_| ())),
        ("list_all_payments", call_list_all(fixture).map(|_| ())),
    ];
    outcomes.extend(write_commands(fixture, target));
    outcomes
}

fn assert_all_fail_with(outcomes: Outcomes, code: AppErrorCode) {
    for (name, outcome) in outcomes {
        assert_eq!(outcome.expect_err(name).code, code, "{name}");
    }
}

#[test]
fn every_payment_command_without_session_is_unauthenticated() {
    let fixture = app_fixture();
    let target = seed_payment(&fixture);
    end_session(&fixture);

    assert_all_fail_with(
        every_command(&fixture, &target),
        AppErrorCode::Unauthenticated,
    );

    assert_eq!(stored_payments(&fixture), vec![target]);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn every_payment_command_with_a_locked_session_is_session_locked() {
    let fixture = app_fixture();
    let target = seed_payment(&fixture);
    lock_session(&fixture);

    assert_all_fail_with(
        every_command(&fixture, &target),
        AppErrorCode::SessionLocked,
    );

    assert_eq!(stored_payments(&fixture), vec![target]);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn a_read_only_user_can_list_and_every_write_is_forbidden() {
    let fixture = app_fixture();
    let target = seed_payment(&fixture);
    sign_in_as(&fixture, "lectura");

    assert_all_fail_with(write_commands(&fixture, &target), AppErrorCode::Forbidden);

    assert_eq!(call_list(&fixture).unwrap(), vec![target.clone()]);
    assert_eq!(call_list_all(&fixture).unwrap(), vec![target.clone()]);
    assert_eq!(stored_payments(&fixture), vec![target]);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn a_writer_without_the_read_permission_can_still_list_create_and_void() {
    let fixture = app_fixture();
    let target = seed_payment(&fixture);
    sign_in_as(&fixture, "pagoescritor");

    let listed = call_list(&fixture).unwrap();
    let created = call_create(&fixture, usd_input(1000)).unwrap();
    let voided = call_void(&fixture, target.id, "error").unwrap();

    assert_eq!(listed, vec![target]);
    assert_eq!(created.amount_cents, 1000);
    assert!(voided.voided_at.is_some());
}

#[test]
fn users_without_any_payment_permission_are_forbidden_everywhere() {
    for username in ["sinpermisos", "recursos", "citasclientes"] {
        let fixture = app_fixture();
        let target = seed_payment(&fixture);
        sign_in_as(&fixture, username);

        assert_all_fail_with(every_command(&fixture, &target), AppErrorCode::Forbidden);

        assert_eq!(stored_payments(&fixture), vec![target], "{username}");
        assert_eq!(audit_actions(&fixture), ["create"], "{username}");
    }
}

#[test]
fn the_receptionist_creates_and_voids_with_her_own_attribution() {
    let fixture = app_fixture();
    sign_in_as(&fixture, "recepcion");
    let actor: i64 = database(&fixture)
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT id FROM users WHERE username = 'recepcion'",
                [],
                |row| row.get(0),
            )?)
        })
        .unwrap();

    let created = call_create(&fixture, usd_input(2500)).unwrap();
    let voided = call_void(&fixture, created.id, "Monto digitado por error").unwrap();

    assert_eq!(voided.voided_by, Some(actor));
    assert_eq!(audit_actions(&fixture), ["create", "void"]);
}

#[test]
fn a_ves_payment_without_rate_uses_the_rate_registered_for_today() {
    let fixture = app_fixture();
    sign_in_as(&fixture, "propietaria");
    database(&fixture)
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO exchange_rates (date, rate_bs_per_usd_e4) \
                 VALUES (date('now', 'localtime'), 365000)",
                [],
            )?;
            Ok(())
        })
        .unwrap();

    let created = call_create(&fixture, ves_input(182_500, None)).unwrap();

    assert_eq!(created.rate_bs_per_usd_e4, Some(365_000));
    assert_eq!(created.usd_equivalent_cents, 5000);
}

#[test]
fn domain_errors_reach_the_caller_with_their_code_field_and_ids() {
    let fixture = app_fixture();
    let target = seed_payment(&fixture);
    call_void(&fixture, target.id, "primera").unwrap();

    let missing_rate = call_create(&fixture, ves_input(1000, None)).unwrap_err();
    let twice = call_void(&fixture, target.id, "segunda").unwrap_err();
    let no_reason = call_void(&fixture, target.id, "  ").unwrap_err();
    let unknown = call_void(&fixture, 999, "error").unwrap_err();
    let no_appointment = call_create(
        &fixture,
        PaymentInput {
            appointment_id: 999,
            ..usd_input(1000)
        },
    )
    .unwrap_err();

    assert_eq!(missing_rate.code, AppErrorCode::RateMissing);
    assert_eq!(missing_rate.field.as_deref(), Some("rateBsPerUsdE4"));
    assert_eq!(twice.code, AppErrorCode::AlreadyVoided);
    assert_eq!(twice.entity_ids, Some(vec![target.id]));
    assert_eq!(no_reason.code, AppErrorCode::Validation);
    assert_eq!(no_reason.field.as_deref(), Some("reason"));
    assert_eq!(unknown, AppError::payment_not_found());
    assert_eq!(no_appointment.field.as_deref(), Some("appointmentId"));
    assert_eq!(no_appointment.code, AppErrorCode::NotFound);
}

#[test]
fn a_failing_audit_rolls_back_every_write_command_and_reports_internal() {
    let fixture = app_fixture();
    let target = seed_payment(&fixture);
    break_audit(&fixture);

    let on_create = call_create(&fixture, usd_input(1000)).unwrap_err();
    let on_void = call_void(&fixture, target.id, "error").unwrap_err();

    assert_eq!(on_create, AppError::internal());
    assert_eq!(on_void, AppError::internal());
    assert_eq!(stored_payments(&fixture), vec![target]);
}

#[test]
fn losing_the_write_permission_between_calls_blocks_the_next_write() {
    let fixture = app_fixture();
    let target = seed_payment(&fixture);
    revoke_owner(&fixture, "payments.write");

    assert_all_fail_with(write_commands(&fixture, &target), AppErrorCode::Forbidden);

    assert_eq!(stored_payments(&fixture), vec![target]);
}

#[test]
fn every_transactional_write_revalidates_the_permission_inside_the_transaction() {
    let fixture = app_fixture();
    let target = seed_payment(&fixture);
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    authorize_outside_transaction(&database(&fixture), &session).unwrap();
    revoke_owner(&fixture, "payments.write");

    let on_create = database(&fixture)
        .with_tx(|tx| create_payment_in_transaction(tx, &session, Beat::now(), &usd_input(1000)))
        .map_err(AppError::from);
    let on_void = database(&fixture)
        .with_tx(|tx| {
            void_payment_in_transaction(
                tx,
                &session,
                Beat::now(),
                &void_request(target.id, "error"),
            )
        })
        .map_err(AppError::from);

    assert_eq!(on_create.unwrap_err(), AppError::forbidden());
    assert_eq!(on_void.unwrap_err(), AppError::forbidden());
    assert_eq!(stored_payments(&fixture), vec![target]);
    assert_eq!(audit_actions(&fixture), ["create"]);
}

#[test]
fn an_idle_session_found_inside_the_transaction_is_locked_and_nothing_is_written() {
    let fixture = app_fixture();
    let target = seed_payment(&fixture);
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    let now = Beat::now();
    let by = crate::features::auth::service::IDLE_TIMEOUT + std::time::Duration::from_secs(1);
    let late = Beat {
        mono: now.mono + by,
        wall: now.wall + by,
    };

    let outcome = database(&fixture)
        .with_tx(|tx| create_payment_in_transaction(tx, &session, late, &usd_input(1000)))
        .map_err(AppError::from);

    assert_eq!(outcome.unwrap_err().code, AppErrorCode::SessionLocked);
    assert_eq!(stored_payments(&fixture), vec![target]);
}
