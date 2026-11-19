use std::path::PathBuf;
use std::sync::Arc;

use tauri::test::{mock_app, MockRuntime};
use tauri::{App, Manager};
use tempfile::TempDir;

use super::*;
use crate::db::{migrate, open_encrypted, DbKey};
use crate::errors::AppErrorCode;
use crate::features::audit::repository::list_all;
use crate::features::auth::commands::{current_session, login};
use crate::features::auth::model::{LoginCredentials, OwnerSetup, SessionUser};
use crate::features::auth::owner_setup::create_owner;
use crate::features::auth::recovery::RecoveryCode;
use crate::features::auth::repository::{
    find_credentials_by_username, insert_user, rotate_credentials, NewUser,
};

const OWNER_USERNAME: &str = "propietaria";
const OWNER_PASSWORD: &str = "clave-propietaria-1";
const NEW_PASSWORD: &str = "clave-nueva-segura-2";
const OTHER_NEW_PASSWORD: &str = "otra-clave-nueva-3";
const RECEPTION_USERNAME: &str = "recepcion";
const RECEPTION_PASSWORD: &str = "clave-recepcion-1";
const WRONG_CODE: &str = "AAAA-AAAA-AAAA-AAAA-AAAA";
const WRONG_PASSWORD: &str = "contrasena-equivocada";
const FAILURES_TO_LOCK_OUT: usize = 5;
const RACING_CALLERS: usize = 4;
const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";
const CLEAR_PERSISTED_THROTTLE: &str = "DELETE FROM login_throttle";

struct Installation {
    dir: TempDir,
    key: DbKey,
    recovery_code: String,
}

impl Installation {
    fn database_path(&self) -> PathBuf {
        self.dir.path().join("recover.db")
    }

    fn create() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let key = DbKey::generate().unwrap();
        let mut conn = open_encrypted(&dir.path().join("recover.db"), &key).unwrap();
        migrate(&mut conn).unwrap();
        let database = Database::new(conn);
        let policy = Arc::new(PasswordPolicy::new().unwrap());
        let created = tauri::async_runtime::block_on(create_owner(
            &database,
            Arc::clone(&policy),
            &SessionState::default(),
            OwnerSetup {
                username: OWNER_USERNAME.to_string(),
                password: OWNER_PASSWORD.to_string(),
            },
        ))
        .unwrap();
        let reception = NewUser {
            username: RECEPTION_USERNAME.to_string(),
            password_hash: policy.hash(RECEPTION_PASSWORD).unwrap(),
            role_id: 2,
        };
        database
            .with_conn(|conn| insert_user(conn, &reception))
            .unwrap();
        Self {
            dir,
            key,
            recovery_code: created.recovery_code,
        }
    }

    fn boot(&self) -> App<MockRuntime> {
        let key = DbKey::from_hex(self.key.as_hex().to_string()).unwrap();
        let conn = open_encrypted(&self.database_path(), &key).unwrap();
        let app = mock_app();
        app.manage(Database::new(conn));
        app.manage(Arc::new(PasswordPolicy::new().unwrap()));
        app.manage(LoginThrottle::default());
        app.manage(SessionState::default());
        app
    }

    fn canonical(&self) -> String {
        RecoveryCode::parse(&self.recovery_code)
            .unwrap()
            .canonical()
            .to_string()
    }
}

fn recover(
    app: &App<MockRuntime>,
    username: &str,
    code: &str,
    new_password: &str,
) -> Result<RecoveryResult, AppError> {
    tauri::async_runtime::block_on(recover_password(
        RecoveryRequest {
            username: username.to_string(),
            recovery_code: code.to_string(),
            new_password: new_password.to_string(),
        },
        app.state(),
        app.state(),
        app.state(),
        app.state(),
    ))
}

fn sign_in(
    app: &App<MockRuntime>,
    username: &str,
    password: &str,
) -> Result<SessionUser, AppError> {
    tauri::async_runtime::block_on(login(
        LoginCredentials {
            username: username.to_string(),
            password: password.to_string(),
        },
        app.state(),
        app.state(),
        app.state(),
        app.state(),
    ))
}

