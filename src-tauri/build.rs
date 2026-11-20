use std::path::PathBuf;

use tauri_build::{AppManifest, Attributes, WindowsAttributes};

const APP_COMMANDS: &[&str] = &[
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
];
const WINDOWS_MANIFEST_FILE: &str = "windows-app-manifest.xml";

fn targets_msvc() -> bool {
    std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
}

fn embed_manifest_in_every_artifact() {
    let manifest_dir =
        std::env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo");
    let manifest = PathBuf::from(manifest_dir).join(WINDOWS_MANIFEST_FILE);
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
}

fn main() {
    let manifest = AppManifest::new().commands(APP_COMMANDS);
    let mut attributes = Attributes::new().app_manifest(manifest);
    if targets_msvc() {
        attributes = attributes.windows_attributes(WindowsAttributes::new_without_app_manifest());
        embed_manifest_in_every_artifact();
    }
    if let Err(error) = tauri_build::try_build(attributes) {
        panic!("tauri build failed: {error:#}");
    }
}
