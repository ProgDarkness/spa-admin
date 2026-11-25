use serde_json::json;

use super::*;
use crate::features::appointments::model::AppointmentStatus;

const SECRET: &str = "alergia al latex y medicacion";
const OTHER_SECRET: &str = "prefiere cabina silenciosa";

fn appointment(notes: Option<&str>, status: AppointmentStatus) -> AppointmentSummary {
    AppointmentSummary {
        id: 1,
        client_id: 1,
        service_id: 1,
        resource_id: 1,
        starts_at: "2026-11-12T10:00".to_string(),
        ends_at: "2026-11-12T11:00".to_string(),
        status,
        price_cents_snapshot: 3500,
        duration_min_snapshot: 60,
        notes: notes.map(str::to_string),
    }
}

fn scheduled(notes: Option<&str>) -> AppointmentSummary {
    appointment(notes, AppointmentStatus::Scheduled)
}

fn rendered(diff: Option<Diff>) -> String {
    diff.map(|value| value.to_json()).unwrap_or_default()
}

#[test]
fn the_snapshot_records_only_whether_notes_exist() {
    let with = appointment_snapshot(&scheduled(Some(SECRET)));
    let without = appointment_snapshot(&scheduled(None));

    assert_eq!(with["hasNotes"], json!(true));
    assert_eq!(without["hasNotes"], json!(false));
    assert!(with.get("notes").is_none());
    assert!(!with.to_string().contains(SECRET));
}

#[test]
fn adding_notes_audits_the_flag_and_never_the_text() {
    let diff = appointment_change_diff(&scheduled(None), &scheduled(Some(SECRET)));

    let text = rendered(diff);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&text).unwrap(),
        json!({ "hasNotes": { "before": false, "after": true } })
    );
    assert!(!text.contains(SECRET));
}

#[test]
fn removing_notes_audits_the_flag_and_never_the_text() {
    let text = rendered(appointment_change_diff(
        &scheduled(Some(SECRET)),
        &scheduled(None),
    ));

    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&text).unwrap(),
        json!({ "hasNotes": { "before": true, "after": false } })
    );
    assert!(!text.contains(SECRET));
}

#[test]
fn editing_notes_with_both_present_audits_only_that_they_changed() {
    let text = rendered(appointment_change_diff(
        &scheduled(Some(SECRET)),
        &scheduled(Some(OTHER_SECRET)),
    ));

    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&text).unwrap(),
        json!({ "notesChanged": true })
    );
    assert!(!text.contains(SECRET));
    assert!(!text.contains(OTHER_SECRET));
}

#[test]
fn a_status_change_alongside_edited_notes_keeps_both_facts_without_text() {
    let text = rendered(appointment_change_diff(
        &scheduled(Some(SECRET)),
        &appointment(Some(OTHER_SECRET), AppointmentStatus::Cancelled),
    ));

    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&text).unwrap(),
        json!({
            "notesChanged": true,
            "status": { "before": "scheduled", "after": "cancelled" }
        })
    );
}

#[test]
fn identical_notes_and_fields_produce_no_diff() {
    assert!(appointment_change_diff(&scheduled(Some(SECRET)), &scheduled(Some(SECRET))).is_none());
    assert!(appointment_change_diff(&scheduled(None), &scheduled(None)).is_none());
}

#[test]
fn creating_with_notes_keeps_the_text_out_of_the_stored_audit_row() {
    use crate::features::appointments::fixture_test::{audit_rows, create, facial, fixture};
    let fixture = fixture();
    let mut request = facial(1, "2026-11-12T10:00");
    request.notes = Some(SECRET.to_string());

    create(&fixture, &request);

    let stored = audit_rows(&fixture)[0].diff.clone().unwrap();
    assert!(!stored.contains(SECRET));
    assert!(stored.contains("\"hasNotes\":true"));
}
