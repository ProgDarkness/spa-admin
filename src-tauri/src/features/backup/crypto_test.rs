use super::*;
use crate::db::migrations::supported_version;
use crate::features::backup::format::{HEADER_LEN, NONCE_LEN, SALT_LEN};

const PASSPHRASE: &str = "frase-secreta-larga";
const PLAINTEXT: &[u8] = b"clave||bytes-de-la-base-de-datos";
const SCHEMA_WITH_FLIPPABLE_BIT: u32 = 3;
const SCHEMA_OFFSET: usize = 10;
const SALT_OFFSET: usize = 26;
const NONCE_OFFSET: usize = SALT_OFFSET + SALT_LEN;
const TAG_LEN: usize = 16;

fn passphrase(raw: &str) -> BackupPassphrase {
    BackupPassphrase::new(raw.to_string()).unwrap()
}

fn sealed(plaintext: &[u8]) -> Vec<u8> {
    seal(
        &passphrase(PASSPHRASE),
        KdfParams::LOWEST_ACCEPTED,
        SCHEMA_WITH_FLIPPABLE_BIT,
        plaintext,
    )
    .unwrap()
}

fn opened_with(raw: &str, file: &[u8]) -> Result<OpenedBackup, BackupError> {
    open(&passphrase(raw), file)
}

fn flipped(mut file: Vec<u8>, index: usize, mask: u8) -> Vec<u8> {
    file[index] ^= mask;
    file
}

#[test]
fn sealed_data_opens_with_the_same_passphrase() {
    let file = sealed(PLAINTEXT);

    let opened = opened_with(PASSPHRASE, &file).unwrap();

    assert_eq!(opened.plaintext.as_slice(), PLAINTEXT);
    assert_eq!(opened.header.schema_version, SCHEMA_WITH_FLIPPABLE_BIT);
    assert_eq!(opened.header.kdf, KdfParams::LOWEST_ACCEPTED);
}

#[test]
fn the_file_is_header_plus_ciphertext_plus_tag() {
    let file = sealed(PLAINTEXT);

    assert_eq!(file.len(), HEADER_LEN + PLAINTEXT.len() + TAG_LEN);
    assert!(!file
        .windows(PLAINTEXT.len())
        .any(|window| window == PLAINTEXT));
}

#[test]
fn every_seal_uses_a_fresh_salt_and_nonce() {
    let first = sealed(PLAINTEXT);
    let second = sealed(PLAINTEXT);

    assert_ne!(
        first[SALT_OFFSET..HEADER_LEN],
        second[SALT_OFFSET..HEADER_LEN]
    );
    assert_ne!(first, second);
}

#[test]
fn a_wrong_passphrase_is_unreadable() {
    let file = sealed(PLAINTEXT);

    let outcome = opened_with("otra-frase-distinta", &file);

    assert!(matches!(outcome, Err(BackupError::Unreadable)));
}

#[test]
fn one_flipped_bit_in_the_authenticated_header_is_unreadable() {
    let file = sealed(PLAINTEXT);

    let schema = flipped(file.clone(), SCHEMA_OFFSET, 0b100);
    let salt = flipped(file.clone(), SALT_OFFSET, 1);
    let nonce = flipped(file, NONCE_OFFSET, 1);

    for tampered in [schema, salt, nonce] {
        assert!(matches!(
            opened_with(PASSPHRASE, &tampered),
            Err(BackupError::Unreadable)
        ));
    }
}

#[test]
fn one_flipped_bit_in_the_ciphertext_or_the_tag_is_unreadable() {
    let file = sealed(PLAINTEXT);
    let first_ciphertext_byte = HEADER_LEN;
    let last_tag_byte = file.len() - 1;

    for index in [first_ciphertext_byte, last_tag_byte] {
        let tampered = flipped(file.clone(), index, 1);
        assert!(matches!(
            opened_with(PASSPHRASE, &tampered),
            Err(BackupError::Unreadable)
        ));
    }
}

#[test]
fn truncated_files_are_unreadable() {
    let file = sealed(PLAINTEXT);

    for removed in [1, TAG_LEN + 1] {
        let truncated = &file[..file.len() - removed];
        assert!(matches!(
            opened_with(PASSPHRASE, truncated),
            Err(BackupError::Unreadable)
        ));
    }
}

