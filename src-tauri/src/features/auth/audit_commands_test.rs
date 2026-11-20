use std::time::Duration;

use rusqlite::Connection;
use tauri::test::{mock_app, MockRuntime};
use tauri::{App, Manager, State};

use super::*;
use crate::db::{migrate, Database};
use crate::errors::AppErrorCode;
use crate::features::audit::{self, AuditAction, AuditEntity, Diff, NewAuditEntry};
use crate::features::auth::model::SessionUser;
use crate::features::auth::repository::{insert_user, NewUser};
use crate::features::auth::service::{Beat, LockReason, SessionState, IDLE_TIMEOUT};

const OWNER_ROLE_ID: i64 = 1;
const RECEPTION_ROLE_ID: i64 = 2;
const SEEDED_ENTRIES: usize = 7;

struct Fixture {
    app: App<MockRuntime>,
}

fn fixture() -> Fixture {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    let app = mock_app();
    app.manage(Database::new(conn));
    app.manage(SessionState::default());
    Fixture { app }
}

fn database(fixture: &Fixture) -> State<'_, Database> {
    fixture.app.state()
}

fn add_user(fixture: &Fixture, username: &str, role_id: i64) -> i64 {
    let user = NewUser {
        username: username.to_string(),
        password_hash: "hash".to_string(),
        role_id,
    };
    database(fixture)
        .with_conn(|conn| insert_user(conn, &user))
        .unwrap()
}

fn sign_in_as(fixture: &Fixture, username: &str, role_id: i64) -> i64 {
    let id = add_user(fixture, username, role_id);
    let user = SessionUser {
        id,
        username: username.to_string(),
        role_name: String::new(),
        permissions: vec![],
    };
    let session: State<'_, SessionState> = fixture.app.state();
    session.start(user, Beat::now()).unwrap();
    id
}

fn record(fixture: &Fixture, actor: Option<i64>, action: AuditAction) -> i64 {
    let entry = NewAuditEntry {
        actor_user_id: actor,
        action,
        entity: AuditEntity::System,
        entity_id: None,
        diff: Some(Diff::note("seed")),
    };
    database(fixture)
        .with_conn(|conn| audit::record(conn, &entry))
        .unwrap()
}

fn seed_entries(fixture: &Fixture, actor: Option<i64>) -> Vec<i64> {
    (0..SEEDED_ENTRIES)
        .map(|_| record(fixture, actor, AuditAction::Logout))
        .collect()
}

fn query(before_id: Option<i64>, limit: u32) -> AuditQuery {
    AuditQuery { before_id, limit }
}

fn list(fixture: &Fixture, query: AuditQuery) -> Result<AuditPage, crate::errors::AppError> {
    list_audit(query, fixture.app.state(), fixture.app.state())
}

fn ids(page: &AuditPage) -> Vec<i64> {
    page.entries.iter().map(|entry| entry.id).collect()
}

