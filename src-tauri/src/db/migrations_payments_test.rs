use rusqlite::{params, Connection};

use super::tests::{
    count, is_constraint_violation, is_minute_precision_local_timestamp, migrated, table_exists,
};
use super::*;

const LAST_PRE_PAYMENTS_VERSION: usize = 11;
const MAX_AMOUNT: i64 = 100_000_000_000;
const MAX_RATE: i64 = 100_000_000_000;
const ADD_VOIDER: &str =
    "INSERT INTO users (id, username, password_hash, role_id) VALUES (50, 'u', 'h', 1)";

#[derive(Clone, Copy)]
struct Row<'a> {
    appointment_id: i64,
    method_id: i64,
    currency: &'a str,
    amount: i64,
    rate: Option<i64>,
    usd_equivalent: i64,
    paid_at: &'a str,
}

const USD: Row<'static> = Row {
    appointment_id: 1,
    method_id: 1,
    currency: "USD",
    amount: 3500,
    rate: None,
    usd_equivalent: 3500,
    paid_at: "2026-11-12T11:00",
};

const VES: Row<'static> = Row {
    currency: "VES",
    amount: 182_500,
    rate: Some(365_000),
    usd_equivalent: 5000,
    ..USD
};

fn seed_references(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO clients (first_name, last_name, national_id, phone, search_key) \
            VALUES ('Ana', 'Perez', 'V-12345678', '0414', 'k');
         INSERT INTO services (name, name_key, price_cents, duration_min) \
            VALUES ('Facial', 'facial', 3500, 60);
         INSERT INTO appointments (client_id, service_id, resource_id, starts_at, ends_at, \
            status, price_cents_snapshot, duration_min_snapshot) \
            VALUES (1, 1, 1, '2026-11-12T10:00', '2026-11-12T11:00', 'completed', 3500, 60);",
    )
    .unwrap();
}

fn insert(conn: &Connection, row: &Row<'_>) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO appointment_payments (appointment_id, method_id, currency, amount_cents, \
         rate_bs_per_usd_e4, usd_equivalent_cents, paid_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            row.appointment_id,
            row.method_id,
            row.currency,
            row.amount,
            row.rate,
            row.usd_equivalent,
            row.paid_at
        ],
    )
}

fn prepared() -> Connection {
    let conn = migrated();
    seed_references(&conn);
    conn
}

fn rejected(row: Row<'_>) -> bool {
    is_constraint_violation(insert(&prepared(), &row))
}

fn with_one_payment(row: &Row<'_>) -> Connection {
    let conn = prepared();
    insert(&conn, row).unwrap();
    conn.execute_batch(ADD_VOIDER).unwrap();
    conn
}

fn void_with(conn: &Connection, id: i64, reason: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE appointment_payments SET voided_at = '2026-11-12T12:00', voided_by = 50, \
         void_reason = ?2 WHERE id = ?1",
        params![id, reason],
    )
}

fn indexed_columns(conn: &Connection) -> Vec<Vec<String>> {
    let mut statement = conn
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' \
             AND tbl_name = 'appointment_payments' AND name NOT LIKE 'sqlite_%'",
        )
        .unwrap();
    let names: Vec<String> = statement
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let mut column_sets: Vec<Vec<String>> = names
        .iter()
        .map(|name| {
            let mut info = conn
                .prepare(&format!(
                    "SELECT name FROM pragma_index_info('{name}') ORDER BY seqno"
                ))
                .unwrap();
            info.query_map([], |row| row.get(0))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        })
        .collect();
    column_sets.sort();
    column_sets
}

#[test]
fn payments_table_exists_and_starts_empty() {
    let conn = migrated();
    assert!(table_exists(&conn, "appointment_payments"));
    assert_eq!(count(&conn, "appointment_payments"), 0);
}