fn assert_invalid_credentials<T: std::fmt::Debug>(outcome: Result<T, AppError>) {
    assert_eq!(outcome.unwrap_err().code, AppErrorCode::InvalidCredentials);
}

fn database_of(app: &App<MockRuntime>) -> tauri::State<'_, Database> {
    app.state()
}

fn verifications(app: &App<MockRuntime>) -> usize {
    app.state::<Arc<PasswordPolicy>>().verification_count()
}

fn hashes_computed(app: &App<MockRuntime>) -> usize {
    app.state::<Arc<PasswordPolicy>>().hash_count()
}

fn stored_hashes(app: &App<MockRuntime>) -> (String, Option<String>) {
    database_of(app)
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT password_hash, recovery_code_hash FROM users WHERE username = ?1",
                [OWNER_USERNAME],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?)
        })
        .unwrap()
}

fn owner_id(app: &App<MockRuntime>) -> i64 {
    database_of(app)
        .with_conn(|conn| {
            Ok(find_credentials_by_username(conn, OWNER_USERNAME)?
                .unwrap()
                .id)
        })
        .unwrap()
}

fn audit_actions(app: &App<MockRuntime>, action: &str) -> Vec<crate::features::audit::AuditEntry> {
    database_of(app)
        .with_conn(list_all)
        .unwrap()
        .into_iter()
        .filter(|entry| entry.action.as_str() == action)
        .collect()
}

fn audit_dump(app: &App<MockRuntime>) -> String {
    let entries = database_of(app).with_conn(list_all).unwrap();
    format!("{entries:?}").to_lowercase()
}

fn fail_recovering(app: &App<MockRuntime>, times: usize) {
    for _ in 0..times {
        assert_invalid_credentials(recover(app, OWNER_USERNAME, WRONG_CODE, NEW_PASSWORD));
    }
}

fn clear_persisted_throttle(app: &App<MockRuntime>) {
    database_of(app)
        .with_conn(|conn| {
            conn.execute_batch(CLEAR_PERSISTED_THROTTLE)?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn reused_code_rejected() {
    let installation = Installation::create();
    let app = installation.boot();
    recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD,
    )
    .unwrap();

    let reuse = recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code,
        OTHER_NEW_PASSWORD,
    );

    assert_invalid_credentials(reuse);
    assert!(sign_in(&app, OWNER_USERNAME, NEW_PASSWORD).is_ok());
    assert_invalid_credentials(sign_in(&app, OWNER_USERNAME, OTHER_NEW_PASSWORD));
}

#[test]
fn valid_code_rotates_and_returns_new_code_and_old_one_stops_working() {
    let installation = Installation::create();
    let app = installation.boot();
    let (_, hash_before) = stored_hashes(&app);

    let rotated = recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code.to_lowercase(),
        NEW_PASSWORD,
    )
    .unwrap();

    let groups: Vec<&str> = rotated.recovery_code.split('-').collect();
    assert_eq!(groups.len(), 5);
    assert!(groups.iter().all(|group| group.len() == 4));
    let new_canonical = RecoveryCode::parse(&rotated.recovery_code)
        .unwrap()
        .canonical()
        .to_string();
    assert_ne!(new_canonical, installation.canonical());
    let (_, hash_after) = stored_hashes(&app);
    assert_ne!(hash_before, hash_after);
    assert_invalid_credentials(recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD,
    ));
    assert!(recover(
        &app,
        OWNER_USERNAME,
        &rotated.recovery_code,
        OTHER_NEW_PASSWORD
    )
    .is_ok());
}

#[test]
fn wrong_code_counts_in_shared_throttle() {
    let installation = Installation::create();
    let app = installation.boot();
    fail_recovering(&app, 3);
    for _ in 0..2 {
        assert_invalid_credentials(sign_in(&app, OWNER_USERNAME, WRONG_PASSWORD));
    }
    clear_persisted_throttle(&app);

    let blocked = recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD,
    );

    assert_invalid_credentials(blocked);
    assert_invalid_credentials(sign_in(&app, OWNER_USERNAME, OWNER_PASSWORD));
}

