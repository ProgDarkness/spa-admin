const MANIFEST: &str = include_str!("../Cargo.toml");
const PINNED_SECTIONS: [&str; 3] = [
    "[dependencies]",
    "[build-dependencies]",
    "[dev-dependencies]",
];

fn unpinned_dependencies() -> Vec<String> {
    let mut current_section = "";
    let mut unpinned = Vec::new();
    for line in MANIFEST.lines().map(str::trim) {
        if line.starts_with('[') {
            current_section = line;
            continue;
        }
        let is_dependency_line = PINNED_SECTIONS.contains(&current_section) && line.contains('=');
        if is_dependency_line && !line.contains("\"=") {
            unpinned.push(line.to_string());
        }
    }
    unpinned
}

#[test]
fn every_direct_dependency_is_pinned_with_exact_version() {
    assert_eq!(unpinned_dependencies(), Vec::<String>::new());
}

fn dependency_line(name: &str) -> &'static str {
    MANIFEST
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with(&format!("{name} =")))
        .unwrap_or_default()
}

#[test]
fn argon2_wipes_its_memory_blocks_with_the_zeroize_feature() {
    assert!(dependency_line("argon2").contains("\"zeroize\""));
}
