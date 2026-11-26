use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use super::tests::{camel_case, REGISTERED_COMMANDS};
use super::*;

const BINDINGS_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/lib/bindings.ts");
const BUILD_SCRIPT_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/build.rs");
const UPDATE_BINDINGS_ENV: &str = "SPA_UPDATE_BINDINGS";
const COMMANDS_BLOCK_START: &str = "export const commands = {";
const TYPE_PREFIX: &str = "export type ";
const BUILD_SCRIPT_LIST_START: &str = "const APP_COMMANDS: &[&str] = &[";
const TYPED_ERROR_DECLARATION: &str = r#"async function typedError<T, E>(result: Promise<T>): Promise<{ status: "ok"; data: T } | { status: "error"; error: E }> {"#;

fn exported_bindings() -> &'static str {
    static EXPORTED: OnceLock<String> = OnceLock::new();
    EXPORTED.get_or_init(|| {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("bindings.ts");
        command_catalog::<tauri::Wry>()
            .export(specta_typescript::Typescript::default(), &target)
            .unwrap();
        std::fs::read_to_string(target).unwrap()
    })
}

#[derive(Debug, PartialEq)]
struct CommandBinding {
    name: String,
    invoked_as: String,
    returns: String,
    fails_with: String,
}

fn between<'text>(text: &'text str, start: &str, end: &str) -> Option<&'text str> {
    let from = text.find(start)? + start.len();
    let length = text[from..].find(end)?;
    Some(&text[from..from + length])
}

fn command_binding(line: &str) -> Option<CommandBinding> {
    let (name, _) = line.trim().split_once(": (")?;
    let result = between(line, "typedError<", ">(__TAURI_INVOKE(")?;
    let (returns, fails_with) = result.rsplit_once(", ")?;
    Some(CommandBinding {
        name: name.to_string(),
        invoked_as: between(line, "__TAURI_INVOKE(\"", "\"")?.to_string(),
        returns: returns.to_string(),
        fails_with: fails_with.to_string(),
    })
}

fn command_bindings(exported: &str) -> Vec<CommandBinding> {
    exported
        .lines()
        .skip_while(|line| *line != COMMANDS_BLOCK_START)
        .skip(1)
        .take_while(|line| *line != "};")
        .map(|line| command_binding(line).unwrap_or_else(|| panic!("unparsable: {line}")))
        .collect()
}

fn object_types(exported: &str) -> BTreeMap<String, BTreeMap<String, String>> {
    let mut types = BTreeMap::new();
    let mut lines = exported.lines();
    while let Some(line) = lines.next() {
        let Some(name) = line
            .strip_prefix(TYPE_PREFIX)
            .and_then(|rest| rest.strip_suffix(" = {"))
        else {
            continue;
        };
        let fields = lines
            .by_ref()
            .take_while(|field| *field != "};")
            .map(|field| field.trim().trim_end_matches(','))
            .filter_map(|field| field.split_once(": "))
            .map(|(key, kind)| (key.to_string(), kind.to_string()))
            .collect();
        types.insert(name.to_string(), fields);
    }
    types
}

fn union_variants(exported: &str, type_name: &str) -> Vec<String> {
    let declaration = format!("{TYPE_PREFIX}{type_name} = ");
    let line = exported
        .lines()
        .find_map(|line| line.strip_prefix(&declaration))
        .unwrap_or_else(|| panic!("missing union {type_name}"));
    line.trim_end_matches(';')
        .split(" | ")
        .map(|variant| variant.trim_matches('"').to_string())
        .collect()
}

fn lf(text: &str) -> String {
    text.replace("\r\n", "\n")
}

#[test]
fn export_bindings() {
    let generated = exported_bindings();
    if std::env::var_os(UPDATE_BINDINGS_ENV).is_some() {
        std::fs::write(BINDINGS_PATH, generated).unwrap();
        return;
    }

    let committed = std::fs::read_to_string(BINDINGS_PATH).unwrap();

    assert!(
        lf(&committed) == lf(generated),
        "src/lib/bindings.ts drifted from the Rust commands; regenerate with {UPDATE_BINDINGS_ENV}=1 cargo test export_bindings"
    );
}

