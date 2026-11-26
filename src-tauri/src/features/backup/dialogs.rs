use std::io;
use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

use super::errors::BackupError;
use super::naming::{BACKUP_EXTENSION, BACKUP_FILTER_NAME};

type SavePicker = Arc<dyn Fn(&str) -> Option<PathBuf> + Send + Sync>;
type OpenPicker = Arc<dyn Fn() -> Option<PathBuf> + Send + Sync>;

#[derive(Clone)]
pub struct BackupDialogs {
    save: SavePicker,
    open: OpenPicker,
}

impl BackupDialogs {
    pub fn new(save: SavePicker, open: OpenPicker) -> Self {
        Self { save, open }
    }

    pub fn native<R: Runtime>(app: AppHandle<R>) -> Self {
        let for_save = app.clone();
        Self::new(
            Arc::new(move |suggested_name| {
                for_save
                    .dialog()
                    .file()
                    .add_filter(BACKUP_FILTER_NAME, &[BACKUP_EXTENSION])
                    .set_file_name(suggested_name)
                    .blocking_save_file()
                    .and_then(|chosen| chosen.into_path().ok())
            }),
            Arc::new(move || {
                app.dialog()
                    .file()
                    .add_filter(BACKUP_FILTER_NAME, &[BACKUP_EXTENSION])
                    .blocking_pick_file()
                    .and_then(|chosen| chosen.into_path().ok())
            }),
        )
    }

    pub async fn pick_save(&self, suggested_name: String) -> Result<Option<PathBuf>, BackupError> {
        let picker = self.save.clone();
        tauri::async_runtime::spawn_blocking(move || picker(&suggested_name))
            .await
            .map_err(dialog_task_failure)
    }

    pub async fn pick_open(&self) -> Result<Option<PathBuf>, BackupError> {
        let picker = self.open.clone();
        tauri::async_runtime::spawn_blocking(move || picker())
            .await
            .map_err(dialog_task_failure)
    }
}

fn dialog_task_failure(failure: tauri::Error) -> BackupError {
    BackupError::Io(io::Error::other(failure.to_string()))
}

#[cfg(test)]
#[path = "dialogs_test.rs"]
mod tests;