fn corrupt_row(fixture: &Fixture, action: &str, entity: &str) {
    database(fixture)
        .with_conn(|conn| {
            conn.execute_batch("PRAGMA ignore_check_constraints = ON;")?;
            conn.execute(
                "INSERT INTO audit_log (action, entity) VALUES (?1, ?2)",
                [action, entity],
            )?;
            conn.execute_batch("PRAGMA ignore_check_constraints = OFF;")?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn list_audit_requires_audit_read() {
    let fixture = fixture();
    seed_entries(&fixture, None);
    sign_in_as(&fixture, "recepcion", RECEPTION_ROLE_ID);

    let denied = list(&fixture, query(None, 10)).unwrap_err();

    assert_eq!(denied.code, AppErrorCode::Forbidden);
}

#[test]
fn list_audit_without_session_is_unauthenticated() {
    let fixture = fixture();

    let denied = list(&fixture, query(None, 10)).unwrap_err();

    assert_eq!(denied.code, AppErrorCode::Unauthenticated);
}

#[test]
fn list_audit_locked_session_rejected() {
    let fixture = fixture();
    seed_entries(&fixture, None);
    sign_in_as(&fixture, "propietaria", OWNER_ROLE_ID);
    let session: State<'_, SessionState> = fixture.app.state();
    session.force_lock().unwrap();

    let denied = list(&fixture, query(None, 10)).unwrap_err();

    assert_eq!(denied.code, AppErrorCode::SessionLocked);
}

fn sign_in_idle_past_timeout(fixture: &Fixture, username: &str) -> i64 {
    let id = add_user(fixture, username, OWNER_ROLE_ID);
    let user = SessionUser {
        id,
        username: username.to_string(),
        role_name: String::new(),
        permissions: vec![],
    };
    let session: State<'_, SessionState> = fixture.app.state();
    let now = Beat::now();
    match backdated(now, IDLE_TIMEOUT + Duration::from_secs(1)) {
        Some(past) => session.start(user, past).unwrap(),
        None => {
            session.start(user, now).unwrap();
            session.lock_with_pending_audit_for_test(LockReason::Idle);
        }
    }
    id
}

fn backdated(now: Beat, by: Duration) -> Option<Beat> {
    Some(Beat {
        mono: now.mono.checked_sub(by)?,
        wall: now.wall.checked_sub(by)?,
    })
}

fn session_locked_rows(fixture: &Fixture) -> Vec<Option<i64>> {
    database(fixture)
        .with_conn(|conn| {
            let mut statement = conn.prepare(
                "SELECT actor_user_id FROM audit_log WHERE action = 'session_locked' ORDER BY id",
            )?;
            let rows = statement
                .query_map([], |row| row.get::<_, Option<i64>>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .unwrap()
}

#[test]
fn list_audit_locked_session_audits_session_locked_once_and_keeps_the_row() {
    let fixture = fixture();
    let user_id = sign_in_idle_past_timeout(&fixture, "propietaria");

    let denied = list(&fixture, query(None, 10)).unwrap_err();

    assert_eq!(denied.code, AppErrorCode::SessionLocked);
    assert_eq!(session_locked_rows(&fixture), vec![Some(user_id)]);
}

#[test]
fn list_audit_second_call_while_locked_does_not_duplicate_the_audit_row() {
    let fixture = fixture();
    let user_id = sign_in_idle_past_timeout(&fixture, "propietaria");

    let first = list(&fixture, query(None, 10)).unwrap_err();
    let second = list(&fixture, query(None, 10)).unwrap_err();

    assert_eq!(first.code, AppErrorCode::SessionLocked);
    assert_eq!(second.code, AppErrorCode::SessionLocked);
    assert_eq!(session_locked_rows(&fixture), vec![Some(user_id)]);
}

#[test]
fn list_audit_paginates_by_keyset_desc() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria", OWNER_ROLE_ID);
    let mut recorded = seed_entries(&fixture, None);
    recorded.reverse();

    let first = list(&fixture, query(None, 3)).unwrap();
    let second = list(&fixture, query(first.next_before_id, 3)).unwrap();
    let last = list(&fixture, query(second.next_before_id, 3)).unwrap();

    assert_eq!(ids(&first), recorded[0..3]);
    assert_eq!(first.next_before_id, Some(recorded[2]));
    assert_eq!(ids(&second), recorded[3..6]);
    assert_eq!(second.next_before_id, Some(recorded[5]));
    assert_eq!(ids(&last), recorded[6..]);
    assert_eq!(last.next_before_id, None);
}

#[test]
fn list_audit_exact_page_has_no_next_cursor() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria", OWNER_ROLE_ID);
    let recorded = seed_entries(&fixture, None);
    let all = u32::try_from(recorded.len()).unwrap();

    let page = list(&fixture, query(None, all)).unwrap();

    assert_eq!(page.entries.len(), recorded.len());
    assert_eq!(page.next_before_id, None);
}

#[test]
fn list_audit_before_id_is_exclusive() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria", OWNER_ROLE_ID);
    let recorded = seed_entries(&fixture, None);
    let pivot = recorded[3];

    let page = list(&fixture, query(Some(pivot), 50)).unwrap();

    assert!(page.entries.iter().all(|entry| entry.id < pivot));
}

#[test]
fn list_audit_caps_limit_and_rejects_zero_and_over_200() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria", OWNER_ROLE_ID);
    seed_entries(&fixture, None);

    let zero = list(&fixture, query(None, 0)).unwrap_err();
    let over = list(&fixture, query(None, MAX_AUDIT_PAGE + 1)).unwrap_err();
    let at_cap = list(&fixture, query(None, MAX_AUDIT_PAGE)).unwrap();
    let minimum = list(&fixture, query(None, 1)).unwrap();

    assert_eq!(MAX_AUDIT_PAGE, 200);
    assert_eq!(zero.code, AppErrorCode::Validation);
    assert_eq!(zero.field.as_deref(), Some("limit"));
    assert_eq!(over.code, AppErrorCode::Validation);
    assert_eq!(over.field.as_deref(), Some("limit"));
    assert!(at_cap.entries.len() > 1);
    assert_eq!(minimum.entries.len(), 1);
}

#[test]
fn list_audit_checks_permission_before_validating_limit() {
    let fixture = fixture();
    sign_in_as(&fixture, "recepcion", RECEPTION_ROLE_ID);

    let denied = list(&fixture, query(None, 0)).unwrap_err();

    assert_eq!(denied.code, AppErrorCode::Forbidden);
}

#[test]
fn list_audit_includes_actor_username_and_null_for_system() {
    let fixture = fixture();
    let owner = sign_in_as(&fixture, "propietaria", OWNER_ROLE_ID);
    let by_actor = record(&fixture, Some(owner), AuditAction::UserUpdated);
    let by_system = record(&fixture, None, AuditAction::ClockRollback);

    let page = list(&fixture, query(None, 10)).unwrap();

    let system = page.entries.iter().find(|e| e.id == by_system).unwrap();
    let actor = page.entries.iter().find(|e| e.id == by_actor).unwrap();
    assert_eq!(system.actor_username, None);
    assert_eq!(system.actor_user_id, None);
    assert_eq!(actor.actor_username.as_deref(), Some("propietaria"));
    assert_eq!(actor.actor_user_id, Some(owner));
    assert_eq!(actor.action, AuditAction::UserUpdated);
    assert_eq!(actor.entity, AuditEntity::System);
    assert_eq!(actor.diff.as_deref(), Some(r#"{"note":"seed"}"#));
}

#[test]
fn list_audit_unparseable_action_is_an_error() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria", OWNER_ROLE_ID);
    seed_entries(&fixture, None);
    corrupt_row(&fixture, "hack", "system");

    let failure = list(&fixture, query(None, 10)).unwrap_err();

    assert_eq!(failure.code, AppErrorCode::Internal);
}

#[test]
fn list_audit_unparseable_entity_is_an_error() {
    let fixture = fixture();
    sign_in_as(&fixture, "propietaria", OWNER_ROLE_ID);
    corrupt_row(&fixture, "logout", "mystery");

    let failure = list(&fixture, query(None, 10)).unwrap_err();

    assert_eq!(failure.code, AppErrorCode::Internal);
}

#[test]
fn audit_query_deserializes_camel_case() {
    let parsed: AuditQuery = serde_json::from_str(r#"{"beforeId": 9, "limit": 25}"#).unwrap();
    let without_cursor: AuditQuery =
        serde_json::from_str(r#"{"beforeId": null, "limit": 1}"#).unwrap();

    assert_eq!(parsed, query(Some(9), 25));
    assert_eq!(without_cursor, query(None, 1));
}

#[test]
fn audit_page_serializes_camel_case() {
    let page = AuditPage {
        entries: vec![],
        next_before_id: Some(4),
    };

    let value = serde_json::to_value(page).unwrap();

    assert_eq!(value["nextBeforeId"], 4);
    assert_eq!(value["entries"], serde_json::json!([]));
}
