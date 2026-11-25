use rusqlite::Connection;
use serde_json::{json, Value};

use super::*;
use crate::db::{migrate, Database};
use crate::features::audit::repository::list_all;
use crate::features::audit::{AuditAction, AuditEntity, AuditEntry};
use crate::features::rates::model::MAX_RATE_E4;
use crate::features::users::repository::{insert_user, NewUserRow};

const OWNER_ROLE: i64 = 1;
const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";

struct Fixture {
    database: Database,
    actor: i64,
}

fn fixture() -> Fixture {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    let row = NewUserRow {
        username: "duena".to_string(),
        password_hash: "hash-opaco".to_string(),
        role_id: OWNER_ROLE,
    };
    let actor = insert_user(&conn, &row, None).unwrap();
    Fixture {
        database: Database::new(conn),
        actor,
    }
}

fn run<T>(
    fixture: &Fixture,
    operation: impl FnOnce(&Connection) -> Result<T, RatesError>,
) -> Result<T, RatesError> {
    fixture.database.with_tx(|tx| operation(tx))
}

fn save(fixture: &Fixture, date: &str, value: i64) -> Result<ExchangeRate, RatesError> {
    run(fixture, |conn| {
        upsert_rate(conn, fixture.actor, date, value)
    })
}

fn fetch(fixture: &Fixture, date: &str) -> Result<Option<ExchangeRate>, RatesError> {
    run(fixture, |conn| get_rate(conn, date))
}

fn audit_rows(fixture: &Fixture) -> Vec<AuditEntry> {
    fixture.database.with_conn(list_all).unwrap()
}

fn diff_of(entry: &AuditEntry) -> Value {
    serde_json::from_str(entry.diff.as_ref().unwrap()).unwrap()
}

fn stored(fixture: &Fixture) -> Vec<ExchangeRate> {
    fixture.database.with_conn(repository::list_rates).unwrap()
}

fn stored_id(fixture: &Fixture, date: &str) -> i64 {
    fixture
        .database
        .with_conn(|conn| repository::find_rate(conn, date))
        .unwrap()
        .unwrap()
        .id
}

fn break_audit(fixture: &Fixture) {
    fixture
        .database
        .with_conn(|conn| {
            conn.execute_batch(FAIL_AUDIT_INSERTS)?;
            Ok(())
        })
        .unwrap();
}

fn is_field(error: RatesError, expected: &str) -> bool {
    matches!(error, RatesError::Validation { field } if field == expected)
}

#[test]
fn saving_a_new_date_creates_the_rate_and_audits_a_create_on_the_exchange_rate_entity() {
    let fixture = fixture();

    let saved = save(&fixture, "2026-11-12", 365_000).unwrap();

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action.as_str(), "create");
    assert_eq!(rows[0].entity.as_str(), "exchange_rate");
    assert_eq!(rows[0].entity_id, Some(stored_id(&fixture, "2026-11-12")));
    assert_eq!(rows[0].actor_user_id, Some(fixture.actor));
    assert_eq!(
        diff_of(&rows[0]),
        json!({ "date": "2026-11-12", "rateBsPerUsdE4": 365_000 })
    );
    assert_eq!(
        saved,
        ExchangeRate {
            date: "2026-11-12".into(),
            rate_bs_per_usd_e4: 365_000
        }
    );
    assert_eq!(stored(&fixture), vec![saved]);
}

#[test]
fn the_audit_vocabulary_allows_create_and_update_of_exchange_rates() {
    for action in [AuditAction::Create, AuditAction::Update] {
        assert!(
            action
                .allowed_entities()
                .contains(&AuditEntity::ExchangeRate),
            "{}",
            action.as_str()
        );
    }
}

