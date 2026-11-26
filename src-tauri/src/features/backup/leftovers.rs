use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Leftover {
    Restoring,
    Prev,
    Failed,
}

const STAMP_DIGITS: usize = 16;
const SIDECAR_SUFFIXES: [&str; 3] = ["-journal", "-wal", "-shm"];

impl Leftover {
    fn suffix(self) -> &'static str {
        match self {
            Self::Restoring => "restoring",
            Self::Prev => "prev",
            Self::Failed => "failed",
        }
    }
}

pub(crate) fn stamp_now() -> io::Result<String> {
    let epoch_millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_millis();
    Ok(format!("{epoch_millis:0width$}", width = STAMP_DIGITS))
}

fn database_file_name(database_path: &Path) -> io::Result<&str> {
    database_path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid database path"))
}

pub(crate) fn path_for(database_path: &Path, stamp: &str, kind: Leftover) -> PathBuf {
    let base = database_path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    database_path.with_file_name(format!("{base}.{stamp}.{}", kind.suffix()))
}

pub(crate) fn find(database_path: &Path, kind: Leftover) -> io::Result<Vec<PathBuf>> {
    let prefix = format!("{}.", database_file_name(database_path)?);
    let suffix = format!(".{}", kind.suffix());
    let directory = database_path.parent().unwrap_or_else(|| Path::new("."));
    let mut found = fs::read_dir(directory)?
        .map(|entry| entry.map(|item| item.path()))
        .collect::<io::Result<Vec<PathBuf>>>()?
        .into_iter()
        .filter(|path| is_leftover_name(path, &prefix, &suffix))
        .collect::<Vec<PathBuf>>();
    found.sort();
    Ok(found)
}

pub(crate) fn find_sidecars(database_path: &Path, kind: Leftover) -> io::Result<Vec<PathBuf>> {
    let prefix = format!("{}.", database_file_name(database_path)?);
    let directory = database_path.parent().unwrap_or_else(|| Path::new("."));
    let mut found = Vec::new();
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        let is_sidecar = SIDECAR_SUFFIXES.iter().any(|sidecar| {
            is_leftover_name(&path, &prefix, &format!(".{}{sidecar}", kind.suffix()))
        });
        if is_sidecar {
            found.push(path);
        }
    }
    found.sort();
    Ok(found)
}

pub(crate) fn discard_with_sidecars(path: &Path) -> io::Result<()> {
    let sidecars = SIDECAR_SUFFIXES
        .iter()
        .map(|suffix| PathBuf::from(format!("{}{suffix}", path.display())));
    let mut first_failure = None;
    for target in std::iter::once(path.to_path_buf()).chain(sidecars) {
        match fs::remove_file(&target) {
            Err(failure) if failure.kind() != io::ErrorKind::NotFound => {
                first_failure.get_or_insert(failure);
            }
            _ => {}
        }
    }
    first_failure.map_or(Ok(()), Err)
}

fn is_leftover_name(path: &Path, prefix: &str, suffix: &str) -> bool {
    path.file_name()
        .and_then(OsStr::to_str)
        .and_then(|name| name.strip_prefix(prefix))
        .and_then(|rest| rest.strip_suffix(suffix))
        .is_some_and(|stamp| {
            stamp.len() == STAMP_DIGITS && stamp.bytes().all(|byte| byte.is_ascii_digit())
        })
}

pub(crate) fn report_cleanup<E: std::fmt::Debug>(what: &str, outcome: Result<(), E>) {
    if let Err(failure) = outcome {
        eprintln!("backup: cleanup of {what} failed: {failure:?}");
    }
}

#[cfg(test)]
#[path = "leftovers_test.rs"]
mod tests;
