use rusqlite::Connection;

use crate::db::DbError;
use crate::dev_seed::configured_password;
use crate::dev_seed_catalog::seeded_owner_id;
use crate::features::clients::model::{ClientDeletion, ClientError, ClientInput};
use crate::features::clients::service::{create_client, set_client_deleted};
use crate::setup::SetupError;

impl From<ClientError> for SetupError {
    fn from(error: ClientError) -> Self {
        match error {
            ClientError::Auth(inner) => SetupError::Auth(inner),
            ClientError::Db(inner) => SetupError::Db(inner),
            ClientError::Validation { .. }
            | ClientError::NotFound
            | ClientError::NationalIdTaken
            | ClientError::DeletedHolder { .. } => SetupError::SeedCatalogRejected,
        }
    }
}

struct SeedClient {
    first_name: &'static str,
    last_name: &'static str,
    national_id: &'static str,
    phone: &'static str,
    deleted: bool,
}

const SEED_CLIENTS: [SeedClient; 9] = [
    SeedClient {
        first_name: "María",
        last_name: "González",
        national_id: "V-12345678",
        phone: "0414-1234567",
        deleted: false,
    },
    SeedClient {
        first_name: "José",
        last_name: "Rodríguez",
        national_id: "V-14567890",
        phone: "0424-2345678",
        deleted: false,
    },
    SeedClient {
        first_name: "Ana",
        last_name: "Pérez",
        national_id: "V-16789012",
        phone: "0412-3456789",
        deleted: false,
    },
    SeedClient {
        first_name: "Luis",
        last_name: "Martínez",
        national_id: "V-18901234",
        phone: "0416-4567890",
        deleted: false,
    },
    SeedClient {
        first_name: "Carla",
        last_name: "Hernández",
        national_id: "V-20123456",
        phone: "0426-5678901",
        deleted: false,
    },
    SeedClient {
        first_name: "Pedro",
        last_name: "Díaz",
        national_id: "V-22345678",
        phone: "0414-6789012",
        deleted: false,
    },
    SeedClient {
        first_name: "Gabriela",
        last_name: "Torres",
        national_id: "E-81234567",
        phone: "0424-7890123",
        deleted: false,
    },
    SeedClient {
        first_name: "Sofía",
        last_name: "Ramírez",
        national_id: "V-24567890",
        phone: "0412-8901234",
        deleted: false,
    },
    SeedClient {
        first_name: "Carlos",
        last_name: "Mendoza",
        national_id: "V-26789012",
        phone: "0416-9012345",
        deleted: true,
    },
];

fn has_no_clients(conn: &Connection) -> Result<bool, DbError> {
    let rows: i64 = conn.query_row("SELECT COUNT(*) FROM clients", [], |row| row.get(0))?;
    Ok(rows == 0)
}

fn seed_clients(conn: &Connection, owner_id: i64) -> Result<(), SetupError> {
    for seed in &SEED_CLIENTS {
        let input = ClientInput {
            first_name: seed.first_name.to_string(),
            last_name: seed.last_name.to_string(),
            national_id: seed.national_id.to_string(),
            phone: seed.phone.to_string(),
        };
        let created = create_client(conn, owner_id, &input)?;
        if seed.deleted {
            let deletion = ClientDeletion {
                id: created.id,
                deleted: true,
            };
            set_client_deleted(conn, owner_id, &deletion)?;
        }
    }
    Ok(())
}

pub fn seed_clients_if_empty(
    conn: &Connection,
    read_env: &dyn Fn(&str) -> Option<String>,
) -> Result<(), SetupError> {
    if configured_password(read_env).is_none() {
        return Ok(());
    }
    let Some(owner_id) = seeded_owner_id(conn)? else {
        return Ok(());
    };
    let transaction = conn.unchecked_transaction().map_err(DbError::from)?;
    if has_no_clients(&transaction)? {
        seed_clients(&transaction, owner_id)?;
    }
    transaction.commit().map_err(DbError::from)?;
    Ok(())
}

#[cfg(test)]
#[path = "dev_seed_clients_test.rs"]
mod tests;
