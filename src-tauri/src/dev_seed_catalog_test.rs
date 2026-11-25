use super::*;
use crate::db::{migrate, DbError};
use crate::dev_seed::{seed_if_empty, SEED_PASSWORD_VAR};
use crate::features::audit::{AuditAction, AuditEntity};
use crate::features::auth::password::PasswordPolicy;
use crate::features::auth::service::AuthError;
use crate::features::catalog::model::CatalogError;
use crate::features::named_records::name_key;
use crate::features::rates::model::{is_calendar_date, RatesError};
use rusqlite::Connection;

const TODAY: &str = "2026-03-15";

type StoredService = (i64, String, i64, i64, bool);

const EXPECTED_SERVICES: [(i64, &str, i64, i64, bool); 8] = [
    (1, "Limpieza facial (ejemplo)", 3_500, 60, true),
    (2, "Masaje relajante (ejemplo)", 4_000, 60, true),
    (3, "Diseño de cejas (ejemplo)", 1_000, 30, true),
    (4, "Manicure clásico (ejemplo)", 1_500, 45, true),
    (5, "Pedicure spa (ejemplo)", 2_000, 60, true),
    (6, "Tratamiento corporal (ejemplo)", 6_000, 90, true),
    (
        7,
        "Paquete 4 limpiezas faciales (ejemplo)",
        12_000,
        60,
        true,
    ),
    (8, "Peeling químico (ejemplo)", 5_000, 45, false),
];

const EXPECTED_RATES: [(&str, i64); 7] = [
    ("2026-03-15", 365_000),
    ("2026-03-14", 364_500),
    ("2026-03-13", 364_000),
    ("2026-03-12", 363_500),
    ("2026-03-11", 363_000),
    ("2026-03-10", 362_500),
    ("2026-03-09", 362_000),
];

fn env_with_password(name: &str) -> Option<String> {
    (name == SEED_PASSWORD_VAR).then(|| "clave-de-desarrollo-1".to_string())
}

fn env_empty_password(name: &str) -> Option<String> {
    (name == SEED_PASSWORD_VAR).then(String::new)
}

fn env_without_variables(_: &str) -> Option<String> {
    None
}

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn with_users() -> Connection {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    seed_if_empty(&conn, &policy, &env_with_password).unwrap();
    conn
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap()
}

fn stored_services(conn: &Connection) -> Vec<StoredService> {
    let mut statement = conn
        .prepare("SELECT id, name, price_cents, duration_min, active FROM services ORDER BY id")
        .unwrap();
    statement
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn owner_id(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT id FROM users WHERE username = 'propietaria'",
        [],
        |row| row.get(0),
    )
    .unwrap()
}

