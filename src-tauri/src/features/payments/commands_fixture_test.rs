use tauri::test::{mock_app, MockRuntime};
use tauri::{App, Manager};

use crate::db::{migrate, Database};
use crate::features::audit::repository::list_all;
use crate::features::auth::model::SessionUser;
use crate::features::auth::repository::permissions_of_role_for_user;
use crate::features::auth::service::{Beat, SessionState};
use crate::features::users::repository::{insert_user, NewUserRow};

pub(crate) const OWNER_ROLE: i64 = 1;
pub(crate) const APPOINTMENT: i64 = 1;
pub(crate) const FAIL_AUDIT_INSERTS: &str = "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log \
     BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END";

pub(crate) struct AppFixture {
    pub(crate) app: App<MockRuntime>,
}

const EXTRA_ROLES: [(&str, &str, &[&str]); 6] = [
    ("pagoescritor", "Escritor pagos", &["payments.write"]),
    ("sinpermisos", "Sin permisos", &[]),
    (
        "citasclientes",
        "Citas y clientes",
        &["clients.read", "appointments.read"],
    ),
    (
        "pagoscitas",
        "Pagos y citas",
        &["payments.read", "appointments.read"],
    ),
    (
        "pagosclientes",
        "Pagos y clientes",
        &["payments.read", "clients.read"],
    ),
    ("recursos", "Recursos", &["resources.manage"]),
];

fn add_role(conn: &rusqlite::Connection, name: &str, permissions: &[&str]) -> i64 {
    conn.execute("INSERT INTO roles (name) VALUES (?1)", [name])
        .unwrap();
    let role_id = conn.last_insert_rowid();
    for permission in permissions {
        conn.execute(
            "INSERT INTO role_permissions (role_id, permission_key) VALUES (?1, ?2)",
            rusqlite::params![role_id, permission],
        )
        .unwrap();
    }
    role_id
}

fn add_user(conn: &rusqlite::Connection, username: &str, role_id: i64) {
    let row = NewUserRow {
        username: username.to_string(),
        password_hash: "hash-opaco".to_string(),
        role_id,
    };
    insert_user(conn, &row, None).unwrap();
}

pub(crate) fn app_fixture() -> AppFixture {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    add_user(&conn, "propietaria", OWNER_ROLE);
    add_user(&conn, "recepcion", 2);
    add_user(&conn, "lectura", 3);
    for (username, role_name, permissions) in EXTRA_ROLES {
        let role_id = add_role(&conn, role_name, permissions);
        add_user(&conn, username, role_id);
    }
    conn.execute_batch(
        "INSERT INTO clients (id, first_name, last_name, national_id, phone, search_key) VALUES
            (1, 'Ana', 'Perez', 'V-12345678', '0414', 'k');
         INSERT INTO services (id, name, name_key, price_cents, duration_min) VALUES
            (1, 'Facial', 'facial', 3500, 60);
         INSERT INTO appointments (id, client_id, service_id, resource_id, starts_at, ends_at, \
            status, price_cents_snapshot, duration_min_snapshot) VALUES
            (1, 1, 1, 1, '2026-11-12T10:00', '2026-11-12T11:00', 'completed', 3500, 60);",
    )
    .unwrap();
    let app = mock_app();
    app.manage(Database::new(conn));
    app.manage(SessionState::default());
    AppFixture { app }
}

pub(crate) fn sign_in_as(fixture: &AppFixture, username: &str) {
    let db: tauri::State<'_, Database> = fixture.app.state();
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    let user = db
        .with_conn(|conn| {
            let (id, role_name): (i64, String) = conn.query_row(
                "SELECT u.id, r.name FROM users u JOIN roles r ON r.id = u.role_id \
                 WHERE u.username = ?1",
                [username],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            Ok(SessionUser {
                id,
                username: username.to_string(),
                role_name,
                permissions: permissions_of_role_for_user(conn, id)?,
            })
        })
        .unwrap();
    session.start(user, Beat::now()).unwrap();
}

pub(crate) fn database(fixture: &AppFixture) -> tauri::State<'_, Database> {
    fixture.app.state()
}

pub(crate) fn lock_session(fixture: &AppFixture) {
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    session.force_lock().unwrap();
}

pub(crate) fn end_session(fixture: &AppFixture) {
    let session: tauri::State<'_, SessionState> = fixture.app.state();
    session.end().unwrap();
}

pub(crate) fn audit_actions(fixture: &AppFixture) -> Vec<String> {
    database(fixture)
        .with_conn(list_all)
        .unwrap()
        .into_iter()
        .map(|entry| entry.action.as_str().to_string())
        .collect()
}

pub(crate) fn break_audit(fixture: &AppFixture) {
    database(fixture)
        .with_conn(|conn| {
            conn.execute_batch(FAIL_AUDIT_INSERTS)?;
            Ok(())
        })
        .unwrap();
}

pub(crate) fn revoke_owner(fixture: &AppFixture, permission: &str) {
    database(fixture)
        .with_conn(|conn| {
            conn.execute(
                "DELETE FROM role_permissions WHERE role_id = ?1 AND permission_key = ?2",
                rusqlite::params![OWNER_ROLE, permission],
            )?;
            Ok(())
        })
        .unwrap();
}
