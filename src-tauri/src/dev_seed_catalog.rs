use rusqlite::{Connection, OptionalExtension};

use crate::db::DbError;
use crate::dev_seed::{configured_password, OWNER_ROLE_ID, SEED_OWNER_USERNAME};
use crate::features::catalog::model::{CatalogError, ServiceActivation, ServiceInput};
use crate::features::catalog::service::{create_service, set_service_active};
use crate::features::rates::model::RatesError;
use crate::features::rates::service::upsert_rate;
use crate::setup::SetupError;

impl From<CatalogError> for SetupError {
    fn from(error: CatalogError) -> Self {
        match error {
            CatalogError::Auth(inner) => SetupError::Auth(inner),
            CatalogError::Db(inner) => SetupError::Db(inner),
            CatalogError::Validation { .. } => SetupError::SeedCatalogRejected,
        }
    }
}

impl From<RatesError> for SetupError {
    fn from(error: RatesError) -> Self {
        match error {
            RatesError::Auth(inner) => SetupError::Auth(inner),
            RatesError::Db(inner) => SetupError::Db(inner),
            RatesError::Validation { .. } => SetupError::SeedCatalogRejected,
        }
    }
}

const SEED_RATE_E4: i64 = 365_000;
const RATE_STEP_E4: i64 = 500;
const RATE_HISTORY_DAYS: i64 = 7;

struct SeedService {
    name: &'static str,
    price_cents: i64,
    duration_min: i64,
    active: bool,
}

const SEED_SERVICES: [SeedService; 8] = [
    SeedService {
        name: "Limpieza facial (ejemplo)",
        price_cents: 3_500,
        duration_min: 60,
        active: true,
    },
    SeedService {
        name: "Masaje relajante (ejemplo)",
        price_cents: 4_000,
        duration_min: 60,
        active: true,
    },
    SeedService {
        name: "Diseño de cejas (ejemplo)",
        price_cents: 1_000,
        duration_min: 30,
        active: true,
    },
    SeedService {
        name: "Manicure clásico (ejemplo)",
        price_cents: 1_500,
        duration_min: 45,
        active: true,
    },
    SeedService {
        name: "Pedicure spa (ejemplo)",
        price_cents: 2_000,
        duration_min: 60,
        active: true,
    },
    SeedService {
        name: "Tratamiento corporal (ejemplo)",
        price_cents: 6_000,
        duration_min: 90,
        active: true,
    },
    SeedService {
        name: "Paquete 4 limpiezas faciales (ejemplo)",
        price_cents: 12_000,
        duration_min: 60,
        active: true,
    },
    SeedService {
        name: "Peeling químico (ejemplo)",
        price_cents: 5_000,
        duration_min: 45,
        active: false,
    },
];

#[derive(Clone, Copy)]
enum NamedTable {
    Services,
    ExchangeRates,
}

impl NamedTable {
    const fn count_query(self) -> &'static str {
        match self {
            NamedTable::Services => "SELECT COUNT(*) FROM services",
            NamedTable::ExchangeRates => "SELECT COUNT(*) FROM exchange_rates",
        }
    }
}

fn is_empty(conn: &Connection, table: NamedTable) -> Result<bool, DbError> {
    let rows: i64 = conn.query_row(table.count_query(), [], |row| row.get(0))?;
    Ok(rows == 0)
}

fn seeded_owner_id(conn: &Connection) -> Result<Option<i64>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id FROM users WHERE username = ?1 AND role_id = ?2 AND active = 1",
            rusqlite::params![SEED_OWNER_USERNAME, OWNER_ROLE_ID],
            |row| row.get(0),
        )
        .optional()?)
}

fn days_before(conn: &Connection, today: &str, days: i64) -> Result<String, DbError> {
    Ok(conn.query_row(
        "SELECT date(?1, '-' || ?2 || ' days')",
        rusqlite::params![today, days],
        |row| row.get(0),
    )?)
}

fn seed_services(conn: &Connection, owner_id: i64) -> Result<(), SetupError> {
    for seed in &SEED_SERVICES {
        let input = ServiceInput {
            name: seed.name.to_string(),
            price_cents: seed.price_cents,
            duration_min: seed.duration_min,
        };
        let created = create_service(conn, owner_id, &input)?;
        if !seed.active {
            let deactivation = ServiceActivation {
                id: created.id,
                active: false,
            };
            set_service_active(conn, owner_id, &deactivation)?;
        }
    }
    Ok(())
}

fn seed_rates(conn: &Connection, owner_id: i64, today: &str) -> Result<(), SetupError> {
    for days_ago in 0..RATE_HISTORY_DAYS {
        let date = days_before(conn, today, days_ago)?;
        upsert_rate(
            conn,
            owner_id,
            &date,
            SEED_RATE_E4 - days_ago * RATE_STEP_E4,
        )?;
    }
    Ok(())
}

pub fn local_today(conn: &Connection) -> Result<String, SetupError> {
    Ok(conn
        .query_row("SELECT date('now', 'localtime')", [], |row| row.get(0))
        .map_err(DbError::from)?)
}

pub fn seed_catalog_dated(conn: &Connection, today: &str) -> Result<(), SetupError> {
    let Some(owner_id) = seeded_owner_id(conn)? else {
        return Ok(());
    };
    let transaction = conn.unchecked_transaction().map_err(DbError::from)?;
    let both_empty = is_empty(&transaction, NamedTable::Services)?
        && is_empty(&transaction, NamedTable::ExchangeRates)?;
    if both_empty {
        seed_services(&transaction, owner_id)?;
        seed_rates(&transaction, owner_id, today)?;
    }
    transaction.commit().map_err(DbError::from)?;
    Ok(())
}

pub fn seed_catalog_if_empty(
    conn: &Connection,
    read_env: &dyn Fn(&str) -> Option<String>,
) -> Result<(), SetupError> {
    if configured_password(read_env).is_none() {
        return Ok(());
    }
    let today = local_today(conn)?;
    seed_catalog_dated(conn, &today)
}

#[cfg(test)]
#[path = "dev_seed_catalog_test.rs"]
mod tests;