#[test]
fn recovery_denied_by_the_memory_throttle_still_runs_one_verification() {
    let installation = Installation::create();
    let app = installation.boot();
    fail_recovering(&app, FAILURES_TO_LOCK_OUT);
    clear_persisted_throttle(&app);
    let verifications_before = verifications(&app);

    let blocked = recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD,
    );

    assert_invalid_credentials(blocked);
    assert_eq!(verifications(&app), verifications_before + 1);
    assert!(audit_actions(&app, "recovery_used").is_empty());
}

#[test]
fn five_wrong_codes_lock_out_and_survive_restart() {
    let installation = Installation::create();
    let first_run = installation.boot();
    fail_recovering(&first_run, FAILURES_TO_LOCK_OUT);
    drop(first_run);

    let second_run = installation.boot();

    assert_invalid_credentials(recover(
        &second_run,
        OWNER_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD,
    ));
    assert_invalid_credentials(sign_in(&second_run, OWNER_USERNAME, OWNER_PASSWORD));
    assert_eq!(audit_actions(&second_run, "login_locked_out").len(), 1);
    assert_eq!(audit_actions(&second_run, "recovery_failed").len(), 5);
}

#[test]
fn lockout_blocks_recovery_even_with_correct_code() {
    let installation = Installation::create();
    let app = installation.boot();
    for _ in 0..FAILURES_TO_LOCK_OUT {
        assert_invalid_credentials(sign_in(&app, OWNER_USERNAME, WRONG_PASSWORD));
    }
    let (password_before, recovery_before) = stored_hashes(&app);
    let failures_before = audit_actions(&app, "recovery_failed").len();

    let outcome = recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD,
    );

    assert_invalid_credentials(outcome);
    assert_eq!(stored_hashes(&app), (password_before, recovery_before));
    assert_eq!(
        audit_actions(&app, "recovery_failed").len(),
        failures_before
    );
    assert!(audit_actions(&app, "recovery_used").is_empty());
}

#[test]
fn unknown_user_verifies_dummy_hash_and_returns_invalid_credentials() {
    let installation = Installation::create();
    let app = installation.boot();
    let verifications_before = verifications(&app);
    let entries_before = audit_dump(&app);

    let outcome = recover(&app, "fantasma", &installation.recovery_code, NEW_PASSWORD);

    assert_invalid_credentials(outcome);
    assert_eq!(verifications(&app), verifications_before + 1);
    assert_eq!(audit_dump(&app), entries_before);
    assert!(audit_actions(&app, "recovery_failed").is_empty());
}

#[test]
fn user_without_recovery_hash_gets_invalid_credentials() {
    let installation = Installation::create();
    let app = installation.boot();
    let verifications_before = verifications(&app);

    let outcome = recover(
        &app,
        RECEPTION_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD,
    );

    assert_invalid_credentials(outcome);
    assert_eq!(verifications(&app), verifications_before + 1);
    assert!(sign_in(&app, RECEPTION_USERNAME, RECEPTION_PASSWORD).is_ok());
}

#[test]
fn malformed_code_gets_invalid_credentials() {
    let installation = Installation::create();
    let app = installation.boot();
    let verifications_before = verifications(&app);

    let outcome = recover(&app, OWNER_USERNAME, "no-es-un-codigo", NEW_PASSWORD);

    assert_invalid_credentials(outcome);
    assert_eq!(verifications(&app), verifications_before + 1);
    assert!(sign_in(&app, OWNER_USERNAME, OWNER_PASSWORD).is_ok());
}

#[test]
fn recovery_used_audited_without_code_or_password() {
    let installation = Installation::create();
    let app = installation.boot();
    let (old_password_hash, old_recovery_hash) = stored_hashes(&app);
    let rotated = recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD,
    )
    .unwrap();
    assert_invalid_credentials(recover(&app, OWNER_USERNAME, WRONG_CODE, NEW_PASSWORD));

    let used = audit_actions(&app, "recovery_used");
    assert_eq!(used.len(), 1);
    assert_eq!(used[0].actor_user_id, Some(owner_id(&app)));
    assert_eq!(used[0].entity.as_str(), "user");
    assert_eq!(used[0].entity_id, Some(owner_id(&app)));
    let (new_password_hash, new_recovery_hash) = stored_hashes(&app);
    let dump = audit_dump(&app);
    let new_canonical = RecoveryCode::parse(&rotated.recovery_code)
        .unwrap()
        .canonical()
        .to_lowercase();
    for secret in [
        installation.canonical().to_lowercase(),
        installation.recovery_code.to_lowercase(),
        new_canonical,
        rotated.recovery_code.to_lowercase(),
        NEW_PASSWORD.to_lowercase(),
        OWNER_PASSWORD.to_lowercase(),
        WRONG_CODE.to_lowercase(),
        old_password_hash.to_lowercase(),
        old_recovery_hash.unwrap().to_lowercase(),
        new_password_hash.to_lowercase(),
        new_recovery_hash.unwrap().to_lowercase(),
        "argon2".to_string(),
    ] {
        assert!(!dump.contains(&secret), "{secret}");
    }
}

