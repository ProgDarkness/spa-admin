use super::*;

const BINDINGS_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/lib/bindings.ts");

fn export_to(path: &std::path::Path) {
    specta_builder()
        .export(specta_typescript::Typescript::default(), path)
        .unwrap();
}

#[test]
fn export_bindings() {
    export_to(std::path::Path::new(BINDINGS_PATH));
}

#[test]
fn bindings_expose_the_three_auth_commands_and_number_ids() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("bindings.ts");
    export_to(&target);
    let exported = std::fs::read_to_string(target).unwrap();
    for command in ["login", "logout", "currentSession"] {
        assert!(exported.contains(command), "missing {command}");
    }
    assert!(exported.contains("id: number"));
}

#[test]
fn bindings_return_status_tagged_results_with_a_single_app_error_type() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("bindings.ts");
    export_to(&target);
    let exported = std::fs::read_to_string(target).unwrap();
    assert!(exported.contains("typedError<SessionUser, AppError>"));
    assert!(exported.contains(r#"{ status: "error"; error: E }"#));
    assert!(exported.contains("export type AppError = {"));
    assert!(!exported.contains("AppError_Serialize"));
}

const CAPABILITY_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities/default.json");

#[test]
fn capability_grants_only_the_three_auth_commands_and_no_core_defaults() {
    let raw = std::fs::read_to_string(CAPABILITY_PATH).unwrap();
    let capability: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let mut permissions: Vec<&str> = capability["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|permission| permission.as_str().unwrap())
        .collect();
    permissions.sort_unstable();
    assert_eq!(
        permissions,
        ["allow-current-session", "allow-login", "allow-logout"]
    );
}

#[test]
fn bindings_and_the_app_manifest_agree_on_the_command_set() {
    let build_script =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/build.rs")).unwrap();
    for command in ["login", "logout", "current_session"] {
        assert!(
            build_script.contains(&format!("\"{command}\"")),
            "missing {command}"
        );
    }
}
