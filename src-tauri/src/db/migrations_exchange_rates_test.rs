use rusqlite::Connection;

use super::tests::{
    is_constraint_violation, is_minute_precision_local_timestamp, migrated, table_exists,
};

const MAX_RATE_E4: i64 = 100_000_000_000;

fn insert_rate(conn: &Connection, date: &str, rate: i64) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO exchange_rates (date, rate_bs_per_usd_e4) VALUES (?1, ?2)",
        rusqlite::params![date, rate],
    )
}

#[test]
fn exchange_rates_table_exists_after_migrating_and_starts_empty() {
    let conn = migrated();

    assert!(table_exists(&conn, "exchange_rates"));
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM exchange_rates", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows, 0);
}

#[test]
fn exchange_rates_defaults_have_minute_precision_timestamps() {
    let conn = migrated();
    insert_rate(&conn, "2026-11-12", 365_000).unwrap();

    let (created, updated): (String, String) = conn
        .query_row(
            "SELECT created_at, updated_at FROM exchange_rates",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert!(is_minute_precision_local_timestamp(&created), "{created}");
    assert!(is_minute_precision_local_timestamp(&updated), "{updated}");
}

#[test]
fn exchange_rate_dates_are_unique() {
    let conn = migrated();
    insert_rate(&conn, "2026-11-12", 365_000).unwrap();

    let same_date = insert_rate(&conn, "2026-11-12", 366_000);
    let other_date = insert_rate(&conn, "2026-11-13", 366_000);

    assert!(is_constraint_violation(same_date));
    assert!(other_date.is_ok());
}

#[test]
fn exchange_rate_dates_must_have_the_iso_format() {
    let conn = migrated();

    for bad in [
        "12-11-2026",
        "2026/11/12",
        "2026-1-12",
        "2026-11-1",
        "2026-11-12T10:00",
        "2026-11-123",
        "26-11-12",
        "abcd-ef-gh",
        "2026-11-1a",
        "",
        " 2026-11-12",
    ] {
        assert!(
            is_constraint_violation(insert_rate(&conn, bad, 365_000)),
            "{bad:?}"
        );
    }
    assert!(insert_rate(&conn, "2026-11-12", 365_000).is_ok());
}

#[test]
fn exchange_rate_dates_must_be_real_calendar_dates_within_the_supported_years() {
    let conn = migrated();

    for bad in [
        "2026-02-30",
        "2026-99-99",
        "2026-04-31",
        "2023-02-29",
        "0001-01-01",
        "1999-12-31",
        "2100-01-01",
        "9999-12-31",
    ] {
        assert!(
            is_constraint_violation(insert_rate(&conn, bad, 365_000)),
            "{bad:?}"
        );
    }
    for good in ["2024-02-29", "2000-01-01", "2099-12-31"] {
        assert!(insert_rate(&conn, good, 365_000).is_ok(), "{good:?}");
    }
}

#[test]
fn exchange_rate_date_is_required() {
    let conn = migrated();

    let without_date = conn.execute(
        "INSERT INTO exchange_rates (rate_bs_per_usd_e4) VALUES (365000)",
        [],
    );

    assert!(is_constraint_violation(without_date));
}

#[test]
fn exchange_rate_values_must_be_between_one_and_the_maximum() {
    let conn = migrated();

    for (index, rate) in [0, -1, i64::MIN, MAX_RATE_E4 + 1, i64::MAX]
        .into_iter()
        .enumerate()
    {
        let date = format!("2026-01-{:02}", index + 1);
        assert!(
            is_constraint_violation(insert_rate(&conn, &date, rate)),
            "{rate}"
        );
    }
    assert!(insert_rate(&conn, "2026-02-01", 1).is_ok());
    assert!(insert_rate(&conn, "2026-02-02", MAX_RATE_E4).is_ok());
}

#[test]
fn exchange_rate_value_is_required() {
    let conn = migrated();

    let without_rate = conn.execute(
        "INSERT INTO exchange_rates (date) VALUES ('2026-11-12')",
        [],
    );

    assert!(is_constraint_violation(without_rate));
}

#[test]
fn exchange_rates_keep_the_foreign_keys_to_users() {
    let conn = migrated();

    let orphan_creator = conn.execute(
        "INSERT INTO exchange_rates (date, rate_bs_per_usd_e4, created_by) \
         VALUES ('2026-11-12', 365000, 999)",
        [],
    );
    let orphan_updater = conn.execute(
        "INSERT INTO exchange_rates (date, rate_bs_per_usd_e4, updated_by) \
         VALUES ('2026-11-13', 365000, 999)",
        [],
    );

    assert!(is_constraint_violation(orphan_creator));
    assert!(is_constraint_violation(orphan_updater));
}

#[test]
fn exchange_rate_ids_are_never_reused_after_the_highest_row_is_removed() {
    let conn = migrated();
    insert_rate(&conn, "2026-11-12", 365_000).unwrap();
    let first = conn.last_insert_rowid();
    conn.execute("DELETE FROM exchange_rates WHERE id = ?1", [first])
        .unwrap();

    insert_rate(&conn, "2026-11-13", 365_000).unwrap();

    assert!(conn.last_insert_rowid() > first);
}