#[test]
fn recovery_failed_audited_for_known_user_only() {
    let installation = Installation::create();
    let app = installation.boot();

    assert_invalid_credentials(recover(&app, OWNER_USERNAME, WRONG_CODE, NEW_PASSWORD));
    assert_invalid_credentials(recover(&app, "fantasma", WRONG_CODE, NEW_PASSWORD));

    let failed = audit_actions(&app, "recovery_failed");
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].actor_user_id, None);
    assert_eq!(failed[0].entity.as_str(), "user");
    assert_eq!(failed[0].entity_id, Some(owner_id(&app)));
}

#[test]
fn weak_new_password_rejected_before_spending_attempt() {
    let installation = Installation::create();
    let app = installation.boot();
    let verifications_before = verifications(&app);
    let hashes_before = hashes_computed(&app);

    for _ in 0..FAILURES_TO_LOCK_OUT + 1 {
        let weak = recover(&app, OWNER_USERNAME, &installation.recovery_code, "corta");
        assert_eq!(weak.unwrap_err().code, AppErrorCode::Validation);
    }

    assert_eq!(verifications(&app), verifications_before);
    assert_eq!(hashes_computed(&app), hashes_before);
    assert!(audit_actions(&app, "recovery_failed").is_empty());
    assert!(recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD
    )
    .is_ok());
}

#[test]
fn recovery_ends_active_session_of_that_user() {
    let installation = Installation::create();
    let app = installation.boot();
    sign_in(&app, OWNER_USERNAME, OWNER_PASSWORD).unwrap();

    recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD,
    )
    .unwrap();

    assert!(current_session(app.state(), app.state()).unwrap().is_none());
}

#[test]
fn recovery_keeps_session_of_another_user() {
    let installation = Installation::create();
    let app = installation.boot();
    sign_in(&app, RECEPTION_USERNAME, RECEPTION_PASSWORD).unwrap();

    recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD,
    )
    .unwrap();

    let view = current_session(app.state(), app.state()).unwrap().unwrap();
    assert_eq!(view.user.unwrap().username, RECEPTION_USERNAME);
}

#[test]
fn concurrent_recovery_same_code_only_one_wins() {
    let installation = Installation::create();
    let key = DbKey::from_hex(installation.key.as_hex().to_string()).unwrap();
    let database = Database::new(open_encrypted(&installation.database_path(), &key).unwrap());
    let passwords = Arc::new(PasswordPolicy::new().unwrap());
    let session = SessionState::default();
    let throttle = LoginThrottle::default();

    let outcomes: Vec<Result<RecoveryResult, AuthError>> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..RACING_CALLERS)
            .map(|index| {
                let (database, session, throttle) = (&database, &session, &throttle);
                let passwords = Arc::clone(&passwords);
                let request = RecoveryRequest {
                    username: OWNER_USERNAME.to_string(),
                    recovery_code: installation.recovery_code.clone(),
                    new_password: format!("clave-concurrente-{index}"),
                };
                scope.spawn(move || {
                    tauri::async_runtime::block_on(recover_with(
                        database, passwords, session, throttle, request,
                    ))
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });

    assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
    assert!(outcomes
        .iter()
        .filter_map(|outcome| outcome.as_ref().err())
        .all(|failure| matches!(failure, AuthError::InvalidCredentials)));
    let used = database.with_conn(list_all).unwrap();
    let used = used
        .iter()
        .filter(|entry| entry.action.as_str() == "recovery_used");
    assert_eq!(used.count(), 1);
}

#[test]
fn new_password_logs_in_and_old_password_does_not() {
    let installation = Installation::create();
    let app = installation.boot();
    recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD,
    )
    .unwrap();

    assert_invalid_credentials(sign_in(&app, OWNER_USERNAME, OWNER_PASSWORD));
    let user = sign_in(&app, OWNER_USERNAME, NEW_PASSWORD).unwrap();

    assert_eq!(user.username, OWNER_USERNAME);
}

