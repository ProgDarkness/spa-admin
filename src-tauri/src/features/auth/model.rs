use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

#[derive(Serialize, Deserialize, specta::Type, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PermissionKey {
    #[serde(rename = "clients.read")]
    ClientsRead,
    #[serde(rename = "clients.write")]
    ClientsWrite,
    #[serde(rename = "catalog.read")]
    CatalogRead,
    #[serde(rename = "catalog.write")]
    CatalogWrite,
    #[serde(rename = "resources.manage")]
    ResourcesManage,
    #[serde(rename = "appointments.read")]
    AppointmentsRead,
    #[serde(rename = "appointments.write")]
    AppointmentsWrite,
    #[serde(rename = "appointments.reopen")]
    AppointmentsReopen,
    #[serde(rename = "payments.read")]
    PaymentsRead,
    #[serde(rename = "payments.write")]
    PaymentsWrite,
    #[serde(rename = "rates.manage")]
    RatesManage,
    #[serde(rename = "metrics.read")]
    MetricsRead,
    #[serde(rename = "audit.read")]
    AuditRead,
    #[serde(rename = "users.manage")]
    UsersManage,
    #[serde(rename = "backup.manage")]
    BackupManage,
}

impl PermissionKey {
    pub const ALL: [Self; 15] = [
        Self::ClientsRead,
        Self::ClientsWrite,
        Self::CatalogRead,
        Self::CatalogWrite,
        Self::ResourcesManage,
        Self::AppointmentsRead,
        Self::AppointmentsWrite,
        Self::AppointmentsReopen,
        Self::PaymentsRead,
        Self::PaymentsWrite,
        Self::RatesManage,
        Self::MetricsRead,
        Self::AuditRead,
        Self::UsersManage,
        Self::BackupManage,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ClientsRead => "clients.read",
            Self::ClientsWrite => "clients.write",
            Self::CatalogRead => "catalog.read",
            Self::CatalogWrite => "catalog.write",
            Self::ResourcesManage => "resources.manage",
            Self::AppointmentsRead => "appointments.read",
            Self::AppointmentsWrite => "appointments.write",
            Self::AppointmentsReopen => "appointments.reopen",
            Self::PaymentsRead => "payments.read",
            Self::PaymentsWrite => "payments.write",
            Self::RatesManage => "rates.manage",
            Self::MetricsRead => "metrics.read",
            Self::AuditRead => "audit.read",
            Self::UsersManage => "users.manage",
            Self::BackupManage => "backup.manage",
        }
    }

    pub fn parse(candidate: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|key| key.as_str() == candidate)
    }
}

#[derive(Serialize, specta::Type, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
    pub id: i64,
    pub username: String,
    pub role_name: String,
    pub permissions: Vec<PermissionKey>,
}

#[derive(Deserialize, specta::Type)]
pub struct LoginCredentials {
    pub username: String,
    pub password: String,
}

impl LoginCredentials {
    pub(crate) fn wipe(&mut self) {
        self.password.zeroize();
    }
}

impl Drop for LoginCredentials {
    fn drop(&mut self) {
        self.wipe();
    }
}

#[cfg(test)]
#[path = "model_test.rs"]
mod tests;
