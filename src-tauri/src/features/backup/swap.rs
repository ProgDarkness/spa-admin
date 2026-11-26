use std::fs;
use std::io;
use std::mem;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::json;

use super::errors::BackupError;
use super::leftovers::{discard_with_sidecars, path_for, report_cleanup, stamp_now, Leftover};
use super::model::{BackupSource, RestoreResult};
use super::restore::StagedRestore;
use super::service::authorize;
use crate::db::migrations::supported_version;
use crate::db::snapshot::all_snapshots;
use crate::db::{open_encrypted, Database, DbError, DbKey};
use crate::features::audit::{self, AuditAction, AuditEntity, Diff, NewAuditEntry};
use crate::features::auth::model::SessionUser;
use crate::features::auth::owner_setup::needs_owner;
use crate::features::auth::service::SessionState;
use crate::keystore::KeyStoreError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SwapStep {
    SavePendingKey,
    CloseLiveConnection,
    MoveCurrentAside,
    InstallRestored,
    VerifyAndAudit,
    PromoteKey,
    Rollback,
    RollbackRestoreKey,
    RollbackRestoreDatabase,
    RollbackReopenLive,
    RollbackDropPendingKey,
}

type Inject<'a> = &'a dyn Fn(SwapStep) -> io::Result<()>;

#[derive(Default)]
struct Progress {
    pending_written: bool,
    live_closed: bool,
    moved_aside: bool,
    promotion_attempted: bool,
}

#[derive(Default)]
struct RollbackTally {
    first_failure: Option<BackupError>,
}

impl RollbackTally {
    fn attempt<T>(&mut self, step: Result<T, BackupError>) -> Option<T> {
        match step {
            Ok(value) => Some(value),
            Err(failure) => {
                match &self.first_failure {
                    None => self.first_failure = Some(failure),
                    Some(_) => eprintln!("backup: further rollback failure: {failure:?}"),
                }
                None
            }
        }
    }

    fn finish(self) -> Result<(), BackupError> {
        self.first_failure.map_or(Ok(()), Err)
    }
}

struct Swap<'a> {
    source: &'a BackupSource,
    staged: &'a StagedRestore,
    previous_key: DbKey,
    previous_path: PathBuf,
    inject: Inject<'a>,
}

pub(crate) fn swap_in(
    db: &Database,
    session: &SessionState,
    source: &BackupSource,
    staged: StagedRestore,
    inject: Inject<'_>,
) -> Result<RestoreResult, BackupError> {
    let outcome = db.with_conn_mut(|live| run(live, session, source, &staged, inject));
    if outcome.is_err() {
        report_cleanup(
            "staged restore",
            discard_with_sidecars(&staged.restoring_path),
        );
    }
    outcome
}

fn run(
    live: &mut Connection,
    session: &SessionState,
    source: &BackupSource,
    staged: &StagedRestore,
    inject: Inject<'_>,
) -> Result<RestoreResult, BackupError> {
    let actor = authorize_restore(live, session)?;
    staged.require_unchanged()?;
    let swap = Swap {
        source,
        staged,
        previous_key: source
            .key_store
            .read()?
            .ok_or(KeyStoreError::MissingForExistingDb)?,
        previous_path: path_for(&source.database_path, &stamp_now()?, Leftover::Prev),
        inject,
    };
    let mut progress = Progress::default();
    let forward = catch_unwind(AssertUnwindSafe(|| {
        swap.forward(live, actor.as_ref(), &mut progress)
    }))
    .unwrap_or(Err(BackupError::Db(DbError::OperationPanicked)));
    match forward {
        Ok(fresh) => {
            *live = fresh;
            if let Err(failure) = session.end() {
                eprintln!("backup: session end failed: {failure:?}");
            }
            swap.clean_up();
            Ok(RestoreResult {
                source_schema_version: staged.source_schema_version,
                schema_version: supported_version(),
            })
        }
        Err(failure) => match swap.rollback(live, &progress) {
            Ok(()) => Err(failure),
            Err(rollback_failure) => {
                eprintln!("backup: rollback failed: {rollback_failure:?} after {failure:?}");
                if let Err(ending) = session.end() {
                    eprintln!("backup: session end failed: {ending:?}");
                }
                Err(BackupError::RollbackFailed)
            }
        },
    }
}

pub(super) fn authorize_restore(
    conn: &Connection,
    session: &SessionState,
) -> Result<Option<SessionUser>, BackupError> {
    if needs_owner(conn)? {
        return Ok(None);
    }
    authorize(conn, session).map(Some)
}

