use rusqlite::Connection;

use super::*;
use crate::db::migrate;
use crate::features::audit::{AuditAction, AuditEntity};

fn migrated() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn seed_service(conn: &Connection, name: &str) -> i64 {
    conn.execute(
        "INSERT INTO services (name, name_key, price_cents, duration_min) VALUES (?1, ?2, 100, 30)",
        rusqlite::params![name, name_key(name)],
    )
    .unwrap();
    conn.last_insert_rowid()
}

fn seed_resource(conn: &Connection, name: &str) -> i64 {
    conn.execute(
        "INSERT INTO resources (name, name_key, kind) VALUES (?1, ?2, 'cabin')",
        rusqlite::params![name, name_key(name)],
    )
    .unwrap();
    conn.last_insert_rowid()
}

#[test]
fn valid_name_trims_collapses_spaces_and_composes_to_nfc() {
    assert_eq!(valid_name("  Sala   Sur  "), Some("Sala Sur".to_string()));
    assert_eq!(valid_name("Cafe\u{301}"), Some("Caf\u{e9}".to_string()));
}

#[test]
fn valid_name_accepts_exactly_eighty_characters_and_rejects_more() {
    assert!(valid_name(&"a".repeat(80)).is_some());
    assert_eq!(valid_name(&"a".repeat(81)), None);
}

#[test]
fn valid_name_counts_characters_not_bytes() {
    assert!(valid_name(&"\u{e9}".repeat(80)).is_some());
    assert_eq!(valid_name(&"\u{e9}".repeat(81)), None);
}

#[test]
fn valid_name_measures_the_length_after_composing_to_nfc() {
    let decomposed = "Cafe\u{301}".repeat(20);
    let composed = "Caf\u{e9}".repeat(20);
    assert_eq!(composed.chars().count(), 80);
    assert!(decomposed.chars().count() > 80);

    assert_eq!(valid_name(&decomposed), Some(composed));
}

#[test]
fn record_change_stores_the_diff_as_json() {
    let conn = migrated();
    conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();

    record_change(
        &conn,
        7,
        AuditAction::Create,
        AuditEntity::Resource,
        3,
        Diff::created(&serde_json::json!({ "name": "Sala" })),
    )
    .unwrap();

    let stored: Option<String> = conn
        .query_row("SELECT diff FROM audit_log", [], |row| row.get(0))
        .unwrap();
    let stored: serde_json::Value = serde_json::from_str(&stored.unwrap()).unwrap();
    assert_eq!(stored, serde_json::json!({ "name": "Sala" }));
}

#[test]
fn valid_name_rejects_blank_and_control_characters() {
    assert_eq!(valid_name(""), None);
    assert_eq!(valid_name("   "), None);
    assert_eq!(valid_name("Sala\u{0}"), None);
    assert_eq!(valid_name("Sala\nSur"), None);
}

#[test]
fn name_key_unifies_case_width_and_normalization_forms() {
    assert_eq!(name_key("Sala"), name_key("SALA"));
    assert_eq!(name_key("\u{FF33}ala"), name_key("Sala"));
    assert_eq!(name_key("Cafe\u{301}"), name_key("CAF\u{c9}"));
    assert_eq!(name_key("\u{FB01}nal"), name_key("FINAL"));
    assert_ne!(name_key("Sala"), name_key("Salas"));
}

#[test]
fn name_taken_matches_folded_names_and_can_exclude_one_id() {
    let conn = migrated();
    let id = seed_service(&conn, "Masaje");

    assert!(name_taken(&conn, NamedTable::Services, "MASAJE", None).unwrap());
    assert!(!name_taken(&conn, NamedTable::Services, "masaje", Some(id)).unwrap());
    assert!(!name_taken(&conn, NamedTable::Services, "Facial", None).unwrap());
}

