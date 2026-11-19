use super::tests::{add_user, credentials, migrated, OWNER_ROLE_ID, PASSWORD};
use super::*;

const COMPOSED_USERNAME: &str = "jos\u{00E9}";
const DECOMPOSED_USERNAME: &str = "jose\u{0301}";

#[test]
fn validated_username_unifies_composed_and_decomposed_forms() {
    let composed = validated_username(&credentials(COMPOSED_USERNAME, PASSWORD)).unwrap();
    let decomposed = validated_username(&credentials(DECOMPOSED_USERNAME, PASSWORD)).unwrap();
    assert_eq!(composed, decomposed);
    assert_eq!(composed, COMPOSED_USERNAME);
}

#[test]
fn login_resolves_same_user_for_composed_and_decomposed_username() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    add_user(&conn, &policy, COMPOSED_USERNAME, PASSWORD, OWNER_ROLE_ID);
    let from_composed = login(&conn, &policy, &credentials(COMPOSED_USERNAME, PASSWORD)).unwrap();
    let from_decomposed =
        login(&conn, &policy, &credentials(DECOMPOSED_USERNAME, PASSWORD)).unwrap();
    assert_eq!(from_composed.id, from_decomposed.id);
}

const FORBIDDEN_INSIDE: [&str; 14] = [
    "an\u{200B}a",
    "an\u{200D}a",
    "an\u{FEFF}a",
    "an\u{00AD}a",
    "an\u{202E}a",
    "an\u{2066}a",
    "an\u{061C}a",
    "an\u{0007}a",
    "an\ta",
    "an\u{2028}a",
    "an\u{2029}a",
    "an\u{00A0}a",
    "an\u{3000}a",
    "an\u{2003}a",
];

#[test]
fn normalized_username_rejects_control_format_and_non_ascii_space_characters() {
    for candidate in FORBIDDEN_INSIDE {
        assert_eq!(normalized_username(candidate), None, "{candidate:?}");
    }
}

#[test]
fn normalized_username_keeps_a_single_ascii_space_and_accented_letters() {
    assert_eq!(
        normalized_username("mar\u{00ED}a jos\u{00E9}"),
        Some("mar\u{00ED}a jos\u{00E9}".to_string())
    );
}

#[test]
fn normalized_username_still_trims_edge_whitespace_of_any_kind() {
    assert_eq!(
        normalized_username("\u{00A0} ana\u{3000}\t"),
        Some("ana".to_string())
    );
}

#[test]
fn login_with_hidden_characters_is_invalid_credentials() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    add_user(&conn, &policy, "ana", PASSWORD, OWNER_ROLE_ID);

    let result = login(&conn, &policy, &credentials("an\u{200B}a", PASSWORD));

    assert!(matches!(result, Err(AuthError::InvalidCredentials)));
}

#[test]
fn login_works_with_the_normalized_form_of_an_accented_username() {
    let conn = migrated();
    let policy = PasswordPolicy::new().unwrap();
    let id = add_user(&conn, &policy, "\u{00F3}scar", PASSWORD, OWNER_ROLE_ID);

    let user = login(&conn, &policy, &credentials("o\u{0301}scar", PASSWORD)).unwrap();

    assert_eq!(user.id, id);
}
