use super::*;
use crate::db::migrations::supported_version;

fn valid_header() -> BackupHeader {
    BackupHeader {
        schema_version: supported_version(),
        kdf: KdfParams::EXPORT,
        salt: [7; SALT_LEN],
        nonce: [9; NONCE_LEN],
    }
}

fn encoded_with(edit: impl FnOnce(&mut [u8])) -> Vec<u8> {
    let mut bytes = valid_header().encode().to_vec();
    edit(&mut bytes);
    bytes
}

fn put_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

#[test]
fn header_is_66_bytes_with_the_documented_layout() {
    let bytes = valid_header().encode();

    assert_eq!(bytes.len(), 66);
    assert_eq!(&bytes[..8], b"SPABAK\0\0");
    assert_eq!(&bytes[8..10], &1u16.to_le_bytes());
    assert_eq!(&bytes[10..14], &supported_version().to_le_bytes());
    assert_eq!(&bytes[14..18], &65536u32.to_le_bytes());
    assert_eq!(&bytes[18..22], &3u32.to_le_bytes());
    assert_eq!(&bytes[22..26], &1u32.to_le_bytes());
    assert_eq!(&bytes[26..42], &[7u8; 16]);
    assert_eq!(&bytes[42..66], &[9u8; 24]);
}

#[test]
fn header_roundtrips_through_encode_and_parse() {
    let original = valid_header();

    let parsed = BackupHeader::parse(&original.encode()).unwrap();

    assert_eq!(parsed, original);
}

#[test]
fn parse_ignores_the_encrypted_body_after_the_header() {
    let mut file = valid_header().encode().to_vec();
    file.extend_from_slice(&[1, 2, 3]);

    assert_eq!(BackupHeader::parse(&file).unwrap(), valid_header());
}

#[test]
fn wrong_magic_is_not_recognized() {
    let bytes = encoded_with(|bytes| bytes[0] = b'X');

    assert!(matches!(
        BackupHeader::parse(&bytes),
        Err(BackupError::NotRecognized)
    ));
}

#[test]
fn files_shorter_than_the_header_are_not_recognized() {
    let full = valid_header().encode();

    for length in [0, 1, 8, 65] {
        assert!(
            matches!(
                BackupHeader::parse(&full[..length]),
                Err(BackupError::NotRecognized)
            ),
            "{length}"
        );
    }
}

#[test]
fn an_unknown_format_version_is_not_recognized() {
    let bytes = encoded_with(|bytes| bytes[8..10].copy_from_slice(&2u16.to_le_bytes()));

    assert!(matches!(
        BackupHeader::parse(&bytes),
        Err(BackupError::NotRecognized)
    ));
}

#[test]
fn kdf_parameters_outside_the_accepted_range_are_not_recognized() {
    let out_of_range = [
        (14, 19455),
        (14, 131073),
        (14, 262144),
        (18, 0),
        (18, 7),
        (18, 10),
        (22, 0),
        (22, 5),
    ];

    for (offset, value) in out_of_range {
        let bytes = encoded_with(|bytes| put_u32(bytes, offset, value));
        assert!(
            matches!(BackupHeader::parse(&bytes), Err(BackupError::NotRecognized)),
            "offset {offset} value {value}"
        );
    }
}

#[test]
fn kdf_parameters_at_the_range_edges_are_accepted() {
    let edges = [
        (14, 19456),
        (14, 131072),
        (18, 1),
        (18, 6),
        (22, 1),
        (22, 4),
    ];

    for (offset, value) in edges {
        let bytes = encoded_with(|bytes| put_u32(bytes, offset, value));
        assert!(
            BackupHeader::parse(&bytes).is_ok(),
            "offset {offset} value {value}"
        );
    }
}

#[test]
fn schema_version_zero_is_not_recognized() {
    let bytes = encoded_with(|bytes| put_u32(bytes, 10, 0));

    assert!(matches!(
        BackupHeader::parse(&bytes),
        Err(BackupError::NotRecognized)
    ));
}

#[test]
fn a_schema_one_above_the_supported_one_comes_from_a_newer_app() {
    let bytes = encoded_with(|bytes| put_u32(bytes, 10, supported_version() + 1));

    assert!(matches!(
        BackupHeader::parse(&bytes),
        Err(BackupError::FromNewerApp)
    ));
}

#[test]
fn the_oldest_schema_is_accepted() {
    let bytes = encoded_with(|bytes| put_u32(bytes, 10, 1));

    assert_eq!(BackupHeader::parse(&bytes).unwrap().schema_version, 1);
}

#[test]
fn a_file_of_exactly_the_maximum_size_is_accepted() {
    assert!(require_acceptable_size(MAX_BACKUP_BYTES).is_ok());
}

#[test]
fn a_file_above_the_maximum_size_is_not_recognized() {
    assert!(matches!(
        require_acceptable_size(MAX_BACKUP_BYTES + 1),
        Err(BackupError::NotRecognized)
    ));
}

#[test]
fn the_maximum_size_is_256_mebibytes() {
    assert_eq!(MAX_BACKUP_BYTES, 268_435_456);
}
