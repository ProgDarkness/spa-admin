use tauri::Manager;

use super::*;

pub(super) const REGISTERED_COMMANDS: [&str; 49] = [
    "login",
    "logout",
    "current_session",
    "record_activity",
    "unlock",
    "setup_status",
    "setup_owner",
    "recover_password",
    "list_users",
    "create_user",
    "update_user",
    "reset_user_password",
    "list_roles",
    "create_role",
    "set_role_permissions",
    "list_audit",
    "list_services",
    "create_service",
    "update_service",
    "set_service_active",
    "list_resources",
    "create_resource",
    "update_resource",
    "set_resource_active",
    "list_payment_methods",
    "create_payment_method",
    "update_payment_method",
    "set_payment_method_active",
    "list_rates",
    "get_rate",
    "upsert_rate",
    "list_clients",
    "get_client",
    "create_client",
    "update_client",
    "set_client_deleted",
    "list_appointments",
    "create_appointment",
    "move_appointment",
    "transition_appointment",
    "list_future_appointments_of_resource",
    "list_payments",
    "create_payment",
    "void_payment",
    "get_client_history",
    "get_monthly_metrics",
    "export_backup",
    "restore_backup",
    "get_backup_status",
];

pub(super) fn camel_case(command: &str) -> String {
    command
        .split('_')
        .enumerate()
        .map(|(index, word)| {
            let mut letters = word.chars();
            match letters.next() {
                Some(first) if index > 0 => first.to_uppercase().chain(letters).collect(),
                _ => word.to_string(),
            }
        })
        .collect()
}

fn permission_of(command: &str) -> String {
    format!("allow-{}", command.replace('_', "-"))
}

const CAPABILITY_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities/default.json");

#[test]
fn camel_case_joins_snake_case_words() {
    assert_eq!(camel_case("login"), "login");
    assert_eq!(camel_case("current_session"), "currentSession");
    assert_eq!(camel_case("reset_user_password"), "resetUserPassword");
}

