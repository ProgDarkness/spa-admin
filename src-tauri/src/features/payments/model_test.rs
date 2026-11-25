use serde_json::json;

use super::*;
use crate::errors::AppErrorCode;

fn app_error_of(error: PaymentError) -> AppError {
    AppError::from(error)
}

#[test]
fn currency_serializes_as_the_iso_code_and_round_trips() {
    assert_eq!(
        serde_json::to_value(PaymentCurrency::Usd).unwrap(),
        json!("USD")
    );
    assert_eq!(
        serde_json::to_value(PaymentCurrency::Ves).unwrap(),
        json!("VES")
    );
    for currency in [PaymentCurrency::Usd, PaymentCurrency::Ves] {
        assert_eq!(PaymentCurrency::parse(currency.as_str()), Some(currency));
    }
    assert_eq!(PaymentCurrency::parse("usd"), None);
    assert_eq!(PaymentCurrency::parse("EUR"), None);
}

#[test]
fn input_deserializes_camel_case_with_a_nullable_rate() {
    let input: PaymentInput = serde_json::from_value(json!({
        "appointmentId": 1,
        "methodId": 2,
        "currency": "VES",
        "amountCents": 5000,
        "rateBsPerUsdE4": null
    }))
    .unwrap();

    assert_eq!(input.currency, PaymentCurrency::Ves);
    assert_eq!(input.rate_bs_per_usd_e4, None);
}

#[test]
fn summary_serializes_with_the_names_the_front_expects() {
    let summary = PaymentSummary {
        id: 1,
        appointment_id: 2,
        method_id: 3,
        currency: PaymentCurrency::Usd,
        amount_cents: 3500,
        rate_bs_per_usd_e4: None,
        usd_equivalent_cents: 3500,
        paid_at: "2026-11-12T11:00".to_string(),
        voided_at: None,
        voided_by: None,
        void_reason: None,
    };

    let value = serde_json::to_value(summary).unwrap();

    assert_eq!(
        value,
        json!({
            "id": 1,
            "appointmentId": 2,
            "methodId": 3,
            "currency": "USD",
            "amountCents": 3500,
            "rateBsPerUsdE4": null,
            "usdEquivalentCents": 3500,
            "paidAt": "2026-11-12T11:00",
            "voidedAt": null,
            "voidedBy": null,
            "voidReason": null
        })
    );
}

#[test]
fn rate_missing_maps_to_its_code_with_the_rate_field() {
    let error = app_error_of(PaymentError::RateMissing);

    assert_eq!(error.code, AppErrorCode::RateMissing);
    assert_eq!(error.field.as_deref(), Some("rateBsPerUsdE4"));
}

#[test]
fn already_voided_maps_to_its_code_with_the_payment_id() {
    let error = app_error_of(PaymentError::AlreadyVoided { payment_id: 7 });

    assert_eq!(error.code, AppErrorCode::AlreadyVoided);
    assert_eq!(error.entity_ids, Some(vec![7]));
}

#[test]
fn missing_payment_and_references_map_to_not_found() {
    let payment = app_error_of(PaymentError::NotFound);
    let appointment = app_error_of(PaymentError::ReferenceMissing {
        field: "appointmentId",
    });
    let method = app_error_of(PaymentError::ReferenceMissing { field: "methodId" });

    assert_eq!(payment.code, AppErrorCode::NotFound);
    assert_eq!(payment.field, None);
    assert_eq!(appointment.code, AppErrorCode::NotFound);
    assert_eq!(appointment.field.as_deref(), Some("appointmentId"));
    assert_eq!(appointment.message, "La cita no existe");
    assert_eq!(method.field.as_deref(), Some("methodId"));
    assert_eq!(method.message, "El método de pago no existe");
}

#[test]
fn validation_keeps_the_field_and_database_failures_do_not_leak() {
    let validation = app_error_of(PaymentError::Validation { field: "reason" });
    let database = app_error_of(PaymentError::Db(DbError::OperationPanicked));

    assert_eq!(validation.code, AppErrorCode::Validation);
    assert_eq!(validation.field.as_deref(), Some("reason"));
    assert_eq!(database, AppError::internal());
}

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
