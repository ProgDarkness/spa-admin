const LOCKFILE: &str = include_str!("../Cargo.lock");

fn locked_version(package: &str) -> Option<String> {
    let header = format!("name = \"{package}\"");
    let mut lines = LOCKFILE.lines();
    lines.find(|line| *line == header)?;
    lines
        .next()
        .and_then(|line| line.strip_prefix("version = \""))
        .and_then(|rest| rest.strip_suffix('"'))
        .map(str::to_string)
}

fn leading_major(version: &str) -> u32 {
    version.split('.').next().unwrap().parse().unwrap()
}

#[test]
fn sqlcipher_source_is_at_least_420_to_cover_rustsec_2026_0502() {
    let version = locked_version("sqlcipher-src").expect("sqlcipher-src missing from lockfile");
    assert!(leading_major(&version) >= 420, "sqlcipher-src {version}");
}

#[test]
fn rusqlite_migration_is_not_in_the_dependency_graph() {
    assert_eq!(locked_version("rusqlite_migration"), None);
}
