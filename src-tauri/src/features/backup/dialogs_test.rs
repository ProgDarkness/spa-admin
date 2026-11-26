use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread::{self, ThreadId};

use super::*;

fn picking(path: Option<&str>) -> BackupDialogs {
    let chosen = path.map(PathBuf::from);
    let for_open = chosen.clone();
    BackupDialogs::new(
        Arc::new(move |_| chosen.clone()),
        Arc::new(move || for_open.clone()),
    )
}

#[test]
fn the_save_dialog_receives_the_suggested_name_and_returns_the_chosen_path() {
    let seen = Arc::new(Mutex::new(String::new()));
    let witness = seen.clone();
    let dialogs = BackupDialogs::new(
        Arc::new(move |name| {
            *witness.lock().unwrap() = name.to_string();
            Some(PathBuf::from("/usb/elegido"))
        }),
        Arc::new(|| None),
    );

    let chosen = tauri::async_runtime::block_on(dialogs.pick_save("sugerido.spabak".into()));

    assert_eq!(chosen.unwrap(), Some(PathBuf::from("/usb/elegido")));
    assert_eq!(*seen.lock().unwrap(), "sugerido.spabak");
}

#[test]
fn the_open_dialog_returns_the_chosen_path() {
    let dialogs = picking(Some("/usb/respaldo.spabak"));

    let chosen = tauri::async_runtime::block_on(dialogs.pick_open());

    assert_eq!(chosen.unwrap(), Some(PathBuf::from("/usb/respaldo.spabak")));
}

#[test]
fn a_cancelled_dialog_is_not_an_error() {
    let dialogs = picking(None);

    let saved = tauri::async_runtime::block_on(dialogs.pick_save("x.spabak".into()));
    let opened = tauri::async_runtime::block_on(dialogs.pick_open());

    assert_eq!(saved.unwrap(), None);
    assert_eq!(opened.unwrap(), None);
}

#[test]
fn both_dialogs_run_off_the_calling_thread() {
    let threads: Arc<Mutex<Vec<ThreadId>>> = Arc::default();
    let save_witness = threads.clone();
    let open_witness = threads.clone();
    let dialogs = BackupDialogs::new(
        Arc::new(move |_| {
            save_witness.lock().unwrap().push(thread::current().id());
            None
        }),
        Arc::new(move || {
            open_witness.lock().unwrap().push(thread::current().id());
            None
        }),
    );

    let caller = thread::current().id();
    tauri::async_runtime::block_on(async {
        dialogs.pick_save("x.spabak".into()).await.unwrap();
        dialogs.pick_open().await.unwrap();
    });

    let recorded = threads.lock().unwrap();
    assert_eq!(recorded.len(), 2);
    assert!(recorded.iter().all(|id| *id != caller));
}

#[test]
fn a_panicking_dialog_becomes_a_file_failure() {
    let dialogs = BackupDialogs::new(Arc::new(|_| panic!("dialog crashed")), Arc::new(|| None));

    let failure = tauri::async_runtime::block_on(dialogs.pick_save("x.spabak".into()));

    assert!(matches!(failure, Err(BackupError::Io(_))));
}

#[test]
fn the_native_dialogs_are_built_without_opening_any_window() {
    let app = tauri::test::mock_app();

    let dialogs = BackupDialogs::native(app.handle().clone());

    let cloned = dialogs.clone();
    drop((dialogs, cloned));
}
