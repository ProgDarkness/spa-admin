use std::io;
use std::sync::{Arc, Mutex, PoisonError};

use tauri::{AppHandle, Manager, Runtime};

use super::errors::BackupError;
use super::model::BackupSource;
use crate::db::Database;
use crate::features::auth::service::SessionState;

type Job = Box<dyn FnOnce(&Database, &SessionState, &BackupSource) + Send>;
type Launcher = Arc<dyn Fn(Job) -> tauri::async_runtime::JoinHandle<()> + Send + Sync>;

#[derive(Clone)]
pub struct BackupBackground {
    launch: Launcher,
}

impl BackupBackground {
    pub fn native<R: Runtime>(app: AppHandle<R>) -> Self {
        Self {
            launch: Arc::new(move |job| {
                let owner = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let db = owner.state::<Database>();
                    let session = owner.state::<SessionState>();
                    let source = owner.state::<BackupSource>();
                    job(&db, &session, &source)
                })
            }),
        }
    }

    pub async fn run<T, F>(&self, work: F) -> Result<T, BackupError>
    where
        T: Send + 'static,
        F: FnOnce(&Database, &SessionState, &BackupSource) -> Result<T, BackupError>
            + Send
            + 'static,
    {
        let slot: Arc<Mutex<Option<Result<T, BackupError>>>> = Arc::default();
        let writer = slot.clone();
        (self.launch)(Box::new(move |db, session, source| {
            let outcome = work(db, session, source);
            *writer.lock().unwrap_or_else(PoisonError::into_inner) = Some(outcome);
        }))
        .await
        .map_err(|failure| BackupError::Io(io::Error::other(failure.to_string())))?;
        let outcome = slot.lock().unwrap_or_else(PoisonError::into_inner).take();
        outcome.unwrap_or_else(|| Err(BackupError::Io(io::Error::other("background work lost"))))
    }
}

#[cfg(test)]
#[path = "background_test.rs"]
mod tests;
