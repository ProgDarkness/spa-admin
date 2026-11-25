use rusqlite::Connection;

use super::tests::{
    count, is_constraint_violation, is_minute_precision_local_timestamp, migrated, table_exists,
};

const VALID_SERVICE: &str = "INSERT INTO services (name, name_key, price_cents, duration_min) \
     VALUES ('Masaje', 'masaje', 3500, 60)";

fn insert_service(
    conn: &Connection,
    name: &str,
    price_cents: i64,
    duration_min: i64,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO services (name, name_key, price_cents, duration_min) \
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![name, name.to_lowercase(), price_cents, duration_min],
    )
}

fn insert_service_with_key(
    conn: &Connection,
    name: &str,
    name_key: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO services (name, name_key, price_cents, duration_min) \
         VALUES (?1, ?2, 100, 30)",
        rusqlite::params![name, name_key],
    )
}

#[test]
fn services_table_exists_after_migrating() {
    assert!(table_exists(&migrated(), "services"));
}

#[test]
fn migrations_seed_no_services() {
    assert_eq!(count(&migrated(), "services"), 0);
}

#[test]
fn services_defaults_are_active_usd_with_minute_precision_timestamps() {
    let conn = migrated();
    conn.execute(VALID_SERVICE, []).unwrap();

    let (active, currency, created, updated): (i64, String, String, String) = conn
        .query_row(
            "SELECT active, currency, created_at, updated_at FROM services",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();

    assert_eq!((active, currency.as_str()), (1, "USD"));
    assert!(is_minute_precision_local_timestamp(&created), "{created}");
    assert!(is_minute_precision_local_timestamp(&updated), "{updated}");
}

#[test]
fn services_reject_non_positive_prices() {
    let conn = migrated();

    assert!(is_constraint_violation(insert_service(&conn, "A", 0, 30)));
    assert!(is_constraint_violation(insert_service(&conn, "B", -1, 30)));
    assert!(insert_service(&conn, "C", 1, 30).is_ok());
}

#[test]
fn services_reject_invalid_durations() {
    let conn = migrated();

    for (index, minutes) in [0, -5, 7, 1445, 1500].into_iter().enumerate() {
        let name = format!("S{index}");
        assert!(
            is_constraint_violation(insert_service(&conn, &name, 100, minutes)),
            "{minutes}"
        );
    }
    assert!(insert_service(&conn, "min", 100, 5).is_ok());
    assert!(insert_service(&conn, "max", 100, 1440).is_ok());
}

#[test]
fn services_reject_non_usd_currency_and_invalid_active_flag() {
    let conn = migrated();

    let other_currency = conn.execute(
        "INSERT INTO services (name, name_key, price_cents, currency, duration_min) \
         VALUES ('X', 'x', 100, 'VES', 30)",
        [],
    );
    let bad_flag = conn.execute(
        "INSERT INTO services (name, name_key, price_cents, duration_min, active) \
         VALUES ('Y', 'y', 100, 30, 2)",
        [],
    );

    assert!(is_constraint_violation(other_currency));
    assert!(is_constraint_violation(bad_flag));
}

#[test]
fn service_name_keys_are_unique() {
    let conn = migrated();
    insert_service_with_key(&conn, "Masaje", "masaje").unwrap();

    let same_key_other_name = insert_service_with_key(&conn, "MASAJE", "masaje");
    let other_key = insert_service_with_key(&conn, "Facial", "facial");

    assert!(is_constraint_violation(same_key_other_name));
    assert!(other_key.is_ok());
}

#[test]
fn service_name_key_is_required() {
    let conn = migrated();

    let missing = conn.execute(
        "INSERT INTO services (name, price_cents, duration_min) VALUES ('Masaje', 100, 30)",
        [],
    );

    assert!(is_constraint_violation(missing));
}

#[test]
fn services_price_is_bounded_between_one_cent_and_the_maximum() {
    let conn = migrated();

    for (index, price) in [0_i64, -1, 100_000_000_001, i64::MAX]
        .into_iter()
        .enumerate()
    {
        let name = format!("S{index}");
        assert!(
            is_constraint_violation(insert_service(&conn, &name, price, 30)),
            "{price}"
        );
    }
    assert!(insert_service(&conn, "min", 1, 30).is_ok());
    assert!(insert_service(&conn, "max", 100_000_000_000, 30).is_ok());
}

#[test]
fn services_keep_the_foreign_keys_to_users() {
    let conn = migrated();

    let orphan = conn.execute(
        "INSERT INTO services (name, name_key, price_cents, duration_min, created_by) \
         VALUES ('Z', 'z', 100, 30, 999)",
        [],
    );

    assert!(is_constraint_violation(orphan));
}
