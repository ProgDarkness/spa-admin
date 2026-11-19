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