#[test]
fn name_taken_only_looks_at_the_requested_table() {
    let conn = migrated();
    seed_service(&conn, "Compartido");
    seed_resource(&conn, "Solo recurso");

    assert!(!name_taken(&conn, NamedTable::Resources, "Compartido", None).unwrap());
    assert!(name_taken(&conn, NamedTable::Resources, "solo recurso", None).unwrap());
    assert!(!name_taken(&conn, NamedTable::Services, "Solo recurso", None).unwrap());
}

#[test]
fn record_change_stores_actor_action_entity_and_id() {
    let conn = migrated();
    conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();

    record_change(
        &conn,
        7,
        AuditAction::Create,
        AuditEntity::Resource,
        3,
        None,
    )
    .unwrap();

    let stored: (Option<i64>, String, String, Option<i64>) = conn
        .query_row(
            "SELECT actor_user_id, action, entity, entity_id FROM audit_log",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(
        stored,
        (
            Some(7),
            AuditAction::Create.as_str().to_string(),
            AuditEntity::Resource.as_str().to_string(),
            Some(3)
        )
    );
}

const FORBIDDEN_SLICES: [&str; 3] = ["catalog", "resources", "users"];
const FORBIDDEN_AUTH_MODULES: [&str; 2] = ["service", "model"];
const SLICE_ROOTS: [&str; 2] = ["features", "super"];

fn tokenize(source: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut chars = source.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
        } else if c.is_alphanumeric() || c == '_' {
            let mut ident = String::new();
            while let Some(&n) = chars.peek() {
                if !(n.is_alphanumeric() || n == '_') {
                    break;
                }
                ident.push(n);
                chars.next();
            }
            tokens.push(ident);
        } else if c == ':' {
            chars.next();
            if chars.peek() == Some(&':') {
                chars.next();
                tokens.push("::".to_string());
            } else {
                tokens.push(":".to_string());
            }
        } else {
            tokens.push(c.to_string());
            chars.next();
        }
    }
    tokens
}

fn without_aliases(tokens: Vec<String>) -> Vec<String> {
    let mut kept = Vec::new();
    let mut iter = tokens.into_iter();
    while let Some(token) = iter.next() {
        if token == "as" {
            iter.next();
        } else {
            kept.push(token);
        }
    }
    kept
}

fn expand_use_tree(tokens: &[String], at: &mut usize, prefix: &[String]) -> Vec<Vec<String>> {
    let mut path = prefix.to_vec();
    while let Some(token) = tokens.get(*at) {
        match token.as_str() {
            "::" => *at += 1,
            "{" => {
                *at += 1;
                let mut branches = Vec::new();
                while tokens.get(*at).is_some_and(|t| t != "}") {
                    branches.extend(expand_use_tree(tokens, at, &path));
                    if tokens.get(*at).is_some_and(|t| t == ",") {
                        *at += 1;
                    }
                }
                *at += 1;
                return branches;
            }
            ";" | "," | "}" => break,
            _ => {
                path.push(token.clone());
                *at += 1;
            }
        }
    }
    vec![path]
}

fn flatten_use_statements(tokens: &[String]) -> Vec<String> {
    let mut flat = Vec::new();
    let mut at = 0;
    while at < tokens.len() {
        if tokens[at] != "use" {
            flat.push(tokens[at].clone());
            at += 1;
            continue;
        }
        at += 1;
        for path in expand_use_tree(tokens, &mut at, &[]) {
            flat.extend(path.iter().enumerate().flat_map(|(index, segment)| {
                let separator = (index > 0).then(|| "::".to_string());
                separator.into_iter().chain([segment.clone()])
            }));
            flat.push(";".to_string());
        }
    }
    flat
}

fn is_forbidden_step(parent: &str, child: &str) -> bool {
    (SLICE_ROOTS.contains(&parent) && FORBIDDEN_SLICES.contains(&child))
        || (parent == "auth" && FORBIDDEN_AUTH_MODULES.contains(&child))
}

