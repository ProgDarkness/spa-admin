pub mod db;
#[cfg(debug_assertions)]
pub mod dev_seed;
#[cfg(debug_assertions)]
pub mod dev_seed_appointments;
#[cfg(debug_assertions)]
pub mod dev_seed_catalog;
#[cfg(debug_assertions)]
pub mod dev_seed_clients;
#[cfg(debug_assertions)]
pub mod dev_seed_payments;
pub mod errors;
pub mod features;
pub mod keystore;
pub mod setup;
#[cfg(test)]
mod test_support;

use tauri_plugin_dialog::DialogExt;

use features::appointments::commands::{
    create_appointment, list_appointments, move_appointment, transition_appointment,
};
use features::auth::audit_commands::list_audit;
use features::auth::commands::{
    current_session, login, logout, record_activity, setup_owner, setup_status, unlock,
};
use features::auth::recover::recover_password;
use features::backup::commands::{export_backup, get_backup_status, restore_backup};
use features::catalog::commands::{
    create_service, list_services, set_service_active, update_service,
};
use features::client_history::commands::get_client_history;
use features::clients::commands::{
    create_client, get_client, list_clients, set_client_deleted, update_client,
};
use features::metrics::commands::get_monthly_metrics;
use features::payment_methods::commands::{
    create_payment_method, list_payment_methods, set_payment_method_active, update_payment_method,
};
use features::payments::commands::{create_payment, list_payments, void_payment};
use features::rates::commands::{get_rate, list_rates, upsert_rate};
use features::resources::commands::{
    create_resource, list_future_appointments_of_resource, list_resources, set_resource_active,
    update_resource,
};
use features::users::commands::{
    create_role, create_user, list_roles, list_users, reset_user_password, set_role_permissions,
    update_user,
};

fn with_commands<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(command_catalog::<R>().invoke_handler())
}

fn command_catalog<R: tauri::Runtime>() -> tauri_specta::Builder<R> {
    tauri_specta::Builder::<R>::new()
        .commands(tauri_specta::collect_commands![
            login,
            logout,
            current_session,
            record_activity,
            unlock,
            setup_status,
            setup_owner,
            recover_password,
            list_users,
            create_user,
            update_user,
            reset_user_password,
            list_roles,
            create_role,
            set_role_permissions,
            list_audit,
            list_services,
            create_service,
            update_service,
            set_service_active,
            list_resources,
            create_resource,
            update_resource,
            set_resource_active,
            list_payment_methods,
            create_payment_method,
            update_payment_method,
            set_payment_method_active,
            list_rates,
            get_rate,
            upsert_rate,
            list_clients,
            get_client,
            create_client,
            update_client,
            set_client_deleted,
            list_appointments,
            create_appointment,
            move_appointment,
            transition_appointment,
            list_future_appointments_of_resource,
            list_payments,
            create_payment,
            void_payment,
            get_client_history,
            get_monthly_metrics,
            export_backup,
            restore_backup,
            get_backup_status
        ])
        .error_handling(tauri_specta::ErrorHandlingMode::Result)
        .disable_serde_phases()
        .dangerously_cast_bigints_to_number()
}

fn start<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
    context: tauri::Context<R>,
    setup: impl FnOnce(&mut tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> + Send + 'static,
) -> tauri::Result<()> {
    with_commands(builder)
        .plugin(tauri_plugin_dialog::init())
        .setup(setup)
        .run(context)
}

pub(crate) const STARTUP_FAILURE_TITLE: &str = "Spa no pudo iniciar";
pub(crate) const STARTUP_FAILURE_MESSAGE: &str = "La aplicación no pudo abrir sus datos y se cerrará. Abre el Manual de usuario que recibiste con el instalador: en la sección \"Si la aplicación no abre\" se explica cómo apartar la carpeta de datos y restaurar un respaldo en el primer arranque.";

fn guarded_setup<R: tauri::Runtime>(
    setup: impl FnOnce(&mut tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> + Send + 'static,
    on_failure: impl FnOnce(&tauri::AppHandle<R>) + Send + 'static,
) -> impl FnOnce(&mut tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> + Send + 'static {
    move |app| {
        if let Err(failure) = setup(app) {
            eprintln!("application setup failed: {failure}");
            on_failure(app.handle());
        }
        Ok(())
    }
}

fn present_then_exit(
    present: impl FnOnce() + Send + 'static,
    exit: impl FnOnce() + Send + 'static,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(present)).is_err() {
            eprintln!("startup failure dialog could not be shown");
        }
        exit();
    })
}

fn report_startup_failure<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let dialog_owner = app.clone();
    let exit_handle = app.clone();
    present_then_exit(
        move || {
            dialog_owner
                .dialog()
                .message(STARTUP_FAILURE_MESSAGE)
                .title(STARTUP_FAILURE_TITLE)
                .kind(tauri_plugin_dialog::MessageDialogKind::Error)
                .blocking_show();
        },
        move || exit_handle.exit(1),
    );
}

fn startup_failure_message(error: &tauri::Error) -> String {
    format!("application failed to start: {error}")
}

fn app_context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

pub fn run() {
    let context = app_context();
    if let Err(error) = start(
        tauri::Builder::default(),
        context,
        guarded_setup(setup::init, report_startup_failure),
    ) {
        eprintln!("{}", startup_failure_message(&error));
        std::process::exit(1);
    }
}

#[cfg(test)]
#[path = "lib_test.rs"]
mod tests;

#[cfg(test)]
#[path = "lib_bindings_test.rs"]
mod bindings_tests;