#[test]
fn bindings_expose_exactly_the_registered_commands_in_registration_order() {
    let bindings = command_bindings(exported_bindings());

    let names: Vec<&str> = bindings
        .iter()
        .map(|binding| binding.name.as_str())
        .collect();
    let invoked: Vec<&str> = bindings
        .iter()
        .map(|binding| binding.invoked_as.as_str())
        .collect();

    let expected_names: Vec<String> = REGISTERED_COMMANDS.map(camel_case).into();
    assert_eq!(names, expected_names);
    assert_eq!(invoked, REGISTERED_COMMANDS);
}

#[test]
fn every_binding_fails_with_the_single_app_error_type() {
    let bindings = command_bindings(exported_bindings());

    assert_eq!(bindings.len(), REGISTERED_COMMANDS.len());
    assert!(bindings
        .iter()
        .all(|binding| binding.fails_with == "AppError"));
    assert!(!object_types(exported_bindings()).contains_key("AppError_Serialize"));
    assert_eq!(
        object_types(exported_bindings())["AppError"]
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["code", "message", "field", "entityIds"])
    );
}

#[test]
fn bindings_return_status_tagged_results() {
    let declared = exported_bindings()
        .lines()
        .any(|line| line == TYPED_ERROR_DECLARATION);

    assert!(declared);
}

#[test]
fn bindings_return_the_expected_payload_per_command() {
    let bindings = command_bindings(exported_bindings());
    let returns_of = |command: &str| {
        bindings
            .iter()
            .find(|binding| binding.invoked_as == command)
            .unwrap()
            .returns
            .as_str()
    };

    assert_eq!(returns_of("login"), "SessionUser");
    assert_eq!(returns_of("logout"), "null");
    assert_eq!(returns_of("current_session"), "SessionView | null");
    assert_eq!(returns_of("record_activity"), "SessionView | null");
    assert_eq!(returns_of("setup_status"), "SetupStatus");
    assert_eq!(returns_of("setup_owner"), "OwnerSetupResult");
    assert_eq!(returns_of("list_users"), "UserSummary[]");
    assert_eq!(returns_of("export_backup"), "BackupExported | null");
    assert_eq!(returns_of("restore_backup"), "RestoreResult | null");
    assert_eq!(returns_of("get_backup_status"), "BackupStatus");
}

#[test]
fn every_exported_id_field_is_a_number() {
    let types = object_types(exported_bindings());

    let ids: Vec<(&String, &String)> = types
        .iter()
        .flat_map(|(name, fields)| fields.get("id").map(|kind| (name, kind)))
        .collect();

    assert!(ids.len() >= 4, "{ids:?}");
    assert!(ids.iter().all(|(_, kind)| *kind == "number"), "{ids:?}");
}

#[test]
fn bindings_expose_the_session_status_and_error_code_variants() {
    let exported = exported_bindings();

    assert_eq!(
        union_variants(exported, "SessionStatus"),
        ["active", "locked"]
    );
    assert_eq!(
        union_variants(exported, "AppErrorCode"),
        [
            "invalidCredentials",
            "validation",
            "unauthenticated",
            "forbidden",
            "sessionLocked",
            "notFound",
            "nationalIdTaken",
            "clientDeletedReactivate",
            "overlap",
            "crossesMidnight",
            "invalidTransition",
            "resourceInactive",
            "resourceHasFutureAppointments",
            "rateMissing",
            "alreadyVoided",
            "backupUnreadable",
            "backupNotRecognized",
            "backupFromNewerApp",
            "internal"
        ]
    );
    assert!(object_types(exported).contains_key("UnlockCredentials"));
}

#[test]
fn bindings_expose_the_setup_types_with_their_exact_fields() {
    let types = object_types(exported_bindings());

    assert_eq!(types["SetupStatus"]["needsOwner"], "boolean");
    assert_eq!(types["OwnerSetupResult"]["recoveryCode"], "string");
    assert!(types.contains_key("OwnerSetup"));
    assert!(types.contains_key("ClockRollback"));
}

#[test]
fn the_app_manifest_lists_exactly_the_registered_commands() {
    let build_script = std::fs::read_to_string(BUILD_SCRIPT_PATH).unwrap();

    let list = between(&build_script, BUILD_SCRIPT_LIST_START, "];").unwrap();
    let declared: Vec<&str> = list
        .split('"')
        .enumerate()
        .filter(|(index, _)| index % 2 == 1)
        .map(|(_, command)| command)
        .collect();

    assert_eq!(declared, REGISTERED_COMMANDS);
}