fn ids_of(conn: &Connection, table: &str) -> Vec<i64> {
    let mut statement = conn
        .prepare(&format!("SELECT id FROM {table} ORDER BY id"))
        .unwrap();
    statement
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn audited(conn: &Connection, action: AuditAction, entity: AuditEntity, actor: i64) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM audit_log WHERE action = ?1 AND entity = ?2 AND actor_user_id = ?3",
        rusqlite::params![action.as_str(), entity.as_str(), actor],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn seeds_the_eight_example_services_with_the_mock_values() {
    let conn = with_users();

    seed_catalog_dated(&conn, TODAY).unwrap();

    let expected: Vec<StoredService> = EXPECTED_SERVICES
        .iter()
        .map(|(id, name, price, minutes, active)| {
            (*id, name.to_string(), *price, *minutes, *active)
        })
        .collect();
    assert_eq!(stored_services(&conn), expected);
}

#[test]
fn seeds_the_seven_example_rates_ending_today() {
    let conn = with_users();

    seed_catalog_dated(&conn, TODAY).unwrap();

    let mut statement = conn
        .prepare("SELECT date, rate_bs_per_usd_e4 FROM exchange_rates ORDER BY date DESC")
        .unwrap();
    let stored: Vec<(String, i64)> = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    let expected: Vec<(String, i64)> = EXPECTED_RATES
        .iter()
        .map(|(date, rate)| (date.to_string(), *rate))
        .collect();
    assert_eq!(stored, expected);
}

#[test]
fn seeded_rate_dates_are_valid_calendar_dates() {
    let conn = with_users();
    seed_catalog_dated(&conn, TODAY).unwrap();

    let mut statement = conn.prepare("SELECT date FROM exchange_rates").unwrap();
    let dates: Vec<String> = statement
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();

    assert_eq!(dates.len(), 7);
    assert!(dates.iter().all(|date| is_calendar_date(date)));
}

#[test]
fn rate_dates_cross_month_and_year_boundaries() {
    let conn = with_users();

    seed_catalog_dated(&conn, "2030-01-03").unwrap();

    let oldest: String = conn
        .query_row("SELECT MIN(date) FROM exchange_rates", [], |row| row.get(0))
        .unwrap();
    assert_eq!(oldest, "2029-12-28");
}

#[test]
fn local_today_is_a_valid_calendar_date() {
    let conn = migrated();

    let today = local_today(&conn).unwrap();

    assert!(is_calendar_date(&today));
}

#[test]
fn seeds_nothing_when_a_single_service_exists() {
    let conn = with_users();
    conn.execute(
        "INSERT INTO services (name, name_key, price_cents, duration_min) \
         VALUES ('Propio', 'propio', 1000, 30)",
        [],
    )
    .unwrap();

    seed_catalog_dated(&conn, TODAY).unwrap();

    assert_eq!(count(&conn, "services"), 1);
    assert_eq!(count(&conn, "exchange_rates"), 0);
}

#[test]
fn seeds_nothing_when_a_single_rate_exists() {
    let conn = with_users();
    conn.execute(
        "INSERT INTO exchange_rates (date, rate_bs_per_usd_e4) VALUES ('2025-01-01', 100000)",
        [],
    )
    .unwrap();

    seed_catalog_dated(&conn, TODAY).unwrap();

    assert_eq!(count(&conn, "exchange_rates"), 1);
    assert_eq!(count(&conn, "services"), 0);
}

#[test]
fn second_run_changes_nothing() {
    let conn = with_users();
    seed_catalog_dated(&conn, TODAY).unwrap();
    let services = stored_services(&conn);
    let audit_rows = count(&conn, "audit_log");

    seed_catalog_dated(&conn, "2026-04-01").unwrap();

    assert_eq!(stored_services(&conn), services);
    assert_eq!(count(&conn, "exchange_rates"), 7);
    assert_eq!(count(&conn, "audit_log"), audit_rows);
}

#[test]
fn does_nothing_without_the_seed_variable() {
    let conn = with_users();

    seed_catalog_if_empty(&conn, &env_without_variables).unwrap();

    assert_eq!(count(&conn, "services"), 0);
    assert_eq!(count(&conn, "exchange_rates"), 0);
}

#[test]
fn does_nothing_with_an_empty_seed_variable() {
    let conn = with_users();

    seed_catalog_if_empty(&conn, &env_empty_password).unwrap();

    assert_eq!(count(&conn, "services"), 0);
    assert_eq!(count(&conn, "exchange_rates"), 0);
}

#[test]
fn seeds_through_the_environment_gate() {
    let conn = with_users();

    seed_catalog_if_empty(&conn, &env_with_password).unwrap();

    assert_eq!(count(&conn, "services"), 8);
    assert_eq!(count(&conn, "exchange_rates"), 7);
}

#[test]
fn does_nothing_when_there_is_no_owner_to_act() {
    let conn = migrated();

    seed_catalog_dated(&conn, TODAY).unwrap();

    assert_eq!(count(&conn, "services"), 0);
    assert_eq!(count(&conn, "exchange_rates"), 0);
}

#[test]
fn service_name_keys_match_the_named_records_rule() {
    let conn = with_users();
    seed_catalog_dated(&conn, TODAY).unwrap();

    let mut statement = conn
        .prepare("SELECT name, name_key FROM services ORDER BY id")
        .unwrap();
    let pairs: Vec<(String, String)> = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();

    assert_eq!(pairs.len(), 8);
    assert!(pairs.iter().all(|(name, key)| *key == name_key(name)));
}

#[test]
fn seeded_rows_are_attributed_to_the_owner() {
    let conn = with_users();
    seed_catalog_dated(&conn, TODAY).unwrap();
    let owner = owner_id(&conn);

    let attributed = |table: &str| -> i64 {
        conn.query_row(
            &format!("SELECT COUNT(*) FROM {table} WHERE created_by = ?1 AND updated_by = ?1"),
            [owner],
            |row| row.get(0),
        )
        .unwrap()
    };

    assert_eq!(attributed("services"), 8);
    assert_eq!(attributed("exchange_rates"), 7);
}

#[test]
fn seeding_is_audited_with_the_owner_as_actor() {
    let conn = with_users();
    seed_catalog_dated(&conn, TODAY).unwrap();
    let owner = owner_id(&conn);

    let created_services = audited(&conn, AuditAction::Create, AuditEntity::Service, owner);
    let deactivated = audited(&conn, AuditAction::Deactivate, AuditEntity::Service, owner);
    let created_rates = audited(&conn, AuditAction::Create, AuditEntity::ExchangeRate, owner);

    assert_eq!(created_services, 8);
    assert_eq!(deactivated, 1);
    assert_eq!(created_rates, 7);
}

#[test]
fn resource_and_payment_method_ids_are_untouched() {
    let conn = with_users();
    let resources = ids_of(&conn, "resources");
    let methods = ids_of(&conn, "payment_methods");

    seed_catalog_dated(&conn, TODAY).unwrap();

    assert_eq!(resources, [1, 2, 3]);
    assert_eq!(methods, [1, 2, 3, 4, 5]);
    assert_eq!(ids_of(&conn, "resources"), resources);
    assert_eq!(ids_of(&conn, "payment_methods"), methods);
}

#[test]
fn catalog_and_rates_errors_map_to_setup_errors() {
    let db = SetupError::from(CatalogError::Db(DbError::NotADatabase));
    let rejected = SetupError::from(CatalogError::Validation { field: "name" });
    let rates_rejected = SetupError::from(RatesError::Validation { field: "date" });
    let auth = SetupError::from(RatesError::Auth(AuthError::SetupClosed));

    assert!(matches!(db, SetupError::Db(_)));
    assert!(matches!(rejected, SetupError::SeedCatalogRejected));
    assert!(matches!(rates_rejected, SetupError::SeedCatalogRejected));
    assert!(matches!(auth, SetupError::Auth(_)));
}

#[test]
fn a_failure_while_seeding_rates_rolls_back_the_services() {
    let conn = with_users();
    conn.execute_batch(
        "CREATE TRIGGER block_rates BEFORE INSERT ON exchange_rates \
         BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
    )
    .unwrap();

    let result = seed_catalog_dated(&conn, TODAY);

    assert!(matches!(result, Err(SetupError::Db(_))));
    assert_eq!(count(&conn, "services"), 0);
    assert_eq!(count(&conn, "audit_log"), 0);
}

fn insert_user(conn: &Connection, username: &str, role_id: i64) -> i64 {
    conn.execute(
        "INSERT INTO users (username, password_hash, role_id) VALUES (?1, 'hash', ?2)",
        rusqlite::params![username, role_id],
    )
    .unwrap();
    conn.last_insert_rowid()
}

fn assert_nothing_seeded(conn: &Connection) {
    assert_eq!(count(conn, "services"), 0);
    assert_eq!(count(conn, "exchange_rates"), 0);
    assert_eq!(count(conn, "audit_log"), 0);
}

#[test]
fn an_active_real_owner_without_the_seeded_user_seeds_and_attributes_nothing() {
    let conn = migrated();
    insert_user(&conn, "duena-real", 1);

    seed_catalog_dated(&conn, TODAY).unwrap();

    assert_nothing_seeded(&conn);
}

#[test]
fn the_actor_is_the_seeded_owner_even_when_a_real_owner_has_a_lower_id() {
    let conn = migrated();
    let real_owner = insert_user(&conn, "duena-real", 1);
    let seeded_owner = insert_user(&conn, "propietaria", 1);

    seed_catalog_dated(&conn, TODAY).unwrap();

    let attributed_to = |owner: i64| -> i64 {
        conn.query_row(
            "SELECT (SELECT COUNT(*) FROM services WHERE created_by = ?1) \
                  + (SELECT COUNT(*) FROM exchange_rates WHERE created_by = ?1) \
                  + (SELECT COUNT(*) FROM audit_log WHERE actor_user_id = ?1)",
            [owner],
            |row| row.get(0),
        )
        .unwrap()
    };
    assert!(real_owner < seeded_owner);
    assert_eq!(attributed_to(real_owner), 0);
    assert_eq!(attributed_to(seeded_owner), 8 + 7 + 8 + 1 + 7);
}

#[test]
fn an_inactive_seeded_owner_seeds_nothing() {
    let conn = with_users();
    conn.execute(
        "UPDATE users SET active = 0 WHERE username = 'propietaria'",
        [],
    )
    .unwrap();

    seed_catalog_dated(&conn, TODAY).unwrap();

    assert_nothing_seeded(&conn);
}

#[test]
fn a_seeded_username_without_the_owner_role_seeds_nothing() {
    let conn = migrated();
    insert_user(&conn, "propietaria", 2);

    seed_catalog_dated(&conn, TODAY).unwrap();

    assert_nothing_seeded(&conn);
}

#[test]
fn is_empty_reports_each_table_independently() {
    let conn = with_users();
    assert!(is_empty(&conn, NamedTable::Services).unwrap());
    assert!(is_empty(&conn, NamedTable::ExchangeRates).unwrap());

    conn.execute(
        "INSERT INTO exchange_rates (date, rate_bs_per_usd_e4) VALUES ('2025-01-01', 100000)",
        [],
    )
    .unwrap();
    assert!(is_empty(&conn, NamedTable::Services).unwrap());
    assert!(!is_empty(&conn, NamedTable::ExchangeRates).unwrap());

    conn.execute("DELETE FROM exchange_rates", []).unwrap();
    conn.execute(
        "INSERT INTO services (name, name_key, price_cents, duration_min) \
         VALUES ('Propio', 'propio', 1000, 30)",
        [],
    )
    .unwrap();
    assert!(!is_empty(&conn, NamedTable::Services).unwrap());
    assert!(is_empty(&conn, NamedTable::ExchangeRates).unwrap());
}

const FORCED_TIMEZONE_VAR: &str = "SPA_TEST_FORCED_TIMEZONE_CHILD";
const FORCED_TIMEZONE_TEST: &str = "dev_seed_catalog::tests::local_today_in_the_forced_timezone";
const TIMEZONES_COVERING_EVERY_UTC_HOUR: [&str; 2] = ["UTC-14", "UTC+12"];

#[test]
fn local_today_in_the_forced_timezone() {
    if std::env::var(FORCED_TIMEZONE_VAR).is_err() {
        return;
    }
    let conn = migrated();

    let expected: String = conn
        .query_row("SELECT date('now', 'localtime')", [], |row| row.get(0))
        .unwrap();

    assert_eq!(local_today(&conn).unwrap(), expected);
}

#[test]
fn local_today_follows_the_local_timezone_not_utc() {
    for timezone in TIMEZONES_COVERING_EVERY_UTC_HOUR {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", FORCED_TIMEZONE_TEST])
            .env("TZ", timezone)
            .env(FORCED_TIMEZONE_VAR, "1")
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);

        assert!(output.status.success(), "{timezone}: {stdout}");
        assert!(stdout.contains("1 passed"), "{timezone}: {stdout}");
    }
}
