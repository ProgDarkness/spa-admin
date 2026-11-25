use rusqlite::Connection;

use super::*;
use crate::db::migrate;

const FIRST_SLOT: &str = "2026-11-12T10:00";
const NOON: &str = "2026-11-12T12:00";

fn database() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn.execute_batch(
        "INSERT INTO users (username, password_hash, role_id) VALUES ('ana', 'h', 1);
         INSERT INTO clients (first_name, last_name, national_id, phone, search_key) VALUES
            ('Ana', 'Perez', 'V-12345678', '0414', 'k'),
            ('Luis', 'Gil', 'V-87654321', '0414', 'k');
         INSERT INTO services (name, name_key, price_cents, duration_min) VALUES
            ('Facial', 'facial', 3500, 60);",
    )
    .unwrap();
    conn
}

fn new_appointment(resource_id: i64, starts_at: &str, ends_at: &str) -> NewAppointment {
    NewAppointment {
        client_id: 1,
        service_id: 1,
        resource_id,
        starts_at: starts_at.to_string(),
        ends_at: ends_at.to_string(),
        price_cents_snapshot: 3500,
        duration_min_snapshot: duration_between(starts_at, ends_at),
        notes: None,
    }
}

fn duration_between(starts_at: &str, ends_at: &str) -> i64 {
    let minutes = |text: &str| -> i64 {
        let hour: i64 = text[11..13].parse().unwrap();
        let minute: i64 = text[14..16].parse().unwrap();
        hour * 60 + minute
    };
    let same_day = if ends_at[..10] == starts_at[..10] {
        0
    } else {
        1_440
    };
    minutes(ends_at) + same_day - minutes(starts_at)
}

fn add(conn: &Connection, resource_id: i64, starts_at: &str, ends_at: &str) -> i64 {
    insert_appointment(conn, &new_appointment(resource_id, starts_at, ends_at), 1).unwrap()
}

fn add_with_status(
    conn: &Connection,
    resource_id: i64,
    starts_at: &str,
    ends_at: &str,
    status: AppointmentStatus,
) -> i64 {
    let id = add(conn, resource_id, starts_at, ends_at);
    set_status(conn, id, status, 1).unwrap();
    id
}

fn day_range(day: &str, resource_id: Option<i64>) -> AppointmentRange {
    AppointmentRange {
        from: day.to_string(),
        to: day.to_string(),
        resource_id,
    }
}

fn ids_of(rows: &[AppointmentSummary]) -> Vec<i64> {
    rows.iter().map(|row| row.id).collect()
}

#[test]
fn an_inserted_appointment_is_found_with_every_column() {
    let conn = database();
    let mut draft = new_appointment(1, FIRST_SLOT, "2026-11-12T11:00");
    draft.notes = Some("traer bata".to_string());

    let id = insert_appointment(&conn, &draft, 1).unwrap();
    let found = find_appointment(&conn, id).unwrap().unwrap();

    assert_eq!(
        found,
        AppointmentSummary {
            id,
            client_id: 1,
            service_id: 1,
            resource_id: 1,
            starts_at: FIRST_SLOT.to_string(),
            ends_at: "2026-11-12T11:00".to_string(),
            status: AppointmentStatus::Scheduled,
            price_cents_snapshot: 3500,
            duration_min_snapshot: 60,
            notes: Some("traer bata".to_string()),
        }
    );
}