#[test]
fn a_file_with_only_the_header_is_unreadable() {
    let file = sealed(PLAINTEXT);

    assert!(matches!(
        opened_with(PASSPHRASE, &file[..HEADER_LEN]),
        Err(BackupError::Unreadable)
    ));
}

#[test]
fn bytes_that_are_not_a_backup_are_not_recognized() {
    assert!(matches!(
        opened_with(PASSPHRASE, b"%PDF-1.7 not a backup"),
        Err(BackupError::NotRecognized)
    ));
}

#[test]
fn a_header_from_a_newer_app_is_rejected_before_deriving_any_key() {
    let mut file = sealed(PLAINTEXT);
    file[SCHEMA_OFFSET..SCHEMA_OFFSET + 4]
        .copy_from_slice(&(supported_version() + 1).to_le_bytes());

    assert!(matches!(
        opened_with(PASSPHRASE, &file),
        Err(BackupError::FromNewerApp)
    ));
}

#[test]
fn decomposed_and_composed_forms_of_a_passphrase_are_equivalent() {
    let composed = "contraseña-larga";
    let decomposed = "contrasen\u{303}a-larga";
    assert_ne!(composed, decomposed);
    let file = seal(
        &passphrase(decomposed),
        KdfParams::LOWEST_ACCEPTED,
        1,
        PLAINTEXT,
    )
    .unwrap();

    let opened = opened_with(composed, &file).unwrap();

    assert_eq!(opened.plaintext.as_slice(), PLAINTEXT);
}

#[test]
fn a_passphrase_of_eleven_code_points_is_rejected() {
    let outcome = BackupPassphrase::new("a".repeat(11));

    assert!(matches!(
        outcome,
        Err(BackupError::Validation {
            field: "passphrase"
        })
    ));
}

#[test]
fn a_passphrase_of_twelve_code_points_is_accepted() {
    assert!(BackupPassphrase::new("a".repeat(12)).is_ok());
}

#[test]
fn the_minimum_counts_code_points_after_composition() {
    let eleven_letters_written_decomposed = "n\u{303}".repeat(11);

    assert!(matches!(
        BackupPassphrase::new(eleven_letters_written_decomposed),
        Err(BackupError::Validation {
            field: "passphrase"
        })
    ));
}

#[test]
fn a_passphrase_of_1024_bytes_is_accepted_and_1025_is_rejected() {
    assert!(BackupPassphrase::new("a".repeat(1024)).is_ok());
    assert!(matches!(
        BackupPassphrase::new("a".repeat(1025)),
        Err(BackupError::Validation {
            field: "passphrase"
        })
    ));
}

#[test]
fn the_limit_counts_bytes_not_code_points() {
    let five_hundred_thirteen_two_byte_letters = "ñ".repeat(513);

    assert!(matches!(
        BackupPassphrase::new(five_hundred_thirteen_two_byte_letters),
        Err(BackupError::Validation {
            field: "passphrase"
        })
    ));
}

#[test]
fn debug_output_never_reveals_the_passphrase() {
    let rendered = format!("{:?}", passphrase(PASSPHRASE));

    assert!(!rendered.contains(PASSPHRASE));
    assert!(rendered.contains("redacted"));
}

#[test]
fn nonce_and_salt_lengths_match_the_format() {
    assert_eq!(SALT_LEN, 16);
    assert_eq!(NONCE_LEN, 24);
}

#[test]
fn composition_that_expands_the_text_grows_into_a_zeroized_buffer_with_the_same_result() {
    let raw = "\u{0344}".repeat(40);
    let expected: String = raw.nfc().collect();

    let composed = composed_without_stray_copies(&raw);

    assert_eq!(*composed, expected);
    assert!(composed.len() > raw.len());
}

#[test]
fn composition_of_plain_ascii_is_unchanged() {
    let composed = composed_without_stray_copies("frase-de-respaldo-larga");

    assert_eq!(*composed, "frase-de-respaldo-larga");
}