#[test]
fn the_audit_diff_keeps_the_rate_value_through_the_redaction() {
    let fixture = fixture();

    save(&fixture, "2026-11-12", 365_000).unwrap();
    save(&fixture, "2026-11-12", 370_000).unwrap();

    let rows = audit_rows(&fixture);
    assert!(diff_of(&rows[0]).get("rateBsPerUsdE4").is_some());
    assert!(diff_of(&rows[1])
        .get("rateBsPerUsdE4")
        .is_some_and(|change| change.get("before").is_some() && change.get("after").is_some()));
}

#[test]
fn saving_an_existing_date_with_another_value_updates_it_with_a_before_after_diff() {
    let fixture = fixture();
    save(&fixture, "2026-11-12", 365_000).unwrap();
    let id = stored_id(&fixture, "2026-11-12");

    let updated = save(&fixture, "2026-11-12", 370_000).unwrap();

    let rows = audit_rows(&fixture);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1].action.as_str(), "update");
    assert_eq!(rows[1].entity.as_str(), "exchange_rate");
    assert_eq!(rows[1].entity_id, Some(id));
    assert_eq!(rows[1].actor_user_id, Some(fixture.actor));
    assert_eq!(
        diff_of(&rows[1]),
        json!({
            "date": "2026-11-12",
            "rateBsPerUsdE4": { "before": 365_000, "after": 370_000 }
        })
    );
    assert_eq!(updated.rate_bs_per_usd_e4, 370_000);
    assert_eq!(stored(&fixture), vec![updated]);
    assert_eq!(stored_id(&fixture, "2026-11-12"), id);
}

#[test]
fn auditing_a_past_rate_names_the_date_in_create_and_update() {
    let fixture = fixture();

    save(&fixture, "2026-01-05", 365_000).unwrap();
    save(&fixture, "2026-01-05", 370_000).unwrap();

    let rows = audit_rows(&fixture);
    assert_eq!(diff_of(&rows[0])["date"], json!("2026-01-05"));
    assert_eq!(
        diff_of(&rows[1]),
        json!({
            "date": "2026-01-05",
            "rateBsPerUsdE4": { "before": 365_000, "after": 370_000 }
        })
    );
}

#[test]
fn saving_the_same_value_neither_writes_nor_audits() {
    let fixture = fixture();
    let first = save(&fixture, "2026-11-12", 365_000).unwrap();
    fixture
        .database
        .with_conn(|conn| {
            conn.execute(
                "UPDATE exchange_rates SET updated_at = '2000-01-01T00:00'",
                [],
            )?;
            Ok(())
        })
        .unwrap();

    let again = save(&fixture, "2026-11-12", 365_000).unwrap();

    assert_eq!(again, first);
    assert_eq!(audit_rows(&fixture).len(), 1);
    let updated_at: String = fixture
        .database
        .with_conn(|conn| {
            Ok(
                conn.query_row("SELECT updated_at FROM exchange_rates", [], |row| {
                    row.get(0)
                })?,
            )
        })
        .unwrap();
    assert_eq!(updated_at, "2000-01-01T00:00");
}

#[test]
fn different_dates_keep_independent_rates() {
    let fixture = fixture();

    save(&fixture, "2026-11-12", 365_000).unwrap();
    save(&fixture, "2026-11-13", 366_000).unwrap();
    save(&fixture, "2026-11-12", 367_000).unwrap();

    assert_eq!(
        fetch(&fixture, "2026-11-13")
            .unwrap()
            .unwrap()
            .rate_bs_per_usd_e4,
        366_000
    );
    assert_eq!(stored(&fixture).len(), 2);
}

