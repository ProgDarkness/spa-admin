use rusqlite::Connection;

use super::DbError;

pub(super) type Migration = (u32, &'static str);

const MIGRATIONS: [Migration; 12] = [
    (1, include_str!("migrations/0001_auth.sql")),
    (2, include_str!("migrations/0002_username_nocase.sql")),
    (3, include_str!("migrations/0003_audit_log.sql")),
    (4, include_str!("migrations/0004_login_throttle.sql")),
    (5, include_str!("migrations/0005_audit_business.sql")),
    (6, include_str!("migrations/0006_services.sql")),
    (7, include_str!("migrations/0007_resources.sql")),
    (8, include_str!("migrations/0008_payment_methods.sql")),
    (9, include_str!("migrations/0009_exchange_rates.sql")),
    (10, include_str!("migrations/0010_clients.sql")),
    (11, include_str!("migrations/0011_appointments.sql")),
    (12, include_str!("migrations/0012_appointment_payments.sql")),
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

#[cfg(test)]
#[path = "migrations_audit_test.rs"]
mod audit_tests;

#[cfg(test)]
#[path = "migrations_services_test.rs"]
mod services_tests;

#[cfg(test)]
#[path = "migrations_resources_test.rs"]
mod resources_tests;

#[cfg(test)]
#[path = "migrations_payment_methods_test.rs"]
mod payment_methods_tests;

#[cfg(test)]
#[path = "migrations_exchange_rates_test.rs"]
mod exchange_rates_tests;

#[cfg(test)]
#[path = "migrations_clients_test.rs"]
mod clients_tests;

#[cfg(test)]
#[path = "migrations_appointments_test.rs"]
mod appointments_tests;

#[cfg(test)]
#[path = "migrations_payments_test.rs"]
mod payments_tests;
