use tauri::Manager;

use super::*;

pub(super) const REGISTERED_COMMANDS: [&str; 16] = [
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
