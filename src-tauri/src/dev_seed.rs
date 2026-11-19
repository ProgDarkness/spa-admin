use rusqlite::Connection;
use zeroize::Zeroizing;

use crate::features::auth::password::PasswordPolicy;
use crate::features::auth::repository::{count_users, insert_user, NewUser};
use crate::setup::SetupError;

pub const SEED_PASSWORD_VAR: &str = "SPA_DEV_SEED_PASSWORD";

const MIN_SEED_PASSWORD_CHARS: usize = 12;
const OWNER_ROLE_ID: i64 = 1;
const RECEPTION_ROLE_ID: i64 = 2;
const READ_ONLY_ROLE_ID: i64 = 3;

const SEED_USERS: [(&str, i64); 3] = [
    ("propietaria", OWNER_ROLE_ID),
    ("recepcion", RECEPTION_ROLE_ID),
    ("lectura", READ_ONLY_ROLE_ID),
];

fn configured_password(read_env: &dyn Fn(&str) -> Option<String>) -> Option<Zeroizing<String>> {
    read_env(SEED_PASSWORD_VAR)
        .filter(|password| !password.is_empty())
        .map(Zeroizing::new)
}

pub fn seed_if_empty(
    conn: &Connection,
    policy: &PasswordPolicy,
    read_env: &dyn Fn(&str) -> Option<String>,
) -> Result<(), SetupError> {
    let Some(password) = configured_password(read_env) else {
        return Ok(());
    };
    if password.chars().count() < MIN_SEED_PASSWORD_CHARS {
        return Err(SetupError::SeedPasswordTooShort);
    }
    if count_users(conn)? > 0 {
        return Ok(());
    }
    let password_hash = policy.hash(&password)?;
    let transaction = conn
        .unchecked_transaction()
        .map_err(crate::db::DbError::from)?;
    for (username, role_id) in SEED_USERS {
        let user = NewUser {
            username: username.to_string(),
            password_hash: password_hash.clone(),
            role_id,
        };
        insert_user(&transaction, &user)?;
    }
    transaction.commit().map_err(crate::db::DbError::from)?;
    Ok(())
}

#[cfg(test)]
#[path = "dev_seed_test.rs"]
mod tests;
