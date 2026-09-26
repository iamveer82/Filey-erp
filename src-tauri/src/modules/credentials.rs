//! Per-account/org credentials in the OS secure store, never kv_cache.
use crate::error::{AppError, AppResult};
use sha2::{Digest, Sha256};

fn entry(scope: &str, name: &str) -> AppResult<keyring::Entry> {
    if !scope.contains(":user:") || scope.len() > 512 || name.is_empty() || name.len() > 512 || name.chars().any(char::is_control) {
        return Err(AppError::Io("A signed-in workspace and valid credential name are required.".into()));
    }
    let target = format!("{:x}",Sha256::digest(format!("{scope}\0{name}")));
    keyring::Entry::new("filey-credentials",&target).map_err(|e|AppError::Io(e.to_string()))
}

pub fn read(scope: &str, name: &str) -> AppResult<Option<String>> {
    match entry(scope,name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(AppError::Io(format!("Secure storage is unavailable: {error}"))),
    }
}

#[tauri::command]
pub async fn credential_read(scope: String, name: String) -> AppResult<Option<String>> { read(&scope,&name) }

#[tauri::command]
pub async fn credential_write(scope: String, name: String, value: Option<String>) -> AppResult<()> {
    let entry = entry(&scope,&name)?;
    match value {
        Some(value) if !value.is_empty() => entry.set_password(&value).map_err(|e|AppError::Io(e.to_string())),
        _ => match entry.delete_password() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(AppError::Io(error.to_string())),
        },
    }
}

// Preserve unscoped legacy keys without assigning them to the next signed-in
// account. No application read command exposes this separate recovery vault.
#[tauri::command]
pub async fn credential_quarantine(name: String, value: String) -> AppResult<()> {
    quarantine(&name, &value)
}

pub fn quarantine(name: &str, value: &str) -> AppResult<()> {
    if name.len()>512 || value.len()>65536 { return Err(AppError::Io("Invalid legacy credential".into())); }
    let id = format!("{:x}",Sha256::digest(format!("{name}\0{value}")));
    keyring::Entry::new("filey-legacy-credentials",&id).map_err(|e|AppError::Io(e.to_string()))?
        .set_password(value).map_err(|e|AppError::Io(e.to_string()))
}
