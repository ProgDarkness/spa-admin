use rusqlite::Connection;

use super::DbError;

pub(super) type Migration = (u32, &'static str);

const MIGRATIONS: [Migration; 5] = [
    (1, include_str!("migrations/0001_auth.sql")),
    (2, include_str!("migrations/0002_username_nocase.sql")),
    (3, include_str!("migrations/0003_audit_log.sql")),
    (4, include_str!("migrations/0004_login_throttle.sql")),
    (5, include_str!("migrations/0005_audit_business.sql")),
];

pub fn migrate(conn: &mut Connection) -> Result<(), DbError> {
    apply(conn, &MIGRATIONS)
}

pub fn supported_version() -> u32 {
    MIGRATIONS.last().map_or(0, |(version, _)| *version)
}

pub(super) fn apply(conn: &mut Connection, migrations: &[Migration]) -> Result<(), DbError> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let supported = migrations.last().map_or(0, |(version, _)| *version);
    if current < 0 || current > i64::from(supported) {
        return Err(DbError::SchemaNewerThanApp {
            found: current,
            supported,
        });
    }
    migrations
        .iter()
        .filter(|(version, _)| i64::from(*version) > current)
        .try_for_each(|(version, sql)| apply_one(conn, *version, sql))
}

fn apply_one(conn: &mut Connection, version: u32, sql: &str) -> Result<(), DbError> {
    let transaction = conn.transaction()?;
    transaction.execute_batch(sql)?;
    transaction.pragma_update(None, "user_version", version)?;
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
#[path = "migrations_test.rs"]
mod tests;