#[test]
fn recovery_does_not_start_a_session() {
    let installation = Installation::create();
    let app = installation.boot();

    recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD,
    )
    .unwrap();

    assert!(current_session(app.state(), app.state()).unwrap().is_none());
}

#[test]
fn recovery_clears_persisted_failures_of_that_user() {
    let installation = Installation::create();
    let app = installation.boot();
    fail_recovering(&app, 2);

    recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD,
    )
    .unwrap();

    let rows: i64 = database_of(&app)
        .with_conn(|conn| {
            Ok(conn.query_row("SELECT count(*) FROM login_throttle", [], |row| row.get(0))?)
        })
        .unwrap();
    assert_eq!(rows, 0);
}

#[test]
fn audit_failure_rolls_back_rotation() {
    let installation = Installation::create();
    let app = installation.boot();
    let before = stored_hashes(&app);
    database_of(&app)
        .with_conn(|conn| {
            conn.execute_batch(FAIL_AUDIT_INSERTS)?;
            Ok(())
        })
        .unwrap();

    let outcome = recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD,
    );

    assert_eq!(outcome.unwrap_err().code, AppErrorCode::Internal);
    assert_eq!(stored_hashes(&app), before);
    database_of(&app)
        .with_conn(|conn| {
            conn.execute_batch("DROP TRIGGER fail_audit")?;
            Ok(())
        })
        .unwrap();
    assert!(sign_in(&app, OWNER_USERNAME, OWNER_PASSWORD).is_ok());
}

#[test]
fn audit_failure_on_a_wrong_code_still_spends_the_attempt() {
    let installation = Installation::create();
    let app = installation.boot();
    database_of(&app)
        .with_conn(|conn| {
            conn.execute_batch(FAIL_AUDIT_INSERTS)?;
            Ok(())
        })
        .unwrap();
    for _ in 0..FAILURES_TO_LOCK_OUT {
        let failure = recover(&app, OWNER_USERNAME, WRONG_CODE, NEW_PASSWORD).unwrap_err();
        assert_eq!(failure.code, AppErrorCode::Internal);
    }
    database_of(&app)
        .with_conn(|conn| {
            conn.execute_batch("DROP TRIGGER fail_audit")?;
            Ok(())
        })
        .unwrap();

    let sixth = recover(
        &app,
        OWNER_USERNAME,
        &installation.recovery_code,
        NEW_PASSWORD,
    );

    assert_invalid_credentials(sixth);
    assert!(audit_actions(&app, "recovery_used").is_empty());
}

#[test]
fn rotate_credentials_swaps_only_when_expected_hash_matches() {
    let installation = Installation::create();
    let app = installation.boot();
    let (_, current) = stored_hashes(&app);
    let current = current.unwrap();
    let id = owner_id(&app);

    let stale = database_of(&app)
        .with_conn(|conn| rotate_credentials(conn, id, "otro", "p1", "r1"))
        .unwrap();
    let fresh = database_of(&app)
        .with_conn(|conn| rotate_credentials(conn, id, &current, "p2", "r2"))
        .unwrap();
    let replay = database_of(&app)
        .with_conn(|conn| rotate_credentials(conn, id, &current, "p3", "r3"))
        .unwrap();

    assert!(!stale);
    assert!(fresh);
    assert!(!replay);
    assert_eq!(
        stored_hashes(&app),
        ("p2".to_string(), Some("r2".to_string()))
    );
}

#[test]
fn recovery_request_and_result_hide_secrets() {
    let result = RecoveryResult {
        recovery_code: "ABCD-EFGH-IJKL-MNOP-QRST".to_string(),
    };

    let rendered = format!("{result:?}");

    assert!(!rendered.contains("ABCD"));
    assert!(rendered.contains("***"));
}
