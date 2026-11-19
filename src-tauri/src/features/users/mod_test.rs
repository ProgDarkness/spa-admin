#[test]
fn no_delete_command_exists() {
    let sources = [
        include_str!("commands.rs"),
        include_str!("service.rs"),
        include_str!("repository.rs"),
    ]
    .join("\n")
    .to_lowercase();

    for forbidden in [
        "fn delete",
        "fn remove",
        "delete from users",
        "delete from roles",
    ] {
        assert!(!sources.contains(forbidden), "{forbidden}");
    }
}
