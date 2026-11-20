use rusqlite::Connection;
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

use super::model::{
    NewRole, NewUserInput, PasswordReset, RolePermissionsUpdate, RoleSummary, UserSummary,
    UserUpdate, UsersError,
};
use super::repository::{self, NewUserRow};
use crate::features::audit::{self, AuditAction, AuditEntity, Diff, NewAuditEntry};
use crate::features::auth::model::PermissionKey;
use crate::features::auth::password::validate_new_password;
use crate::features::auth::repository::{clear_persisted_failures, OWNER_ROLE_ID};
use crate::features::auth::service::normalized_username;

const USERNAME_FIELD: &str = "username";
const ROLE_ID_FIELD: &str = "roleId";
const USER_ID_FIELD: &str = "userId";
const ACTIVE_FIELD: &str = "active";
const NAME_FIELD: &str = "name";
const PERMISSIONS_FIELD: &str = "permissions";
const MAX_ROLE_NAME_CHARS: usize = 64;

pub struct ValidatedNewUser {
    pub username: String,
    pub password: Zeroizing<String>,
    pub role_id: i64,
}

fn valid_username(raw: &str) -> Result<String, UsersError> {
    normalized_username(raw).ok_or(UsersError::Validation {
        field: USERNAME_FIELD,
    })
}

fn valid_role_name(raw: &str) -> Result<String, UsersError> {
    let name: String = raw.trim().nfc().collect();
    if (1..=MAX_ROLE_NAME_CHARS).contains(&name.chars().count()) {
        Ok(name)
    } else {
        Err(UsersError::Validation { field: NAME_FIELD })
    }
}

pub fn validated_new_user(input: &mut NewUserInput) -> Result<ValidatedNewUser, UsersError> {
    let username = valid_username(&input.username)?;
    let password = input.take_password();
    validate_new_password(&password)?;
    Ok(ValidatedNewUser {
        username,
        password,
        role_id: input.role_id,
    })
}

pub fn validated_reset(reset: &mut PasswordReset) -> Result<(i64, Zeroizing<String>), UsersError> {
    let password = reset.take_password();
    validate_new_password(&password)?;
    Ok((reset.user_id, password))
}

fn require_user(conn: &Connection, user_id: i64) -> Result<UserSummary, UsersError> {
    repository::find_user(conn, user_id)?.ok_or(UsersError::Validation {
        field: USER_ID_FIELD,
    })
}

fn require_role(conn: &Connection, role_id: i64) -> Result<RoleSummary, UsersError> {
    repository::find_role(conn, role_id)?.ok_or(UsersError::Validation {
        field: ROLE_ID_FIELD,
    })
}

fn ensure_role_exists(conn: &Connection, role_id: i64) -> Result<(), UsersError> {
    if repository::role_exists(conn, role_id)? {
        Ok(())
    } else {
        Err(UsersError::Validation {
            field: ROLE_ID_FIELD,
        })
    }
}

fn ensure_username_free(
    conn: &Connection,
    username: &str,
    except_user_id: Option<i64>,
) -> Result<(), UsersError> {
    if repository::username_taken(conn, username, except_user_id)? {
        Err(UsersError::Validation {
            field: USERNAME_FIELD,
        })
    } else {
        Ok(())
    }
}

fn ensure_admin_remains(conn: &Connection, field: &'static str) -> Result<(), UsersError> {
    if repository::count_active_admins(conn)? >= 1 {
        Ok(())
    } else {
        Err(UsersError::LastAdmin { field })
    }
}

fn record(
    conn: &Connection,
    actor_id: i64,
    action: AuditAction,
    entity: AuditEntity,
    entity_id: i64,
    diff: Option<Diff>,
) -> Result<(), UsersError> {
    let entry = NewAuditEntry {
        actor_user_id: Some(actor_id),
        action,
        entity,
        entity_id: Some(entity_id),
        diff,
    };
    audit::record(conn, &entry)?;
    Ok(())
}

fn user_snapshot(user: &UserSummary) -> Value {
    json!({ "username": user.username, "roleId": user.role_id, "active": user.active })
}

fn permissions_snapshot(permissions: &[PermissionKey]) -> Vec<&'static str> {
    permissions.iter().map(|key| key.as_str()).collect()
}

fn canonical_permissions(requested: &[PermissionKey]) -> Vec<PermissionKey> {
    PermissionKey::ALL
        .into_iter()
        .filter(|key| requested.contains(key))
        .collect()
}

