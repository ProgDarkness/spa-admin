const BUILD_SCRIPT: &str = include_str!("../build.rs");
const MANIFEST: &str = include_str!("../windows-app-manifest.xml");

#[test]
fn manifest_declares_common_controls_v6_dependency() {
    assert!(MANIFEST.contains("name=\"Microsoft.Windows.Common-Controls\""));
    assert!(MANIFEST.contains("version=\"6.0.0.0\""));
    assert!(MANIFEST.contains("publicKeyToken=\"6595b64144ccf1df\""));
}

#[test]
fn build_script_links_manifest_into_every_artifact_not_only_bins() {
    assert!(BUILD_SCRIPT.contains("new_without_app_manifest"));
    assert!(BUILD_SCRIPT.contains("cargo:rustc-link-arg=/MANIFEST:EMBED"));
    assert!(BUILD_SCRIPT.contains("cargo:rustc-link-arg=/MANIFESTINPUT:"));
    assert!(!BUILD_SCRIPT.contains("rustc-link-arg-bins"));
}

#[test]
fn build_script_restricts_manifest_linking_to_msvc_targets() {
    assert!(BUILD_SCRIPT.contains("CARGO_CFG_TARGET_ENV"));
    assert!(BUILD_SCRIPT.contains("\"msvc\""));
}