#[test]
fn a_calendar_impossible_or_malformed_date_is_rejected_on_the_date_field() {
    let fixture = fixture();

    for date in [
        "2026-02-30",
        "2026-02-29",
        "2026-13-01",
        "2026-00-01",
        "12-11-2026",
        "2026-1-1",
        "",
        "2026-11-12T10:00",
        " 2026-11-12",
    ] {
        let error = save(&fixture, date, 365_000).unwrap_err();
        assert!(is_field(error, "date"), "{date:?}");
    }

    assert!(stored(&fixture).is_empty());
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn leap_day_is_accepted_only_in_leap_years() {
    let fixture = fixture();

    assert!(save(&fixture, "2024-02-29", 365_000).is_ok());
    assert!(is_field(
        save(&fixture, "2025-02-29", 365_000).unwrap_err(),
        "date"
    ));
}

#[test]
fn rates_outside_one_and_the_maximum_are_rejected_on_the_rate_field() {
    let fixture = fixture();

    for value in [0, -1, i64::MIN, MAX_RATE_E4 + 1, i64::MAX] {
        let error = save(&fixture, "2026-11-12", value).unwrap_err();
        assert!(is_field(error, "rateBsPerUsdE4"), "{value}");
    }

    assert!(stored(&fixture).is_empty());
    assert!(audit_rows(&fixture).is_empty());
}

#[test]
fn the_boundary_rates_one_and_the_maximum_are_accepted() {
    let fixture = fixture();

    let lowest = save(&fixture, "2026-11-12", 1).unwrap();
    let highest = save(&fixture, "2026-11-13", MAX_RATE_E4).unwrap();

    assert_eq!(lowest.rate_bs_per_usd_e4, 1);
    assert_eq!(highest.rate_bs_per_usd_e4, MAX_RATE_E4);
}

#[test]
fn an_invalid_rate_does_not_alter_the_stored_rate_of_an_existing_date() {
    let fixture = fixture();
    let original = save(&fixture, "2026-11-12", 365_000).unwrap();

    let error = save(&fixture, "2026-11-12", 0).unwrap_err();

    assert!(is_field(error, "rateBsPerUsdE4"));
    assert_eq!(stored(&fixture), vec![original]);
    assert_eq!(audit_rows(&fixture).len(), 1);
}

#[test]
fn the_date_is_validated_before_the_rate() {
    let fixture = fixture();

    let error = save(&fixture, "2026-02-30", 0).unwrap_err();

    assert!(is_field(error, "date"));
}

#[test]
fn get_rate_returns_none_for_a_date_without_rate() {
    let fixture = fixture();
    save(&fixture, "2026-11-12", 365_000).unwrap();

    assert_eq!(fetch(&fixture, "2026-11-13").unwrap(), None);
}

#[test]
fn get_rate_returns_the_saved_rate() {
    let fixture = fixture();
    let saved = save(&fixture, "2026-11-12", 365_000).unwrap();

    assert_eq!(fetch(&fixture, "2026-11-12").unwrap(), Some(saved));
}

#[test]
fn get_rate_rejects_a_malformed_date_on_the_date_field() {
    let fixture = fixture();

    for date in ["2026-02-30", "nope", ""] {
        let error = fetch(&fixture, date).unwrap_err();
        assert!(is_field(error, "date"), "{date:?}");
    }
}

#[test]
fn a_failing_audit_rolls_back_the_creation() {
    let fixture = fixture();
    break_audit(&fixture);

    let error = save(&fixture, "2026-11-12", 365_000).unwrap_err();

    assert!(matches!(error, RatesError::Db(_)));
    assert!(stored(&fixture).is_empty());
}

#[test]
fn a_failing_audit_rolls_back_the_update() {
    let fixture = fixture();
    let original = save(&fixture, "2026-11-12", 365_000).unwrap();
    break_audit(&fixture);

    let error = save(&fixture, "2026-11-12", 370_000).unwrap_err();

    assert!(matches!(error, RatesError::Db(_)));
    assert_eq!(stored(&fixture), vec![original]);
}

#[test]
fn a_foreign_key_failure_on_the_actor_is_a_database_error_without_side_effects() {
    let fixture = fixture();

    let error = run(&fixture, |conn| {
        upsert_rate(conn, 9999, "2026-11-12", 365_000)
    })
    .unwrap_err();

    assert!(matches!(error, RatesError::Db(_)));
    assert!(stored(&fixture).is_empty());
    assert!(audit_rows(&fixture).is_empty());
}
