use super::*;
use crate::features::appointments::model::AppointmentStatus;
use crate::features::payments::fixture_test::{appointment_with_status, fixture, usd};

#[test]
fn the_clock_backed_wrappers_stamp_the_local_minute_on_create_and_void() {
    let fixture = fixture();
    let appointment = appointment_with_status(&fixture, AppointmentStatus::Completed);
    let actor = fixture.actor;
    let before = fixture.database.with_conn(local_minute_now).unwrap();

    let (created, voided) = fixture
        .database
        .with_tx(|tx| -> Result<_, PaymentError> {
            let created = create_payment(tx, actor, &usd(appointment, 3500))?;
            let request = PaymentVoidRequest {
                id: created.id,
                reason: "error".to_string(),
            };
            let voided = void_payment(tx, actor, &request)?;
            Ok((created, voided))
        })
        .unwrap();

    let after = fixture.database.with_conn(local_minute_now).unwrap();
    let voided_at = voided.voided_at.unwrap();
    assert!(before <= created.paid_at && created.paid_at <= voided_at && voided_at <= after);
}