pub fn create_user(
    conn: &Connection,
    actor_id: i64,
    row: &NewUserRow,
) -> Result<UserSummary, UsersError> {
    ensure_username_free(conn, &row.username, None)?;
    ensure_role_exists(conn, row.role_id)?;
    let id = repository::insert_user(conn, row, Some(actor_id))?;
    let created = require_user(conn, id)?;
    let diff = Diff::created(&user_snapshot(&created));
    record(
        conn,
        actor_id,
        AuditAction::UserCreated,
        AuditEntity::User,
        id,
        diff,
    )?;
    Ok(created)
}

fn resolved_update(conn: &Connection, update: &UserUpdate) -> Result<UserUpdate, UsersError> {
    let username = update.username.as_deref().map(valid_username).transpose()?;
    if let Some(username) = &username {
        ensure_username_free(conn, username, Some(update.id))?;
    }
    if let Some(role_id) = update.role_id {
        ensure_role_exists(conn, role_id)?;
    }
    Ok(UserUpdate {
        username,
        ..update.clone()
    })
}

fn changes_nothing(before: &UserSummary, change: &UserUpdate) -> bool {
    change
        .username
        .as_ref()
        .is_none_or(|name| *name == before.username)
        && change
            .role_id
            .is_none_or(|role_id| role_id == before.role_id)
        && change.active.is_none_or(|active| active == before.active)
}

fn last_admin_field(change: &UserUpdate) -> &'static str {
    if change.active == Some(false) {
        ACTIVE_FIELD
    } else {
        ROLE_ID_FIELD
    }
}

pub fn update_user(
    conn: &Connection,
    actor_id: i64,
    update: &UserUpdate,
) -> Result<UserSummary, UsersError> {
    let before = require_user(conn, update.id)?;
    let change = resolved_update(conn, update)?;
    if changes_nothing(&before, &change) {
        return Ok(before);
    }
    repository::apply_user_update(conn, &change, actor_id)?;
    ensure_admin_remains(conn, last_admin_field(&change))?;
    let after = require_user(conn, update.id)?;
    let diff = Diff::between(&user_snapshot(&before), &user_snapshot(&after));
    record(
        conn,
        actor_id,
        AuditAction::UserUpdated,
        AuditEntity::User,
        after.id,
        diff,
    )?;
    Ok(after)
}

pub fn reset_password(
    conn: &Connection,
    actor_id: i64,
    user_id: i64,
    password_hash: &str,
) -> Result<(), UsersError> {
    require_user(conn, user_id)?;
    repository::set_password_hash(conn, user_id, password_hash, actor_id)?;
    clear_persisted_failures(conn, user_id)?;
    record(
        conn,
        actor_id,
        AuditAction::PasswordReset,
        AuditEntity::User,
        user_id,
        None,
    )
}

pub fn create_role(
    conn: &Connection,
    actor_id: i64,
    new_role: &NewRole,
) -> Result<RoleSummary, UsersError> {
    let name = valid_role_name(&new_role.name)?;
    if repository::role_name_taken(conn, &name)? {
        return Err(UsersError::Validation { field: NAME_FIELD });
    }
    let permissions = canonical_permissions(&new_role.permissions);
    let id = repository::insert_role(conn, &name)?;
    repository::replace_role_permissions(conn, id, &permissions)?;
    let created = require_role(conn, id)?;
    let snapshot =
        json!({ "name": created.name, "permissions": permissions_snapshot(&permissions) });
    let diff = Diff::created(&snapshot);
    record(
        conn,
        actor_id,
        AuditAction::RoleCreated,
        AuditEntity::Role,
        id,
        diff,
    )?;
    Ok(created)
}

pub fn set_role_permissions(
    conn: &Connection,
    actor_id: i64,
    update: &RolePermissionsUpdate,
) -> Result<RoleSummary, UsersError> {
    let before = require_role(conn, update.role_id)?;
    let permissions = canonical_permissions(&update.permissions);
    let strips_owner =
        update.role_id == OWNER_ROLE_ID && !permissions.contains(&PermissionKey::UsersManage);
    if strips_owner {
        return Err(UsersError::Validation {
            field: PERMISSIONS_FIELD,
        });
    }
    if permissions == before.permissions {
        return Ok(before);
    }
    repository::replace_role_permissions(conn, update.role_id, &permissions)?;
    ensure_admin_remains(conn, PERMISSIONS_FIELD)?;
    let after = require_role(conn, update.role_id)?;
    let diff = Diff::between(
        &json!({ PERMISSIONS_FIELD: permissions_snapshot(&before.permissions) }),
        &json!({ PERMISSIONS_FIELD: permissions_snapshot(&after.permissions) }),
    );
    record(
        conn,
        actor_id,
        AuditAction::RolePermissionsChanged,
        AuditEntity::Role,
        after.id,
        diff,
    )?;
    Ok(after)
}

#[cfg(test)]
#[path = "service_test.rs"]
mod tests;

#[cfg(test)]
#[path = "service_roles_test.rs"]
mod role_tests;
