use serde_json::json;

use super::*;
use crate::db::DbError;
use crate::errors::AppErrorCode;
use crate::features::auth::service::AuthError;

#[test]
fn inputs_deserialize_from_camel_case() {
    let input: ClientInput = serde_json::from_str(
        r#"{"firstName":"Ana","lastName":"Pérez","nationalId":"V-12345678","phone":"0414-1234567"}"#,
    )
    .unwrap();
    let update: ClientUpdate = serde_json::from_str(
        r#"{"id":4,"firstName":"Ana","lastName":"Pérez","nationalId":"V-12345678","phone":"0414-1234567"}"#,
    )
    .unwrap();
    let filter: ClientFilter =
        serde_json::from_str(r#"{"query":"ana","includeDeleted":true}"#).unwrap();
    let deletion: ClientDeletion = serde_json::from_str(r#"{"id":4,"deleted":true}"#).unwrap();

    assert_eq!(
        input,
        ClientInput {
            first_name: "Ana".into(),
            last_name: "Pérez".into(),
            national_id: "V-12345678".into(),
            phone: "0414-1234567".into()
        }
    );
    assert_eq!(update.id, 4);
    assert_eq!(update.national_id, "V-12345678");
    assert_eq!(
        filter,
        ClientFilter {
            query: "ana".into(),
            include_deleted: true
        }
    );
    assert_eq!(
        deletion,
        ClientDeletion {
            id: 4,
            deleted: true
        }
    );
}

#[test]
fn inputs_reject_unknown_or_missing_fields_and_wrong_types() {
    assert!(serde_json::from_str::<ClientFilter>(r#"{"query":"ana"}"#).is_err());
    assert!(serde_json::from_str::<ClientDeletion>(r#"{"id":"4","deleted":true}"#).is_err());
    assert!(serde_json::from_str::<ClientInput>(r#"{"firstName":"Ana"}"#).is_err());
}

#[test]
fn summary_serializes_camel_case_with_a_null_deleted_at_when_active() {
    let summary = ClientSummary {
        id: 3,
        first_name: "Ana".into(),
        last_name: "Pérez".into(),
        national_id: "V-16789012".into(),
        phone: "0412-3456789".into(),
        deleted_at: None,
    };

    assert_eq!(
        serde_json::to_value(summary).unwrap(),
        json!({
            "id": 3,
            "firstName": "Ana",
            "lastName": "Pérez",
            "nationalId": "V-16789012",
            "phone": "0412-3456789",
            "deletedAt": null
        })
    );
}

#[test]
fn validation_failures_become_validation_errors_with_the_field() {
    let error = AppError::from(ClientError::Validation {
        field: "nationalId",
    });

    assert_eq!(error.code, AppErrorCode::Validation);
    assert_eq!(error.field.as_deref(), Some("nationalId"));
}

#[test]
fn not_found_becomes_the_not_found_error() {
    assert_eq!(AppError::from(ClientError::NotFound), AppError::not_found());
}

#[test]
fn a_taken_national_id_becomes_the_national_id_taken_error() {
    assert_eq!(
        AppError::from(ClientError::NationalIdTaken),
        AppError::national_id_taken()
    );
}

#[test]
fn a_deleted_holder_becomes_the_reactivate_error_with_its_id() {
    let error = AppError::from(ClientError::DeletedHolder { client_id: 9 });

    assert_eq!(error, AppError::client_deleted_reactivate(9));
    assert_eq!(error.entity_ids, Some(vec![9]));
}

#[test]
fn database_failures_become_the_generic_internal_error() {
    let error = AppError::from(ClientError::Db(DbError::OperationPanicked));

    assert_eq!(error, AppError::internal());
}

#[test]
fn auth_failures_keep_their_own_error() {
    assert_eq!(
        AppError::from(ClientError::Auth(AuthError::Forbidden)),
        AppError::forbidden()
    );
}
