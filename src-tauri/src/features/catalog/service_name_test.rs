use super::tests::{
    audit_rows, create, diff_of, fixture, input, is_field, run, service_count, stored, update_of,
    Fixture,
};
use super::*;

fn rename(
    fixture: &Fixture,
    service: &ServiceSummary,
    name: &str,
) -> Result<ServiceSummary, CatalogError> {
    run(fixture, |conn| {
        update_service(
            conn,
            fixture.actor,
            &ServiceUpdate {
                name: name.to_string(),
                ..update_of(service)
            },
        )
    })
}

fn try_create(fixture: &Fixture, name: &str) -> Result<ServiceSummary, CatalogError> {
    run(fixture, |conn| {
        create_service(conn, fixture.actor, &input(name))
    })
}

fn stored_name_key(fixture: &Fixture, id: i64) -> String {
    fixture
        .database
        .with_conn(|conn| {
            Ok(
                conn.query_row("SELECT name_key FROM services WHERE id = ?1", [id], |row| {
                    row.get(0)
                })?,
            )
        })
        .unwrap()
}

#[test]
fn inner_space_runs_collide_with_the_single_spaced_name_on_create_and_rename() {
    let fixture = fixture();
    create(&fixture, "Masaje relajante");
    let facial = create(&fixture, "Facial");
    let audits_before = audit_rows(&fixture).len();

    let on_create = try_create(&fixture, "Masaje  relajante").unwrap_err();
    let on_rename = rename(&fixture, &facial, "Masaje   relajante").unwrap_err();

    assert!(is_field(on_create, "name"));
    assert!(is_field(on_rename, "name"));
    assert_eq!(service_count(&fixture), 2);
    assert_eq!(audit_rows(&fixture).len(), audits_before);
}

#[test]
fn inner_space_runs_are_stored_collapsed_with_a_matching_name_key() {
    let fixture = fixture();

    let created = try_create(&fixture, "  Masaje   Relajante  ").unwrap();
    let renamed = rename(&fixture, &created, "Masaje    Profundo").unwrap();

    assert_eq!(created.name, "Masaje Relajante");
    assert_eq!(
        diff_of(&audit_rows(&fixture)[0])["name"],
        "Masaje Relajante"
    );
    assert_eq!(renamed.name, "Masaje Profundo");
    assert_eq!(stored(&fixture, renamed.id).name, "Masaje Profundo");
    assert_eq!(stored_name_key(&fixture, renamed.id), "masaje profundo");
}

#[test]
fn tabs_newlines_and_unicode_spaces_between_words_are_still_rejected() {
    let fixture = fixture();
    let existing = create(&fixture, "Facial");

    for name in [
        "Masaje\t relajante",
        "Masaje \nrelajante",
        "Masaje\u{00A0}\u{00A0}relajante",
        "Masaje \u{3000} relajante",
    ] {
        assert!(
            is_field(try_create(&fixture, name).unwrap_err(), "name"),
            "{name:?}"
        );
        assert!(
            is_field(rename(&fixture, &existing, name).unwrap_err(), "name"),
            "{name:?}"
        );
    }
    assert_eq!(service_count(&fixture), 1);
}

#[test]
fn the_length_limit_applies_after_collapsing_inner_spaces() {
    let fixture = fixture();
    let fits_after_collapse = format!("{}   {}", "a".repeat(40), "b".repeat(39));
    let too_long_after_collapse = format!("{}   {}", "c".repeat(40), "d".repeat(40));

    let accepted = try_create(&fixture, &fits_after_collapse).unwrap();
    let rejected = try_create(&fixture, &too_long_after_collapse).unwrap_err();

    assert_eq!(accepted.name.chars().count(), 80);
    assert!(is_field(rejected, "name"));
}

#[test]
fn collapsing_composes_with_nfc_normalization() {
    let fixture = fixture();

    let created = try_create(&fixture, "Cafe\u{301}   relajante").unwrap();

    assert_eq!(created.name, "Caf\u{e9} relajante");
}

#[test]
fn renaming_to_the_same_name_with_extra_spaces_changes_nothing() {
    let fixture = fixture();
    let created = create(&fixture, "Masaje relajante");
    let audits_before = audit_rows(&fixture).len();

    let unchanged = rename(&fixture, &created, "Masaje   relajante").unwrap();

    assert_eq!(unchanged, created);
    assert_eq!(audit_rows(&fixture).len(), audits_before);
}