#[test]
fn insert_records_the_actor_as_creator_and_updater() {
    let conn = database();
    let id = add(&conn, 1, FIRST_SLOT, "2026-11-12T11:00");

    let (created_by, updated_by): (i64, i64) = conn
        .query_row(
            "SELECT created_by, updated_by FROM appointments WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert_eq!((created_by, updated_by), (1, 1));
}

#[test]
fn a_missing_appointment_is_none() {
    assert_eq!(find_appointment(&database(), 99).unwrap(), None);
}

#[test]
fn an_unknown_stored_status_is_reported_instead_of_defaulted() {
    let conn = database();
    let id = add(&conn, 1, FIRST_SLOT, "2026-11-12T11:00");
    conn.execute_batch("PRAGMA ignore_check_constraints = ON;")
        .unwrap();
    conn.execute("UPDATE appointments SET status = 'bogus'", [])
        .unwrap();

    assert!(find_appointment(&conn, id).is_err());
}

#[test]
fn an_end_equal_to_the_other_start_does_not_overlap() {
    let conn = database();
    add(&conn, 1, FIRST_SLOT, "2026-11-12T11:00");

    assert!(
        find_overlaps(&conn, 1, "2026-11-12T11:00", "2026-11-12T12:00", None)
            .unwrap()
            .is_empty()
    );
    assert!(
        find_overlaps(&conn, 1, "2026-11-12T09:00", FIRST_SLOT, None)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn any_shared_minute_overlaps_including_containment() {
    let conn = database();
    let existing = add(&conn, 1, FIRST_SLOT, "2026-11-12T11:00");

    for (starts_at, ends_at) in [
        ("2026-11-12T10:55", "2026-11-12T11:55"),
        ("2026-11-12T09:30", "2026-11-12T10:05"),
        ("2026-11-12T10:15", "2026-11-12T10:45"),
        ("2026-11-12T09:00", "2026-11-12T12:00"),
        (FIRST_SLOT, "2026-11-12T11:00"),
    ] {
        assert_eq!(
            find_overlaps(&conn, 1, starts_at, ends_at, None).unwrap(),
            vec![existing],
            "{starts_at}"
        );
    }
}

#[test]
fn cancelled_and_no_show_appointments_free_the_slot() {
    let conn = database();
    add_with_status(
        &conn,
        1,
        FIRST_SLOT,
        "2026-11-12T11:00",
        AppointmentStatus::Cancelled,
    );
    add_with_status(
        &conn,
        1,
        FIRST_SLOT,
        "2026-11-12T11:00",
        AppointmentStatus::NoShow,
    );

    assert!(
        find_overlaps(&conn, 1, FIRST_SLOT, "2026-11-12T11:00", None)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn scheduled_in_progress_and_completed_appointments_block_the_slot() {
    let conn = database();
    let scheduled = add(&conn, 1, FIRST_SLOT, "2026-11-12T11:00");
    let in_progress = add_with_status(
        &conn,
        2,
        FIRST_SLOT,
        "2026-11-12T11:00",
        AppointmentStatus::InProgress,
    );
    let completed = add_with_status(
        &conn,
        2,
        "2026-11-12T13:00",
        "2026-11-12T14:00",
        AppointmentStatus::Completed,
    );

    assert_eq!(
        find_overlaps(&conn, 1, FIRST_SLOT, "2026-11-12T11:00", None).unwrap(),
        vec![scheduled]
    );
    assert_eq!(
        find_overlaps(&conn, 2, FIRST_SLOT, "2026-11-12T14:00", None).unwrap(),
        vec![in_progress, completed]
    );
}

#[test]
fn another_resource_never_conflicts() {
    let conn = database();
    add(&conn, 1, FIRST_SLOT, "2026-11-12T11:00");

    assert!(
        find_overlaps(&conn, 2, FIRST_SLOT, "2026-11-12T11:00", None)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn the_excluded_appointment_never_conflicts_with_itself() {
    let conn = database();
    let own = add(&conn, 1, FIRST_SLOT, "2026-11-12T11:00");
    let other = add(&conn, 1, "2026-11-12T11:00", "2026-11-12T12:00");

    assert_eq!(
        find_overlaps(&conn, 1, FIRST_SLOT, "2026-11-12T12:00", Some(own)).unwrap(),
        vec![other]
    );
}

#[test]
fn overlap_ids_come_ordered_by_start_then_id() {
    let conn = database();
    let later = add(&conn, 1, "2026-11-12T11:00", "2026-11-12T12:00");
    let earlier = add(&conn, 1, FIRST_SLOT, "2026-11-12T11:00");

    assert_eq!(
        find_overlaps(&conn, 1, FIRST_SLOT, "2026-11-12T12:00", None).unwrap(),
        vec![earlier, later]
    );
}

#[test]
fn listing_a_day_keeps_only_that_days_starts() {
    let conn = database();
    let inside = add(&conn, 1, "2026-11-12T00:00", "2026-11-12T01:00");
    let late = add(&conn, 1, "2026-11-12T23:00", "2026-11-13T00:00");
    add(&conn, 1, "2026-11-13T00:00", "2026-11-13T01:00");
    add(&conn, 1, "2026-11-11T23:00", "2026-11-12T00:00");

    let rows = list_appointments(&conn, &day_range("2026-11-12", None)).unwrap();

    assert_eq!(ids_of(&rows), vec![inside, late]);
}

#[test]
fn listing_a_week_includes_both_edges() {
    let conn = database();
    let monday = add(&conn, 1, "2026-11-09T09:00", "2026-11-09T10:00");
    let sunday = add(&conn, 1, "2026-11-15T09:00", "2026-11-15T10:00");
    add(&conn, 1, "2026-11-08T09:00", "2026-11-08T10:00");
    add(&conn, 1, "2026-11-16T09:00", "2026-11-16T10:00");
    let range = AppointmentRange {
        from: "2026-11-09".to_string(),
        to: "2026-11-15".to_string(),
        resource_id: None,
    };

    let rows = list_appointments(&conn, &range).unwrap();

    assert_eq!(ids_of(&rows), vec![monday, sunday]);
}

#[test]
fn listing_can_be_narrowed_to_one_resource() {
    let conn = database();
    let first = add(&conn, 1, FIRST_SLOT, "2026-11-12T11:00");
    add(&conn, 2, FIRST_SLOT, "2026-11-12T11:00");

    let rows = list_appointments(&conn, &day_range("2026-11-12", Some(1))).unwrap();

    assert_eq!(ids_of(&rows), vec![first]);
}

#[test]
fn listing_includes_every_status_ordered_by_start_then_id() {
    let conn = database();
    let afternoon = add(&conn, 2, "2026-11-12T15:00", "2026-11-12T16:00");
    let first = add_with_status(
        &conn,
        1,
        FIRST_SLOT,
        "2026-11-12T11:00",
        AppointmentStatus::Cancelled,
    );
    let second = add(&conn, 2, FIRST_SLOT, "2026-11-12T11:00");

    let rows = list_appointments(&conn, &day_range("2026-11-12", None)).unwrap();

    assert_eq!(ids_of(&rows), vec![first, second, afternoon]);
}

#[test]
fn update_slot_changes_resource_and_times_and_stamps_the_actor() {
    let conn = database();
    let id = add(&conn, 1, FIRST_SLOT, "2026-11-12T11:00");

    update_slot(&conn, id, 2, "2026-11-13T15:00", "2026-11-13T16:00", 1).unwrap();
    let moved = find_appointment(&conn, id).unwrap().unwrap();

    assert_eq!(moved.resource_id, 2);
    assert_eq!(moved.starts_at, "2026-11-13T15:00");
    assert_eq!(moved.ends_at, "2026-11-13T16:00");
    assert_eq!(moved.status, AppointmentStatus::Scheduled);
}

#[test]
fn set_status_changes_only_the_status() {
    let conn = database();
    let id = add(&conn, 1, FIRST_SLOT, "2026-11-12T11:00");

    set_status(&conn, id, AppointmentStatus::NoShow, 1).unwrap();
    let after = find_appointment(&conn, id).unwrap().unwrap();

    assert_eq!(after.status, AppointmentStatus::NoShow);
    assert_eq!(after.starts_at, FIRST_SLOT);
    assert_eq!(after.resource_id, 1);
}

#[test]
fn future_scheduled_includes_an_unfinished_overdue_appointment() {
    let conn = database();
    let overdue_unclosed = add(&conn, 1, FIRST_SLOT, "2026-11-12T11:00");
    let ahead = add(&conn, 1, "2026-11-14T10:00", "2026-11-14T11:00");

    let rows = future_scheduled_of_resource(&conn, 1, "2026-11-12T10:30").unwrap();

    assert_eq!(ids_of(&rows), vec![overdue_unclosed, ahead]);
}

#[test]
fn future_scheduled_excludes_ended_appointments_and_the_exact_end_minute() {
    let conn = database();
    add(&conn, 1, FIRST_SLOT, "2026-11-12T11:00");

    assert!(future_scheduled_of_resource(&conn, 1, "2026-11-12T11:00")
        .unwrap()
        .is_empty());
    assert!(future_scheduled_of_resource(&conn, 1, NOON)
        .unwrap()
        .is_empty());
    assert_eq!(
        future_scheduled_of_resource(&conn, 1, "2026-11-12T10:59")
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn future_scheduled_ignores_other_statuses_and_other_resources() {
    let conn = database();
    for status in [
        AppointmentStatus::InProgress,
        AppointmentStatus::Completed,
        AppointmentStatus::Cancelled,
        AppointmentStatus::NoShow,
    ] {
        add_with_status(&conn, 1, "2026-11-20T10:00", "2026-11-20T11:00", status);
    }
    add(&conn, 2, "2026-11-20T10:00", "2026-11-20T11:00");

    assert!(future_scheduled_of_resource(&conn, 1, NOON)
        .unwrap()
        .is_empty());
}

#[test]
fn future_scheduled_orders_by_start_then_id() {
    let conn = database();
    let later = add(&conn, 1, "2026-11-15T10:00", "2026-11-15T11:00");
    let sooner = add(&conn, 1, "2026-11-14T10:00", "2026-11-14T11:00");

    let rows = future_scheduled_of_resource(&conn, 1, NOON).unwrap();

    assert_eq!(ids_of(&rows), vec![sooner, later]);
}

#[test]
fn the_local_minute_clock_returns_a_valid_minute() {
    let conn = database();

    let now = local_minute_now(&conn).unwrap();

    assert_eq!(now.len(), 16);
    assert!(crate::features::appointments::rules::is_local_minute(&now));
}

#[test]
fn the_range_filter_does_not_wrap_the_start_column_in_a_function() {
    assert!(!list_in_range_sql().contains("substr(starts_at"));
}

#[test]
fn the_range_listing_is_planned_with_an_appointments_index() {
    let conn = database();
    let mut statement = conn
        .prepare(&format!("EXPLAIN QUERY PLAN {}", list_in_range_sql()))
        .unwrap();
    let details: Vec<String> = statement
        .query_map(rusqlite::params!["2026-11-12", "2026-11-12", 1], |row| {
            row.get(3)
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();

    assert!(
        details
            .iter()
            .any(|detail| detail.contains("USING INDEX appointments_")),
        "{details:?}"
    );
}

#[test]
fn the_last_minute_of_the_final_day_is_included_and_midnight_after_it_is_not() {
    let conn = database();
    let last_minute = add(&conn, 1, "2026-11-12T23:00", "2026-11-13T00:00");
    add(&conn, 1, "2026-11-13T00:00", "2026-11-13T01:00");

    let rows = list_appointments(&conn, &day_range("2026-11-12", None)).unwrap();

    assert_eq!(ids_of(&rows), vec![last_minute]);
}