impl Swap<'_> {
    fn database_path(&self) -> &Path {
        &self.source.database_path
    }

    fn announce(&self, step: SwapStep) -> Result<(), BackupError> {
        Ok((self.inject)(step)?)
    }

    fn forward(
        &self,
        live: &mut Connection,
        actor: Option<&SessionUser>,
        progress: &mut Progress,
    ) -> Result<Connection, BackupError> {
        self.announce(SwapStep::SavePendingKey)?;
        self.source.key_store.write_pending(&self.staged.key)?;
        progress.pending_written = true;
        self.announce(SwapStep::CloseLiveConnection)?;
        close_live(live)?;
        progress.live_closed = true;
        self.announce(SwapStep::MoveCurrentAside)?;
        fs::rename(self.database_path(), &self.previous_path)?;
        progress.moved_aside = true;
        self.announce(SwapStep::InstallRestored)?;
        fs::rename(&self.staged.restoring_path, self.database_path())?;
        self.announce(SwapStep::VerifyAndAudit)?;
        let fresh = self.open_and_audit(actor)?;
        progress.promotion_attempted = true;
        self.announce(SwapStep::PromoteKey)?;
        self.source.key_store.promote_pending()?;
        Ok(fresh)
    }

    fn open_and_audit(&self, actor: Option<&SessionUser>) -> Result<Connection, BackupError> {
        let mut fresh = open_encrypted(self.database_path(), &self.staged.key)?;
        let stored: i64 = fresh
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(DbError::from)?;
        if stored != i64::from(supported_version()) {
            return Err(BackupError::Unreadable);
        }
        let tx = fresh.transaction().map_err(DbError::from)?;
        audit::record(&tx, &self.restore_entry(actor))?;
        tx.commit().map_err(DbError::from)?;
        Ok(fresh)
    }

    fn restore_entry(&self, actor: Option<&SessionUser>) -> NewAuditEntry {
        NewAuditEntry {
            actor_user_id: None,
            action: AuditAction::BackupRestored,
            entity: AuditEntity::System,
            entity_id: None,
            diff: Diff::created(&json!({
                "restoredBy": actor.map(|user| user.username.as_str()),
                "sourceSchemaVersion": self.staged.source_schema_version,
                "schemaVersion": supported_version(),
            })),
        }
    }

    fn rollback(&self, live: &mut Connection, progress: &Progress) -> Result<(), BackupError> {
        self.announce(SwapStep::Rollback)?;
        let mut tally = RollbackTally::default();
        let key_is_old =
            !progress.promotion_attempted || tally.attempt(self.restore_previous_key()).is_some();
        let state_is_old = key_is_old
            && (!progress.moved_aside || tally.attempt(self.restore_previous_database()).is_some());
        if progress.live_closed {
            if let Some(reopened) = tally.attempt(self.reopen_live()) {
                *live = reopened;
            }
        }
        if progress.pending_written && state_is_old {
            tally.attempt(self.drop_pending_key());
        }
        tally.finish()
    }

    fn restore_previous_key(&self) -> Result<(), BackupError> {
        self.announce(SwapStep::RollbackRestoreKey)?;
        Ok(self.source.key_store.write(&self.previous_key)?)
    }

    fn restore_previous_database(&self) -> Result<(), BackupError> {
        self.announce(SwapStep::RollbackRestoreDatabase)?;
        discard_with_sidecars(self.database_path())?;
        Ok(fs::rename(&self.previous_path, self.database_path())?)
    }

    fn reopen_live(&self) -> Result<Connection, BackupError> {
        self.announce(SwapStep::RollbackReopenLive)?;
        match open_encrypted(self.database_path(), &self.previous_key) {
            Err(DbError::NotADatabase) => {
                Ok(open_encrypted(self.database_path(), &self.staged.key)?)
            }
            other => Ok(other?),
        }
    }

    fn drop_pending_key(&self) -> Result<(), BackupError> {
        self.announce(SwapStep::RollbackDropPendingKey)?;
        Ok(self.source.key_store.delete_pending()?)
    }

    fn clean_up(&self) {
        report_cleanup(
            "previous database",
            discard_with_sidecars(&self.previous_path),
        );
        report_cleanup("pending key", self.source.key_store.delete_pending());
        match all_snapshots(self.database_path()) {
            Ok(snapshots) => snapshots
                .iter()
                .for_each(|path| report_cleanup("snapshot", fs::remove_file(path))),
            Err(failure) => report_cleanup("snapshot listing", Err(failure)),
        }
    }
}

fn close_live(live: &mut Connection) -> Result<(), BackupError> {
    let placeholder = Connection::open_in_memory().map_err(DbError::from)?;
    let current = mem::replace(live, placeholder);
    if let Err((connection, failure)) = current.close() {
        *live = connection;
        return Err(DbError::from(failure).into());
    }
    Ok(())
}

#[cfg(test)]
#[path = "swap_test.rs"]
mod tests;

#[cfg(test)]
#[path = "swap_sidecar_test.rs"]
mod sidecar_tests;
