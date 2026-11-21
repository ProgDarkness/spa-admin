use rusqlite::Connection;

use super::*;
use crate::db::migrate;
use crate::features::users::repository::{insert_user, NewUserRow};

const OWNER_ROLE: i64 = 1;

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn actor(conn: &Connection, username: &str) -> i64 {
    let row = NewUserRow {
        username: username.to_string(),
        password_hash: "hash-opaco".to_string(),
        role_id: OWNER_ROLE,
    };
    insert_user(conn, &row, None).unwrap()
}

fn rate(date: &str, value: i64) -> ExchangeRate {
    ExchangeRate {
        date: date.to_string(),
        rate_bs_per_usd_e4: value,
    }
}

fn stamp(conn: &Connection, id: i64) -> (Option<i64>, Option<i64>) {
    conn.query_row(
        "SELECT created_by, updated_by FROM exchange_rates WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap()
}

#[test]
fn there_are_no_rates_after_migrating() {
    assert!(list_rates(&migrated()).unwrap().is_empty());
}

#[test]
fn insert_rate_stores_the_rate_stamped_with_the_actor() {
    let conn = migrated();
    let actor_id = actor(&conn, "duena");

    let id = insert_rate(&conn, &rate("2026-11-12", 365_000), actor_id).unwrap();
    let stored = find_rate(&conn, "2026-11-12").unwrap().unwrap();

    assert_eq!(stored.id, id);
    assert_eq!(stored.rate, rate("2026-11-12", 365_000));
    assert_eq!(stamp(&conn, id), (Some(actor_id), Some(actor_id)));
}

#[test]
fn find_rate_returns_none_for_a_date_without_rate() {
    let conn = migrated();
    insert_rate(&conn, &rate("2026-11-12", 365_000), actor(&conn, "duena")).unwrap();

    assert_eq!(find_rate(&conn, "2026-11-13").unwrap(), None);
}

#[test]
fn find_rate_matches_the_exact_date_only() {
    let conn = migrated();
    let actor_id = actor(&conn, "duena");
    insert_rate(&conn, &rate("2026-11-12", 365_000), actor_id).unwrap();
    insert_rate(&conn, &rate("2026-11-13", 370_000), actor_id).unwrap();

    let found = find_rate(&conn, "2026-11-13").unwrap().unwrap();

    assert_eq!(found.rate, rate("2026-11-13", 370_000));
}

#[test]
fn list_rates_orders_by_date_descending_whatever_the_insertion_order() {
    let conn = migrated();
    let actor_id = actor(&conn, "duena");
    for date in ["2026-11-12", "2027-01-01", "2026-02-28", "2026-11-13"] {
        insert_rate(&conn, &rate(date, 365_000), actor_id).unwrap();
    }

    let dates: Vec<String> = list_rates(&conn)
        .unwrap()
        .into_iter()
        .map(|listed| listed.date)
        .collect();

    assert_eq!(
        dates,
        ["2027-01-01", "2026-11-13", "2026-11-12", "2026-02-28"]
    );
}

#[test]
fn list_rates_exposes_only_date_and_value() {
    let conn = migrated();
    insert_rate(&conn, &rate("2026-11-12", 365_000), actor(&conn, "duena")).unwrap();

    assert_eq!(
        list_rates(&conn).unwrap(),
        vec![rate("2026-11-12", 365_000)]
    );
}

#[test]
fn insert_rate_rejects_a_duplicated_date() {
    let conn = migrated();
    let actor_id = actor(&conn, "duena");
    insert_rate(&conn, &rate("2026-11-12", 365_000), actor_id).unwrap();

    let duplicate = insert_rate(&conn, &rate("2026-11-12", 366_000), actor_id);

    assert!(duplicate.is_err());
    assert_eq!(list_rates(&conn).unwrap().len(), 1);
}

#[test]
fn apply_rate_value_changes_the_value_and_the_updater_but_not_the_creator() {
    let conn = migrated();
    let creator = actor(&conn, "duena");
    let editor = actor(&conn, "gestora");
    let id = insert_rate(&conn, &rate("2026-11-12", 365_000), creator).unwrap();

    apply_rate_value(&conn, id, 370_000, editor).unwrap();

    let stored = find_rate(&conn, "2026-11-12").unwrap().unwrap();
    assert_eq!(stored.rate.rate_bs_per_usd_e4, 370_000);
    assert_eq!(stamp(&conn, id), (Some(creator), Some(editor)));
}

#[test]
fn apply_rate_value_touches_only_the_targeted_row() {
    let conn = migrated();
    let actor_id = actor(&conn, "duena");
    let first = insert_rate(&conn, &rate("2026-11-12", 365_000), actor_id).unwrap();
    insert_rate(&conn, &rate("2026-11-13", 366_000), actor_id).unwrap();

    apply_rate_value(&conn, first, 370_000, actor_id).unwrap();

    let other = find_rate(&conn, "2026-11-13").unwrap().unwrap();
    assert_eq!(other.rate.rate_bs_per_usd_e4, 366_000);
}

#[test]
fn apply_rate_value_refreshes_updated_at_with_minute_precision() {
    let conn = migrated();
    let actor_id = actor(&conn, "duena");
    let id = insert_rate(&conn, &rate("2026-11-12", 365_000), actor_id).unwrap();
    conn.execute(
        "UPDATE exchange_rates SET updated_at = '2000-01-01T00:00'",
        [],
    )
    .unwrap();

    apply_rate_value(&conn, id, 370_000, actor_id).unwrap();

    let updated: String = conn
        .query_row(
            "SELECT updated_at FROM exchange_rates WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .unwrap();
    assert_ne!(updated, "2000-01-01T00:00");
    assert_eq!(updated.len(), 16);
}

#[test]
fn apply_rate_value_fails_when_no_row_was_affected() {
    let conn = migrated();
    let actor_id = actor(&conn, "duena");

    let outcome = apply_rate_value(&conn, 999, 370_000, actor_id);

    assert!(matches!(
        outcome,
        Err(DbError::Sqlite(rusqlite::Error::StatementChangedRows(0)))
    ));
}

#[test]
fn apply_rate_value_updates_exactly_the_requested_row() {
    let conn = migrated();
    let actor_id = actor(&conn, "duena");
    let id = insert_rate(&conn, &rate("2026-11-12", 365_000), actor_id).unwrap();
    insert_rate(&conn, &rate("2026-11-13", 366_000), actor_id).unwrap();

    apply_rate_value(&conn, id, 370_000, actor_id).unwrap();

    assert_eq!(
        find_rate(&conn, "2026-11-12").unwrap().unwrap().rate,
        rate("2026-11-12", 370_000)
    );
    assert_eq!(
        find_rate(&conn, "2026-11-13").unwrap().unwrap().rate,
        rate("2026-11-13", 366_000)
    );
}
