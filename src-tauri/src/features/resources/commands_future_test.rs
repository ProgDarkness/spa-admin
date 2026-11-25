use tauri::Manager;

use super::tests::{call_set_active, fixture, lock_session, session_end, sign_in_as, Fixture};
use super::*;
use crate::errors::AppErrorCode;

const FAR_SLOT: &str = "2099-01-02T10:00";

fn execute(fixture: &Fixture, sql: &str) {
    let db: tauri::State<'_, Database> = fixture.app.state();
    db.with_conn(|conn| Ok(conn.execute_batch(sql)?)).unwrap();
}

fn book(fixture: &Fixture, resource_id: i64, starts_at: &str, ends_at: &str) -> i64 {
    let db: tauri::State<'_, Database> = fixture.app.state();
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO appointments (client_id, service_id, resource_id, starts_at, ends_at, \
             status, price_cents_snapshot, duration_min_snapshot) \
             VALUES (1, 1, ?1, ?2, ?3, 'scheduled', 3500, 60)",
            rusqlite::params![resource_id, starts_at, ends_at],
        )?;
        Ok(conn.last_insert_rowid())
    })
    .unwrap()
}

fn with_references() -> Fixture {
    let fixture = fixture();
    execute(
        &fixture,
        "INSERT INTO clients (id, first_name, last_name, national_id, phone, search_key) \
         VALUES (1, 'Ana', 'Perez', 'V-12345678', '0414', 'k'); \
         INSERT INTO services (id, name, name_key, price_cents, duration_min) \
         VALUES (1, 'Facial', 'facial', 3500, 60);",
    );
    fixture
}

fn call_future(fixture: &Fixture, id: i64) -> Result<Vec<FutureAppointment>, AppError> {
    list_future_appointments_of_resource(id, fixture.app.state(), fixture.app.state())
}

#[test]
fn without_a_session_the_future_listing_is_unauthenticated() {
    let fixture = with_references();
    sign_in_as(&fixture, "propietaria");
    session_end(&fixture);

    assert_eq!(
        call_future(&fixture, 1).unwrap_err().code,
        AppErrorCode::Unauthenticated
    );
}

#[test]
fn with_a_locked_session_the_future_listing_is_session_locked() {
    let fixture = with_references();
    sign_in_as(&fixture, "propietaria");
    lock_session(&fixture);

    assert_eq!(
        call_future(&fixture, 1).unwrap_err().code,
        AppErrorCode::SessionLocked
    );
}

#[test]
fn only_users_with_resources_manage_can_list_future_appointments() {
    for username in ["recepcion", "lectura", "sinpermisos", "catalogo"] {
        let fixture = with_references();
        book(&fixture, 1, FAR_SLOT, "2099-01-02T11:00");
        sign_in_as(&fixture, username);

        assert_eq!(
            call_future(&fixture, 1).unwrap_err(),
            AppError::forbidden(),
            "{username}"
        );
    }
    for username in ["propietaria", "gestora"] {
        let fixture = with_references();
        book(&fixture, 1, FAR_SLOT, "2099-01-02T11:00");
        sign_in_as(&fixture, username);

        assert_eq!(call_future(&fixture, 1).unwrap().len(), 1, "{username}");
    }
}

#[test]
fn the_listing_returns_scheduled_future_appointments_of_that_resource_in_order() {
    let fixture = with_references();
    let later = book(&fixture, 1, "2099-01-03T10:00", "2099-01-03T11:00");
    let sooner = book(&fixture, 1, FAR_SLOT, "2099-01-02T11:00");
    book(&fixture, 2, FAR_SLOT, "2099-01-02T11:00");
    book(&fixture, 1, "2001-01-02T10:00", "2001-01-02T11:00");
    sign_in_as(&fixture, "gestora");

    let listed = call_future(&fixture, 1).unwrap();

    let ids: Vec<i64> = listed.iter().map(|appointment| appointment.id).collect();
    assert_eq!(ids, vec![sooner, later]);
}

#[test]
fn an_unknown_resource_is_a_validation_error_on_the_id() {
    let fixture = with_references();
    sign_in_as(&fixture, "gestora");

    assert_eq!(
        call_future(&fixture, 99).unwrap_err(),
        AppError::validation("id")
    );
}

#[test]
fn deactivating_through_the_command_is_blocked_listing_the_appointments_and_keeps_the_resource() {
    let fixture = with_references();
    let blocker = book(&fixture, 1, FAR_SLOT, "2099-01-02T11:00");
    sign_in_as(&fixture, "gestora");

    let blocked = call_set_active(&fixture, 1, false).unwrap_err();

    assert_eq!(
        blocked,
        AppError::resource_has_future_appointments(vec![blocker])
    );
    let still_active = call_list_all(&fixture)
        .into_iter()
        .find(|resource| resource.id == 1)
        .unwrap();
    assert!(still_active.active);
}

fn call_list_all(fixture: &Fixture) -> Vec<ResourceSummary> {
    list_resources(
        ResourceFilter {
            include_inactive: true,
        },
        fixture.app.state(),
        fixture.app.state(),
    )
    .unwrap()
}

#[test]
fn deactivating_succeeds_once_the_blocker_is_cancelled() {
    let fixture = with_references();
    let blocker = book(&fixture, 1, FAR_SLOT, "2099-01-02T11:00");
    sign_in_as(&fixture, "gestora");
    assert!(call_set_active(&fixture, 1, false).is_err());
    execute(
        &fixture,
        &format!("UPDATE appointments SET status = 'cancelled' WHERE id = {blocker}"),
    );

    let deactivated = call_set_active(&fixture, 1, false).unwrap();

    assert!(!deactivated.active);
}

#[test]
fn a_resource_manager_without_appointment_permissions_receives_only_id_and_start() {
    let fixture = with_references();
    let id = book(&fixture, 1, FAR_SLOT, "2099-01-02T11:00");
    execute(
        &fixture,
        &format!("UPDATE appointments SET notes = 'alergia' WHERE id = {id}"),
    );
    sign_in_as(&fixture, "gestora");

    let listed = call_future(&fixture, 1).unwrap();

    assert_eq!(
        serde_json::to_value(listed).unwrap(),
        serde_json::json!([{ "id": id, "startsAt": FAR_SLOT }])
    );
}