#[test]
fn capability_grants_only_the_registered_commands_and_no_core_defaults() {
    let raw = std::fs::read_to_string(CAPABILITY_PATH).unwrap();
    let capability: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let mut permissions: Vec<&str> = capability["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|permission| permission.as_str().unwrap())
        .collect();
    permissions.sort_unstable();
    let mut expected: Vec<String> = REGISTERED_COMMANDS.map(permission_of).into();
    expected.sort_unstable();
    assert_eq!(permissions, expected);
}

fn webview_with_commands() -> (
    tauri::App<tauri::test::MockRuntime>,
    tauri::WebviewWindow<tauri::test::MockRuntime>,
) {
    let app = with_commands(tauri::test::mock_builder())
        .build(app_context())
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    (app, webview)
}

const IPC_ORIGIN: &str = if cfg!(any(windows, target_os = "android")) {
    "http://tauri.localhost"
} else {
    "tauri://localhost"
};

fn invoke(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
) -> Result<tauri::ipc::InvokeResponseBody, serde_json::Value> {
    tauri::test::get_ipc_response(
        webview,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: IPC_ORIGIN.parse().unwrap(),
            body: tauri::ipc::InvokeBody::default(),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    )
}

fn reached_the_handler_of(command: &str, failure: &str) -> bool {
    let unmanaged_state = format!("state not managed for field `db` on command `{command}`.");
    let missing_argument =
        format!("for command `{command}`: command {command} missing required key");
    failure.contains(&unmanaged_state) || failure.contains(&missing_argument)
}

#[test]
fn every_app_command_is_routed_to_its_own_handler() {
    let (_app, webview) = webview_with_commands();

    for command in REGISTERED_COMMANDS {
        let failure = invoke(&webview, command).unwrap_err().to_string();
        assert!(
            reached_the_handler_of(command, &failure),
            "{command}: {failure}"
        );
    }
}

#[test]
fn reaching_a_handler_is_not_confused_with_being_rejected() {
    assert!(!reached_the_handler_of(
        "login",
        "login not allowed. Command not found"
    ));
    assert!(!reached_the_handler_of(
        "login",
        "state not managed for field `db` on command `logout`."
    ));
}

#[test]
fn the_invoke_handler_rejects_commands_outside_the_app_set() {
    let (_app, webview) = webview_with_commands();

    let failure = invoke(&webview, "delete_everything")
        .unwrap_err()
        .to_string();

    assert!(
        failure.contains("delete_everything not allowed"),
        "{failure}"
    );
}

#[test]
fn a_routed_command_reaches_its_handler_with_the_managed_state() {
    let (app, webview) = webview_with_commands();
    app.manage(crate::db::Database::new(test_database()));
    app.manage(features::auth::service::SessionState::default());

    let response = invoke(&webview, "current_session").unwrap();

    assert_eq!(
        response.deserialize::<Option<serde_json::Value>>().unwrap(),
        None
    );
}

fn test_database() -> rusqlite::Connection {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::db::migrate(&mut conn).unwrap();
    conn
}

#[cfg(not(target_os = "macos"))]
#[test]
fn start_runs_the_setup_hook_inside_the_event_loop_and_returns_once_the_window_closes() {
    let setup_ran = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let witness = setup_ran.clone();
    let setup = move |app: &mut tauri::App<tauri::test::MockRuntime>| {
        witness.store(true, std::sync::atomic::Ordering::SeqCst);
        app.get_webview_window("main").unwrap().destroy()?;
        Ok(())
    };

    let outcome = start(tauri::test::mock_builder(), app_context(), setup);

    assert!(outcome.is_ok());
    assert!(setup_ran.load(std::sync::atomic::Ordering::SeqCst));
}

#[cfg(not(target_os = "macos"))]
#[test]
fn start_registers_the_invoke_handler_before_the_setup_hook_runs() {
    let routed = std::sync::Arc::new(std::sync::Mutex::new(None));
    let witness = routed.clone();
    let setup = move |app: &mut tauri::App<tauri::test::MockRuntime>| {
        let webview = app.get_webview_window("main").unwrap();
        let failure = invoke(&webview, "current_session").unwrap_err().to_string();
        *witness.lock().unwrap() = Some(failure);
        webview.destroy()?;
        Ok(())
    };

    start(tauri::test::mock_builder(), app_context(), setup).unwrap();

    let failure = routed.lock().unwrap().clone().unwrap();
    assert!(
        reached_the_handler_of("current_session", &failure),
        "{failure}"
    );
}

#[test]
fn startup_failure_message_names_the_failure_and_the_cause() {
    let message = startup_failure_message(&tauri::Error::AssetNotFound("index.html".into()));

    assert!(
        message.starts_with("application failed to start: "),
        "{message}"
    );
    assert!(message.contains("index.html"), "{message}");
}

#[test]
fn capability_grants_no_dialog_or_filesystem_permissions_to_the_webview() {
    let raw = std::fs::read_to_string(CAPABILITY_PATH).unwrap();
    let capability: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let forbidden: Vec<&str> = capability["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|permission| permission.as_str().unwrap())
        .filter(|permission| permission.starts_with("dialog:") || permission.starts_with("fs:"))
        .collect();
    assert_eq!(forbidden, Vec::<&str>::new());
}

#[cfg(not(target_os = "macos"))]
#[test]
fn start_registers_the_dialog_plugin_before_the_setup_hook_runs() {
    let dialog_available = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let witness = dialog_available.clone();
    let setup = move |app: &mut tauri::App<tauri::test::MockRuntime>| {
        let is_managed = app
            .try_state::<tauri_plugin_dialog::Dialog<tauri::test::MockRuntime>>()
            .is_some();
        witness.store(is_managed, std::sync::atomic::Ordering::SeqCst);
        app.get_webview_window("main").unwrap().destroy()?;
        Ok(())
    };

    start(tauri::test::mock_builder(), app_context(), setup).unwrap();

    assert!(dialog_available.load(std::sync::atomic::Ordering::SeqCst));
}

fn failing_setup(
    _: &mut tauri::App<tauri::test::MockRuntime>,
) -> Result<(), Box<dyn std::error::Error>> {
    Err("database unavailable".into())
}

fn succeeding_setup(
    _: &mut tauri::App<tauri::test::MockRuntime>,
) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

fn counting_reporter() -> (
    std::sync::Arc<std::sync::atomic::AtomicUsize>,
    impl FnOnce(&tauri::AppHandle<tauri::test::MockRuntime>) + Send + 'static,
) {
    let reports = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let witness = reports.clone();
    (reports, move |_| {
        witness.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    })
}

#[test]
fn the_startup_failure_message_points_to_the_user_manual_without_leaking_paths_or_keys() {
    assert!(STARTUP_FAILURE_MESSAGE.contains("docs/manual-usuario.md"));
    assert!(STARTUP_FAILURE_MESSAGE.contains("carpeta de datos"));
    assert!(STARTUP_FAILURE_MESSAGE.contains("restaur"));
    assert!(!STARTUP_FAILURE_MESSAGE.contains("spa.db"));
    assert!(!STARTUP_FAILURE_MESSAGE.contains("keychain"));
    assert!(!STARTUP_FAILURE_MESSAGE.contains("{"));
    assert!(!STARTUP_FAILURE_TITLE.is_empty());
}

#[test]
fn a_failing_setup_reports_once_and_lets_the_app_shut_down_cleanly() {
    let (reports, reporter) = counting_reporter();
    let mut app = tauri::test::mock_app();

    let outcome = guarded_setup(failing_setup, reporter)(&mut app);

    assert!(outcome.is_ok());
    assert_eq!(reports.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn a_succeeding_setup_reports_nothing() {
    let (reports, reporter) = counting_reporter();
    let mut app = tauri::test::mock_app();

    let outcome = guarded_setup(succeeding_setup, reporter)(&mut app);

    assert!(outcome.is_ok());
    assert_eq!(reports.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[cfg(not(target_os = "macos"))]
#[test]
fn start_survives_a_failing_setup_by_reporting_it_instead_of_panicking() {
    let reports = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let witness = reports.clone();
    let reporter = move |handle: &tauri::AppHandle<tauri::test::MockRuntime>| {
        witness.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        handle
            .get_webview_window("main")
            .unwrap()
            .destroy()
            .unwrap();
    };

    let outcome = start(
        tauri::test::mock_builder(),
        app_context(),
        guarded_setup(failing_setup, reporter),
    );

    assert!(outcome.is_ok());
    assert_eq!(reports.load(std::sync::atomic::Ordering::SeqCst), 1);
}

fn exit_witness() -> (
    std::sync::Arc<std::sync::atomic::AtomicUsize>,
    impl FnOnce() + Send + 'static,
) {
    let exits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let witness = exits.clone();
    (exits, move || {
        witness.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    })
}

#[test]
fn the_app_exits_once_the_failure_dialog_is_dismissed() {
    let (exits, exit) = exit_witness();
    let presented = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let witness = presented.clone();

    present_then_exit(
        move || witness.store(true, std::sync::atomic::Ordering::SeqCst),
        exit,
    )
    .join()
    .unwrap();

    assert!(presented.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(exits.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn the_app_exits_even_when_the_failure_dialog_cannot_be_shown() {
    let (exits, exit) = exit_witness();

    present_then_exit(|| panic!("no display available"), exit)
        .join()
        .unwrap();

    assert_eq!(exits.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn the_app_does_not_exit_before_the_failure_dialog_returns() {
    let (exits, exit) = exit_witness();
    let (release, wait_for_release) = std::sync::mpsc::channel::<()>();
    let exits_seen_while_open = exits.clone();

    let handle = present_then_exit(
        move || {
            wait_for_release.recv().unwrap();
        },
        exit,
    );

    assert_eq!(
        exits_seen_while_open.load(std::sync::atomic::Ordering::SeqCst),
        0
    );
    release.send(()).unwrap();
    handle.join().unwrap();
    assert_eq!(exits.load(std::sync::atomic::Ordering::SeqCst), 1);
}