fn forbidden_dependencies(source: &str) -> Vec<String> {
    let tokens = flatten_use_statements(&without_aliases(tokenize(source)));
    tokens
        .windows(3)
        .filter(|window| window[1] == "::" && is_forbidden_step(&window[0], &window[2]))
        .map(|window| format!("{}::{}", window[0], window[2]))
        .collect()
}

fn production_sources(directory: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut sources = Vec::new();
    for entry in std::fs::read_dir(directory).unwrap() {
        let path = entry.unwrap().path();
        let is_test = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with("_test.rs"));
        if path.is_dir() {
            sources.extend(production_sources(&path));
        } else if path.extension().is_some_and(|ext| ext == "rs") && !is_test {
            sources.push(path);
        }
    }
    sources
}

#[test]
fn forbidden_dependencies_catches_plain_and_inline_paths() {
    assert_eq!(
        forbidden_dependencies("use crate::features::catalog::X;"),
        vec!["features::catalog"]
    );
    assert_eq!(
        forbidden_dependencies("fn f() { crate::features::users::repository::find(); }"),
        vec!["features::users"]
    );
    assert_eq!(
        forbidden_dependencies("use super::resources::Y;"),
        vec!["super::resources"]
    );
}

#[test]
fn forbidden_dependencies_catches_grouped_use_trees() {
    assert_eq!(
        forbidden_dependencies("use crate::features::{catalog::X, users::Y};"),
        vec!["features::catalog", "features::users"]
    );
    assert_eq!(
        forbidden_dependencies("use crate::features::{catalog::X};"),
        vec!["features::catalog"]
    );
    assert_eq!(
        forbidden_dependencies("use crate::features::{audit::Z, resources::{self, W}};"),
        vec!["features::resources", "features::resources"]
    );
}

#[test]
fn forbidden_dependencies_catches_auth_internals_in_any_shape() {
    assert_eq!(
        forbidden_dependencies("use crate::features::auth::{model::Z, service::W};"),
        vec!["auth::model", "auth::service"]
    );
    assert_eq!(
        forbidden_dependencies("use crate::features::auth::service::W;"),
        vec!["auth::service"]
    );
}

#[test]
fn forbidden_dependencies_catches_aliased_imports() {
    assert_eq!(
        forbidden_dependencies("use crate::features::auth::model as m;"),
        vec!["auth::model"]
    );
    assert_eq!(
        forbidden_dependencies("use crate::features::catalog as c;"),
        vec!["features::catalog"]
    );
    assert_eq!(
        forbidden_dependencies("use crate::features::{users::Y as Other, audit::Z};"),
        vec!["features::users"]
    );
}

#[test]
fn forbidden_dependencies_catches_imports_split_across_lines() {
    let source = "use crate::features::{\n    audit::Z,\n    catalog\n        ::X,\n};\nuse crate::features\n    ::auth\n    ::{\n        model::Q,\n    };";
    assert_eq!(
        forbidden_dependencies(source),
        vec!["features::catalog", "auth::model"]
    );
}

#[test]
fn forbidden_dependencies_accepts_the_modules_named_records_may_use() {
    let source = "use crate::db::DbError;\nuse crate::features::audit::{self, AuditAction};\nuse crate::features::auth::username::{collapse_ascii_spaces, unicode_casefold};\nuse crate::features::catalogue::X;";
    assert_eq!(forbidden_dependencies(source), Vec::<String>::new());
}

#[test]
fn named_records_production_files_do_not_depend_on_the_slices_that_use_them() {
    let directory =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/features/named_records");
    let sources = production_sources(&directory);
    assert!(sources.iter().any(|path| path.ends_with("mod.rs")));
    for path in sources {
        let violations = forbidden_dependencies(&std::fs::read_to_string(&path).unwrap());
        assert!(violations.is_empty(), "{path:?} imports {violations:?}");
    }
}