#[test]
fn valid_usd_and_ves_rows_are_accepted_with_minute_precision_timestamps() {
    let conn = prepared();
    insert(&conn, &USD).unwrap();
    insert(&conn, &VES).unwrap();

    let (created, updated): (String, String) = conn
        .query_row(
            "SELECT created_at, updated_at FROM appointment_payments WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert!(is_minute_precision_local_timestamp(&created), "{created}");
    assert!(is_minute_precision_local_timestamp(&updated), "{updated}");
}

#[test]
fn a_usd_payment_with_a_rate_is_rejected() {
    assert!(rejected(Row {
        rate: Some(365_000),
        ..USD
    }));
}

#[test]
fn a_usd_payment_must_equal_its_own_amount() {
    assert!(rejected(Row {
        usd_equivalent: 3499,
        ..USD
    }));
}

#[test]
fn a_ves_payment_without_a_rate_is_rejected() {
    assert!(rejected(Row { rate: None, ..VES }));
}

#[test]
fn a_ves_rate_must_be_between_one_and_the_maximum() {
    for bad in [0, -1, MAX_RATE + 1] {
        assert!(
            rejected(Row {
                rate: Some(bad),
                ..VES
            }),
            "{bad}"
        );
    }
    let at_limit = Row {
        amount: MAX_AMOUNT,
        rate: Some(MAX_RATE),
        usd_equivalent: (MAX_AMOUNT * 20_000 + MAX_RATE) / (2 * MAX_RATE),
        ..VES
    };
    assert!(insert(&prepared(), &at_limit).is_ok());
}

#[test]
fn the_usd_equivalent_of_a_ves_payment_must_be_the_half_up_rounding() {
    let ves = |amount, rate, usd_equivalent| Row {
        amount,
        rate: Some(rate),
        usd_equivalent,
        ..VES
    };
    for (amount, rate, equivalent) in [(1, 20_000, 1), (3, 20_000, 2), (19, 365_000, 1)] {
        assert!(
            insert(&prepared(), &ves(amount, rate, equivalent)).is_ok(),
            "{amount}@{rate}"
        );
    }
    for (amount, rate, equivalent) in [
        (1, 20_000, 0),
        (1, 20_001, 1),
        (1, 20_001, 0),
        (18, 365_000, 0),
        (182_500, 365_000, 5001),
    ] {
        assert!(rejected(ves(amount, rate, equivalent)), "{amount}@{rate}");
    }
}

#[test]
fn amount_must_be_positive_and_within_the_maximum() {
    for bad in [0, -1, MAX_AMOUNT + 1] {
        assert!(
            rejected(Row {
                amount: bad,
                usd_equivalent: bad,
                ..USD
            }),
            "{bad}"
        );
    }
    let at_limit = Row {
        amount: MAX_AMOUNT,
        usd_equivalent: MAX_AMOUNT,
        ..USD
    };
    assert!(insert(&prepared(), &at_limit).is_ok());
}

#[test]
fn the_maximum_ves_amount_with_the_maximum_rate_keeps_an_exact_equivalent() {
    let row = Row {
        amount: MAX_AMOUNT,
        rate: Some(MAX_RATE),
        usd_equivalent: (MAX_AMOUNT * 20_000 + MAX_RATE) / (2 * MAX_RATE),
        ..VES
    };

    assert!(insert(&prepared(), &row).is_ok());
}

#[test]
fn only_usd_and_ves_are_valid_currencies() {
    for bad in ["EUR", "usd", "", "VEF"] {
        assert!(
            rejected(Row {
                currency: bad,
                ..USD
            }),
            "{bad:?}"
        );
    }
}

#[test]
fn paid_at_must_be_an_existing_local_minute() {
    for bad in [
        "2026-11-12 11:00",
        "2026-11-12T25:00",
        "2026-02-30T10:00",
        "2026-11-12T11:00:30",
        "2026-11-12",
        "",
        "2026-11-12T11:00Z",
    ] {
        assert!(
            rejected(Row {
                paid_at: bad,
                ..USD
            }),
            "{bad:?}"
        );
    }
}

#[test]
fn foreign_keys_to_appointments_methods_and_users_are_enforced() {
    for row in [
        Row {
            appointment_id: 999,
            ..USD
        },
        Row {
            method_id: 999,
            ..USD
        },
    ] {
        assert!(rejected(row));
    }
    let conn = with_one_payment(&USD);
    assert!(is_constraint_violation(conn.execute(
        "UPDATE appointment_payments SET voided_at = '2026-11-12T12:00', voided_by = 999, \
         void_reason = 'error' WHERE id = 1",
        [],
    )));
}

#[test]
fn a_complete_void_is_accepted_and_a_partial_one_is_rejected() {
    assert!(void_with(&with_one_payment(&USD), 1, "error de digitacion").is_ok());

    for partial in [
        "voided_at = '2026-11-12T12:00'",
        "voided_at = '2026-11-12T12:00', void_reason = 'x'",
        "void_reason = 'x'",
        "voided_by = 50",
    ] {
        let conn = with_one_payment(&USD);
        let sql = format!("UPDATE appointment_payments SET {partial} WHERE id = 1");
        assert!(is_constraint_violation(conn.execute(&sql, [])), "{partial}");
    }
}

#[test]
fn void_reason_must_have_between_one_and_two_hundred_characters() {
    let conn = with_one_payment(&USD);
    insert(&conn, &USD).unwrap();
    insert(&conn, &USD).unwrap();

    assert!(is_constraint_violation(void_with(&conn, 1, "")));
    assert!(is_constraint_violation(void_with(
        &conn,
        2,
        &"a".repeat(201)
    )));
    assert!(void_with(&conn, 3, &"a".repeat(200)).is_ok());
}

#[test]
fn a_payment_can_never_be_deleted() {
    let conn = with_one_payment(&USD);

    assert!(is_constraint_violation(
        conn.execute("DELETE FROM appointment_payments WHERE id = 1", [])
    ));
    assert_eq!(count(&conn, "appointment_payments"), 1);
}

#[test]
fn economic_columns_are_immutable() {
    for assignment in [
        "amount_cents = 3600, usd_equivalent_cents = 3600",
        "method_id = 2",
        "paid_at = '2026-11-13T11:00'",
        "currency = 'VES', rate_bs_per_usd_e4 = 20000, usd_equivalent_cents = 1750",
    ] {
        let conn = with_one_payment(&USD);
        let sql = format!("UPDATE appointment_payments SET {assignment} WHERE id = 1");
        assert!(
            is_constraint_violation(conn.execute(&sql, [])),
            "{assignment}"
        );
    }
}

#[test]
fn the_appointment_of_a_payment_cannot_be_reassigned() {
    let conn = with_one_payment(&USD);
    conn.execute_batch(
        "INSERT INTO appointments (client_id, service_id, resource_id, starts_at, ends_at, \
            status, price_cents_snapshot, duration_min_snapshot) \
            VALUES (1, 1, 1, '2026-11-13T10:00', '2026-11-13T11:00', 'completed', 3500, 60)",
    )
    .unwrap();

    assert!(is_constraint_violation(conn.execute(
        "UPDATE appointment_payments SET appointment_id = 2 WHERE id = 1",
        []
    )));
}

#[test]
fn a_voided_payment_cannot_be_voided_again_or_changed() {
    let conn = with_one_payment(&USD);
    void_with(&conn, 1, "primera").unwrap();

    assert!(is_constraint_violation(void_with(&conn, 1, "segunda")));
    for assignment in ["void_reason = 'otra'", "updated_by = 50"] {
        let sql = format!("UPDATE appointment_payments SET {assignment} WHERE id = 1");
        assert!(
            is_constraint_violation(conn.execute(&sql, [])),
            "{assignment}"
        );
    }
}

#[test]
fn the_maximum_amount_with_the_minimum_rate_keeps_the_equivalent_exact() {
    let row = Row {
        amount: MAX_AMOUNT,
        rate: Some(1),
        usd_equivalent: MAX_AMOUNT * 10_000,
        ..VES
    };

    assert!(insert(&prepared(), &row).is_ok());
}

#[test]
fn an_amount_above_the_maximum_is_rejected_in_both_currencies() {
    assert!(rejected(Row {
        amount: MAX_AMOUNT + 1,
        usd_equivalent: MAX_AMOUNT + 1,
        ..USD
    }));
    assert!(rejected(Row {
        amount: MAX_AMOUNT + 1,
        rate: Some(1),
        usd_equivalent: (MAX_AMOUNT + 1) * 10_000,
        ..VES
    }));
}

#[test]
fn an_equivalent_of_zero_cents_is_rejected() {
    assert!(rejected(Row {
        amount: 1,
        rate: Some(365_000),
        usd_equivalent: 0,
        ..VES
    }));
}

#[test]
fn id_creation_stamp_and_creator_are_immutable_on_active_payments() {
    for assignment in [
        "id = 99",
        "created_at = '2020-01-01T00:00'",
        "created_by = 50",
    ] {
        let conn = with_one_payment(&USD);
        let sql = format!("UPDATE appointment_payments SET {assignment} WHERE id = 1");
        assert!(
            is_constraint_violation(conn.execute(&sql, [])),
            "{assignment}"
        );
    }
}

#[test]
fn a_void_cannot_be_stamped_before_the_payment_but_the_same_minute_is_allowed() {
    let before = with_one_payment(&USD);
    let same_minute = with_one_payment(&USD);
    let void_at = |conn: &Connection, moment: &str| {
        conn.execute(
            "UPDATE appointment_payments SET voided_at = ?1, voided_by = 50, void_reason = 'x' \
             WHERE id = 1",
            [moment],
        )
    };

    assert!(is_constraint_violation(void_at(
        &before,
        "2026-11-12T10:59"
    )));
    assert!(void_at(&same_minute, "2026-11-12T11:00").is_ok());
}

#[test]
fn indexes_cover_the_appointment_and_the_payment_date() {
    let expected: Vec<Vec<String>> = vec![
        vec!["appointment_id".to_string()],
        vec!["paid_at".to_string()],
    ];

    assert_eq!(indexed_columns(&migrated()), expected);
}

#[test]
fn payment_ids_are_never_reused() {
    let conn = prepared();
    insert(&conn, &USD).unwrap();
    let first = conn.last_insert_rowid();
    conn.execute_batch("DROP TRIGGER appointment_payments_no_delete")
        .unwrap();
    conn.execute("DELETE FROM appointment_payments WHERE id = ?1", [first])
        .unwrap();

    insert(&conn, &USD).unwrap();

    assert!(conn.last_insert_rowid() > first);
}

#[test]
fn migrating_from_version_eleven_keeps_every_existing_row() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    apply(&mut conn, &MIGRATIONS[..LAST_PRE_PAYMENTS_VERSION]).unwrap();
    seed_references(&conn);
    let tables = ["users", "clients", "services", "appointments", "audit_log"];
    let before = tables.map(|table| count(&conn, table));

    migrate(&mut conn).unwrap();

    assert_eq!(tables.map(|table| count(&conn, table)), before);
    assert_eq!(count(&conn, "appointment_payments"), 0);
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, i64::from(supported_version()));
    assert!(insert(&conn, &USD).is_ok());
}
