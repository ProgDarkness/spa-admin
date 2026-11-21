pub mod db;
#[cfg(debug_assertions)]
pub mod dev_seed;
pub mod errors;
pub mod features;
pub mod keystore;
pub mod setup;
#[cfg(test)]
mod test_support;

use features::auth::audit_commands::list_audit;
use features::auth::commands::{
    current_session, login, logout, record_activity, setup_owner, setup_status, unlock,
};
use features::auth::recover::recover_password;
use features::catalog::commands::{
    create_service, list_services, set_service_active, update_service,
};
use features::payment_methods::commands::{
    create_payment_method, list_payment_methods, set_payment_method_active, update_payment_method,
};
use features::rates::commands::{get_rate, list_rates, upsert_rate};
use features::resources::commands::{
    create_resource, list_resources, set_resource_active, update_resource,
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
            upsert_rate
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
    with_commands(builder).setup(setup).run(context)
}

fn startup_failure_message(error: &tauri::Error) -> String {
    format!("application failed to start: {error}")
}

fn app_context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

pub fn run() {
    let context = app_context();
    if let Err(error) = start(tauri::Builder::default(), context, setup::init) {
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
