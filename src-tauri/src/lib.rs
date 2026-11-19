pub mod db;
#[cfg(debug_assertions)]
pub mod dev_seed;
pub mod errors;
pub mod features;
pub mod keystore;
pub mod setup;
#[cfg(test)]
mod test_support;

use features::auth::commands::{current_session, login, logout};

pub fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            login,
            logout,
            current_session
        ])
        .error_handling(tauri_specta::ErrorHandlingMode::Result)
        .disable_serde_phases()
        .dangerously_cast_bigints_to_number()
}

pub fn run() {
    let builder = specta_builder();
    let outcome = tauri::Builder::default()
        .invoke_handler(builder.invoke_handler())
        .setup(setup::init)
        .run(tauri::generate_context!());
    if let Err(error) = outcome {
        eprintln!("application failed to start: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
#[path = "lib_test.rs"]
mod tests;
