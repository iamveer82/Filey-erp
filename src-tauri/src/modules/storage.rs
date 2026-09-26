// User-chosen storage locations.
//  - The local database (filey-erp.db) folder, persisted in a pointer file so
//    it survives restarts and is read before the DB opens.
//  - Writing generated documents (PDFs) as real files to a folder of the
//    user's choosing.

use crate::db::Db;
use crate::error::{AppError, AppResult};
use std::fs;
use std::path::PathBuf;
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use tauri::{AppHandle, Manager, State};

// One gate for file writes and workspace snapshots. SQLite writes are excluded
// by Db's connection mutex while the matching file tree is copied.
static STORAGE_OPERATION: Mutex<()> = Mutex::new(());
static RESTART_PENDING: AtomicBool = AtomicBool::new(false);
static RECOVERY_ERROR: Mutex<Option<String>> = Mutex::new(None);
#[path = "storage_backup.rs"]
mod backup;

fn ensure_writable() -> AppResult<()> {
    if RESTART_PENDING.load(Ordering::SeqCst) {
        return Err(AppError::Io("Restart Filey to finish changing storage before saving more records.".into()));
    }
    Ok(())
}

fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temp, path)
    })();
    if result.is_err() { let _ = fs::remove_file(temp); }
    result
}

fn validate_database(path: &std::path::Path) -> AppResult<()> {
    let conn = rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" { return Err(AppError::Io("The backup database did not pass its integrity check.".into())); }
    let has_cache: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='kv_cache')", [], |row| row.get(0))?;
    if !has_cache { return Err(AppError::Io("This is not a Filey workspace database.".into())); }
    Ok(())
}

fn validate_workspace(directory: &std::path::Path) -> AppResult<()> {
    use rusqlite::OptionalExtension;
    let path = directory.join("filey-erp.db");
    validate_database(&path)?;
    let conn = rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let raw: Option<String> = conn.query_row("SELECT value FROM kv_cache WHERE key='localdb:user_files'",[],|row|row.get(0)).optional()?;
    if let Some(raw) = raw.filter(|value| !value.is_empty()) {
        let rows: Vec<serde_json::Value> = serde_json::from_str(&raw).map_err(|_|AppError::Io("The saved file index is damaged.".into()))?;
        for row in rows {
            let name = row.get("storage_path").and_then(|v|v.as_str()).ok_or_else(||AppError::Io("A saved file is missing its storage path.".into()))?;
            if name.split('/').any(|part|part=="..") { return Err(AppError::Io("The saved file index contains an unsafe path.".into())); }
            let mut file = directory.join("files");
            for part in name.split('/').filter(|part| !part.is_empty() && *part!=".") { file.push(sanitize(part)); }
            if !file.is_file() {
                let legacy: Option<String> = conn.query_row("SELECT value FROM kv_cache WHERE key=?1",[format!("fileblob:{name}")],|row|row.get(0)).optional()?;
                if legacy.as_deref().is_none_or(|value|value.is_empty()) {
                    return Err(AppError::Io("A saved file is missing. The active workspace was not replaced.".into()));
                }
            }
        }
    }
    Ok(())
}

fn queue_workspace(app: &AppHandle, conn: &rusqlite::Connection, target: &std::path::Path) -> AppResult<()> {
    conn.pragma_update(None,"query_only",true)?;
    if let Err(error) = atomic_write(&app_data(app).join("pending_data_dir.txt"),target.to_string_lossy().as_bytes()) {
        conn.pragma_update(None,"query_only",false)?;
        return Err(AppError::Io(error.to_string()));
    }
    RESTART_PENDING.store(true,Ordering::SeqCst);
    Ok(())
}

fn app_data(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("app data dir")
}

fn pointer_file(app: &AppHandle) -> PathBuf {
    app_data(app).join("data_dir.txt")
}

/// Folder that holds filey-erp.db — the user's chosen folder, or the default
/// app-data dir when none is set.
pub fn data_dir(app: &AppHandle) -> PathBuf {
    if let Ok(s) = fs::read_to_string(pointer_file(app)) {
        let p = PathBuf::from(s.trim());
        if !s.trim().is_empty() && p.is_dir() {
            return p;
        }
    }
    app_data(app)
}

/// Full path to the database file. Used at startup before the DB opens.
pub fn resolve_db_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("filey-erp.db")
}

#[tauri::command]
pub fn get_data_dir(app: AppHandle) -> String {
    data_dir(&app).to_string_lossy().to_string()
}

/// Copy a verified workspace; activation happens before opening the DB on restart.
#[tauri::command]
pub async fn set_data_dir(app: AppHandle, dir: String) -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORAGE_OPERATION.lock().map_err(|e| AppError::Io(e.to_string()))?;
        ensure_writable()?;
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
        let target = copy_workspace(&conn, &data_dir(&app), &PathBuf::from(dir))?;
        // Pending native DB requests must fail instead of modifying the old copy
        // after the snapshot. Read-only access remains available until restart.
        queue_workspace(&app,&conn,&target)?;
        Ok(target.join("filey-erp.db").to_string_lossy().to_string())
    }).await.map_err(|e| AppError::Io(e.to_string()))?
}

fn copy_workspace(conn: &rusqlite::Connection, source: &std::path::Path, target: &std::path::Path) -> AppResult<PathBuf> {
    fs::create_dir_all(target).map_err(|e| AppError::Io(e.to_string()))?;
    let target = target.canonicalize().map_err(|e| AppError::Io(e.to_string()))?;
    let source = source.canonicalize().map_err(|e| AppError::Io(e.to_string()))?;
    if target.starts_with(&source) || source.starts_with(&target) {
        return Err(AppError::Io("Choose a separate, empty folder outside the current data folder.".into()));
    }
    if fs::read_dir(&target).map_err(|e| AppError::Io(e.to_string()))?.next().is_some() {
        return Err(AppError::Io("The destination must be empty. Existing files were not replaced.".into()));
    }
    let stage = target.join(format!(".filey-move-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&stage).map_err(|e| AppError::Io(e.to_string()))?;
    let snapshot = stage.join("filey-erp.db");
    conn.execute("VACUUM INTO ?1", [snapshot.to_string_lossy().as_ref()])?;
    if source.join("files").exists() {
        copy_dir_all(&source.join("files"), &stage.join("files")).map_err(|e| AppError::Io(e.to_string()))?;
    } else { fs::create_dir(stage.join("files")).map_err(|e| AppError::Io(e.to_string()))?; }
    validate_workspace(&stage)?;
    // These paths were absent in the checked-empty destination. The active
    // pointer is still untouched if any copy/verification/rename fails.
    fs::rename(stage.join("files"), target.join("files")).map_err(|e| AppError::Io(e.to_string()))?;
    fs::rename(snapshot, target.join("filey-erp.db")).map_err(|e| AppError::Io(e.to_string()))?;
    fs::remove_dir(stage).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(target)
}

pub fn apply_pending_data_dir(app: &AppHandle) -> AppResult<()> {
    activate_data_dir(&pointer_file(app), &app_data(app).join("pending_data_dir.txt"), &app_data(app).join("previous_data_dir.txt"), &data_dir(app))
}

fn activate_data_dir(pointer: &std::path::Path, pending: &std::path::Path, previous: &std::path::Path, current: &std::path::Path) -> AppResult<()> {
    if !pending.exists() { return Ok(()); }
    let target = PathBuf::from(fs::read_to_string(&pending).map_err(|e| AppError::Io(e.to_string()))?);
    validate_workspace(&target)?;
    if current != target {
        atomic_write(previous,current.to_string_lossy().as_bytes()).map_err(|e|AppError::Io(e.to_string()))?;
    }
    atomic_write(pointer, target.to_string_lossy().as_bytes()).map_err(|e| AppError::Io(e.to_string()))?;
    fs::remove_file(pending).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

pub fn recover_storage_startup(app: &AppHandle) {
    if let Err(error) = apply_pending_restore(app).and_then(|_|apply_pending_data_dir(app)) {
        // Failed activation leaves the original pointer intact. Open that
        // workspace and expose the error in Settings instead of a startup loop.
        if let Ok(mut state) = RECOVERY_ERROR.lock() { *state = Some(error.to_string()); }
    }
}

#[tauri::command]
pub fn storage_recovery_status() -> Option<String> {
    RECOVERY_ERROR.lock().ok().and_then(|state|state.clone())
}

#[tauri::command]
pub fn cancel_pending_storage(app: AppHandle) -> AppResult<()> {
    ensure_writable()?;
    for name in ["pending_data_dir.txt","pending_restore.txt"] {
        let path = app_data(&app).join(name);
        if path.exists() { fs::remove_file(path).map_err(|e|AppError::Io(e.to_string()))?; }
    }
    if let Ok(mut state) = RECOVERY_ERROR.lock() { *state = None; }
    Ok(())
}

#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.restart();
}

fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect()
}

/// Write document bytes as a real file into `dir`. Returns the full path.
#[tauri::command]
pub async fn write_doc_file(dir: String, filename: String, bytes: Vec<u8>) -> AppResult<String> {
    let target = PathBuf::from(&dir);
    fs::create_dir_all(&target).map_err(|e| AppError::Io(e.to_string()))?;
    let path = target.join(sanitize(&filename));
    fs::write(&path, &bytes).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(path.to_string_lossy().to_string())
}

// ---- My Files blob store: real files on disk under {data_dir}/files ----
// Keeps user file bytes out of the SQLite DB (no bloat) and on the local
// machine only — never leaves the device. Path is the app's storage key
// ({uid}/{id}/{name}); each segment is sanitized and "../" is rejected.

fn files_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("files")
}

/// Resolve a relative storage key to an absolute path under {data_dir}/files,
/// rejecting path traversal. Returns None for an unsafe key.
fn blob_path(app: &AppHandle, rel: &str) -> Option<PathBuf> {
    let mut p = files_dir(app);
    for seg in rel.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return None;
        }
        p.push(sanitize(seg));
    }
    Some(p)
}

// ---- at-rest encryption (AES-256-GCM, transparent OS-bound key) ----
// Blob bytes are encrypted before they touch disk. The 32-byte key is random,
// generated on first use and stored in the OS secure store (Windows Credential
// Manager) via `keyring` — so it auto-unlocks for this user and a copied disk /
// other account can't read the files. Files written before this feature have no
// ENC_MAGIC header and are read back as-is (then encrypted on next write).
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine as _;
use rand::RngCore as _;

const ENC_MAGIC: &[u8] = b"FENC1";
const KEYRING_SERVICE: &str = "filey-erp";
const KEYRING_USER: &str = "file-encryption-key";

fn file_key(create: bool) -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
    key_from_store(entry.get_password(), create, |value| entry.set_password(value).map_err(|e| e.to_string()))
}

fn key_from_store(read: Result<String, keyring::Error>, create: bool, save: impl FnOnce(&str) -> Result<(), String>) -> Result<[u8;32],String> {
    match read {
        Ok(b64) => {
            let raw = base64::engine::general_purpose::STANDARD
                .decode(b64.trim())
                .map_err(|e| e.to_string())?;
            if raw.len() != 32 {
                return Err("stored encryption key has wrong length".into());
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&raw);
            Ok(key)
        }
        Err(keyring::Error::NoEntry) if create => {
            let mut key = [0u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut key);
            let b64 = base64::engine::general_purpose::STANDARD.encode(key);
            save(&b64)?;
            Ok(key)
        }
        Err(keyring::Error::NoEntry) => Err("The file encryption key is missing. Restore a portable backup with its recovery code.".into()),
        Err(error) => Err(format!("Secure storage is unavailable. The existing key was not replaced: {error}")),
    }
}

fn encrypt_blob(plain: &[u8]) -> Result<Vec<u8>, String> {
    let key = file_key(true)?;
    encrypt_with_key(plain, &key)
}

fn encrypt_with_key(plain: &[u8], key: &[u8;32]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plain)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(ENC_MAGIC.len() + 12 + ct.len());
    out.extend_from_slice(ENC_MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

fn decrypt_blob(data: &[u8]) -> Result<Vec<u8>, String> {
    if !data.starts_with(ENC_MAGIC) { return Ok(data.to_vec()); }
    decrypt_with_key(data, &file_key(false)?)
}

fn decrypt_with_key(data: &[u8], key: &[u8;32]) -> Result<Vec<u8>,String> {
    // Legacy plaintext (written before encryption) lacks the header → return raw.
    if !data.starts_with(ENC_MAGIC) {
        return Ok(data.to_vec());
    }
    if data.len() < ENC_MAGIC.len() + 12 + 16 { return Err("The encrypted file is truncated.".into()); }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = &data[ENC_MAGIC.len()..ENC_MAGIC.len() + 12];
    let ct = &data[ENC_MAGIC.len() + 12..];
    cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn blob_write(app: AppHandle, path: String, bytes: Vec<u8>) -> AppResult<()> {
    let _guard = STORAGE_OPERATION.lock().map_err(|e| AppError::Io(e.to_string()))?;
    ensure_writable()?;
    let p = blob_path(&app, &path).ok_or_else(|| AppError::Io("invalid path".into()))?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Io(e.to_string()))?;
    }
    let enc = encrypt_blob(&bytes).map_err(AppError::Io)?;
    atomic_write(&p, &enc).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn blob_read(app: AppHandle, path: String) -> AppResult<Option<Vec<u8>>> {
    let p = blob_path(&app, &path).ok_or_else(|| AppError::Io("invalid path".into()))?;
    let raw = match fs::read(&p) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(AppError::Io(e.to_string())),
    };
    decrypt_blob(&raw).map(Some).map_err(AppError::Io)
}

#[tauri::command]
pub async fn blob_delete(app: AppHandle, path: String) -> AppResult<()> {
    let _guard = STORAGE_OPERATION.lock().map_err(|e| AppError::Io(e.to_string()))?;
    ensure_writable()?;
    if let Some(p) = blob_path(&app, &path) {
        if p.exists() {
            fs::remove_file(&p).map_err(|e| AppError::Io(e.to_string()))?;
        }
    }
    Ok(())
}

// ---- backup / restore ----

fn pending_restore_file(app: &AppHandle) -> PathBuf {
    app_data(app).join("pending_restore.txt")
}

/// Export a clean, consistent copy of the database to `dest` (VACUUM INTO needs
/// the target not to exist, so remove it first).
#[tauri::command]
pub async fn backup_db(db: State<'_, Db>, dest: String) -> AppResult<String> {
    let p = PathBuf::from(&dest);
    if p.exists() {
        return Err(AppError::Io("Choose a new backup filename; existing files were not replaced.".into()));
    }
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute("VACUUM INTO ?1", [&dest])?;
    validate_database(&p)?;
    Ok(dest)
}

/// Queue a restore: record the source file; it's applied at the next startup
/// (before the DB opens) so the live, open database is never overwritten.
#[tauri::command]
pub async fn restore_db(app: AppHandle, src: String) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORAGE_OPERATION.lock().map_err(|e|AppError::Io(e.to_string()))?;
        ensure_writable()?;
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|e|AppError::Pool(e.to_string()))?;
        let stage = stage_database_restore(&app, &PathBuf::from(src))?;
        queue_workspace(&app,&conn,&stage)
    }).await.map_err(|e|AppError::Io(e.to_string()))?
}

fn new_restore_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let path = app_data(app).join("restored-workspaces").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&path).map_err(|e|AppError::Io(e.to_string()))?;
    Ok(path)
}

fn stage_database_restore(app: &AppHandle, source: &std::path::Path) -> AppResult<PathBuf> {
    validate_database(source)?;
    if source.canonicalize().ok() == resolve_db_path(app).canonicalize().ok() {
        return Err(AppError::Io("Choose a backup, not the active workspace database.".into()));
    }
    let stage = new_restore_dir(app)?;
    fs::copy(source,stage.join("filey-erp.db")).map_err(|e|AppError::Io(e.to_string()))?;
    if files_dir(app).exists() { copy_dir_all(&files_dir(app),&stage.join("files")).map_err(|e|AppError::Io(e.to_string()))?; }
    validate_workspace(&stage)?;
    Ok(stage)
}

// ---- full backup (DB + files-on-disk) ----

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        if entry.file_type()?.is_symlink() {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Workspace files must not contain symbolic links"));
        }
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_all(&path, &target)?;
        } else {
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

/// Full backup into `dest` folder: a clean DB copy (filey-erp.db) plus the My
/// Files blob tree (files/). One self-contained folder the user can move to a
/// USB drive or synced location.
/// spawn_blocking, not a plain async command: this copies the whole files/ tree
/// and can run for minutes on a library of scanned PDFs. Tauri's runtime is
/// multi-threaded, so a plain async command would only occupy one worker rather
/// than stall everything — but cache_get and cache_set ride that same pool on
/// every collection read, and the UI waits on those. Long work belongs on the
/// blocking pool. `Db` is fetched inside the closure because `State` borrows
/// from the app and cannot cross the thread boundary.
#[tauri::command]
pub async fn backup_all(app: AppHandle, dest: String) -> AppResult<BackupResult> {
    tauri::async_runtime::spawn_blocking(move || backup_all_blocking(app, dest))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult { path: String, recovery_code: String }

fn backup_all_blocking(app: AppHandle, dest: String) -> AppResult<BackupResult> {
    let _guard = STORAGE_OPERATION.lock().map_err(|e| AppError::Io(e.to_string()))?;
    ensure_writable()?;
    let db = app.state::<Db>();
    let conn = db.0.lock().map_err(|e|AppError::Pool(e.to_string()))?;
    let key = file_key(!backup::contains_encrypted_files(&files_dir(&app)).map_err(AppError::Io)?).map_err(AppError::Io)?;
    let dir = copy_workspace(&conn,&data_dir(&app),&PathBuf::from(dest))?;
    let recovery_code = backup::seal(&dir,&key).map_err(AppError::Io)?;
    Ok(BackupResult { path: dir.to_string_lossy().to_string(), recovery_code })
}

/// Restore into a new directory, then queue that complete generation for startup.
/// Neither the active database/files nor the source backup are overwritten.
#[tauri::command]
pub async fn restore_all(app: AppHandle, src: String, recovery_code: Option<String>) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || restore_all_blocking(app, src, recovery_code))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

fn restore_all_blocking(app: AppHandle, src: String, recovery_code: Option<String>) -> AppResult<()> {
    let _guard = STORAGE_OPERATION.lock().map_err(|e| AppError::Io(e.to_string()))?;
    ensure_writable()?;
    let dir = PathBuf::from(&src);
    if dir.canonicalize().ok() == data_dir(&app).canonicalize().ok() {
        return Err(AppError::Io("Choose a backup folder, not the active workspace.".into()));
    }
    validate_database(&dir.join("filey-erp.db"))?;
    let key = file_key(true).map_err(AppError::Io)?;
    let db = app.state::<Db>();
    let conn = db.0.lock().map_err(|e|AppError::Pool(e.to_string()))?;
    let stage = new_restore_dir(&app)?;
    backup::restore(&dir,&stage,&key,recovery_code.as_deref()).map_err(AppError::Io)?;
    validate_workspace(&stage)?;
    queue_workspace(&app,&conn,&stage)
}

/// Upgrade an old pending restore safely. Failed staging retains the marker and
/// original data; never ignore a copy error or overwrite the live database.
pub fn apply_pending_restore(app: &AppHandle) -> AppResult<()> {
    let ptr = pending_restore_file(app);
    if !ptr.exists() { return Ok(()); }
    if app_data(app).join("pending_data_dir.txt").exists() { return Err(AppError::Io("Two storage changes are pending. The existing workspace was preserved.".into())); }
    let src = fs::read_to_string(&ptr).map_err(|e|AppError::Io(e.to_string()))?;
    let stage = stage_database_restore(app,&PathBuf::from(src.trim()))?;
    atomic_write(&pointer_file(app),stage.to_string_lossy().as_bytes()).map_err(|e|AppError::Io(e.to_string()))?;
    fs::remove_file(ptr).map_err(|e|AppError::Io(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct WorkspaceFixture(PathBuf);
    impl WorkspaceFixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("filey-storage-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for WorkspaceFixture {
        fn drop(&mut self) {
            // Only the random directory created by this fixture is removed.
            assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn move_copies_current_wal_database_and_files_without_replacing_the_source() {
        let fixture = WorkspaceFixture::new();
        let source = fixture.0.join("source");
        let target = fixture.0.join("target");
        fs::create_dir_all(source.join("files/user")).unwrap();
        fs::write(source.join("files/user/invoice.pdf"), b"encrypted fixture bytes").unwrap();
        let conn = rusqlite::Connection::open(source.join("filey-erp.db")).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE kv_cache(key TEXT PRIMARY KEY,value TEXT); INSERT INTO kv_cache VALUES('invoice','latest committed data');").unwrap();
        copy_workspace(&conn, &source, &target).unwrap();
        let copied = rusqlite::Connection::open(target.join("filey-erp.db")).unwrap();
        let value: String = copied.query_row("SELECT value FROM kv_cache WHERE key='invoice'",[],|row|row.get(0)).unwrap();
        assert_eq!(value,"latest committed data");
        assert_eq!(fs::read(target.join("files/user/invoice.pdf")).unwrap(),b"encrypted fixture bytes");
        assert_eq!(fs::read(source.join("files/user/invoice.pdf")).unwrap(),b"encrypted fixture bytes");
        assert!(copy_workspace(&conn, &source, &target).is_err());
        assert!(copy_workspace(&conn, &source, &source.join("nested")).is_err());
        drop(copied);
        drop(conn);
    }

    #[test]
    fn rejects_invalid_backups_and_atomically_replaces_pointer_files() {
        let fixture = WorkspaceFixture::new();
        let bad = fixture.0.join("bad.db");
        fs::write(&bad,b"not a database").unwrap();
        assert!(validate_database(&bad).is_err());
        let pointer = fixture.0.join("pointer.txt");
        atomic_write(&pointer,b"old location").unwrap();
        atomic_write(&pointer,b"verified location").unwrap();
        assert_eq!(fs::read(pointer).unwrap(),b"verified location");
    }

    #[test]
    fn secure_store_failures_never_replace_an_existing_key() {
        let mut saved = false;
        let error = keyring::Error::PlatformFailure(Box::new(std::io::Error::new(std::io::ErrorKind::PermissionDenied,"temporarily locked")));
        assert!(key_from_store(Err(error),true,|_| { saved=true; Ok(()) }).is_err());
        assert!(!saved);
        assert!(key_from_store(Err(keyring::Error::NoEntry),false,|_| { saved=true; Ok(()) }).is_err());
        assert!(!saved);
        assert!(key_from_store(Err(keyring::Error::NoEntry),true,|_| { saved=true; Ok(()) }).is_ok());
        assert!(saved);
        assert!(decrypt_with_key(b"FENC1truncated",&[1;32]).is_err());
    }

    #[test]
    fn failed_activation_retains_the_original_pointer_and_pending_request() {
        let fixture = WorkspaceFixture::new();
        let original = fixture.0.join("original");
        let stage = fixture.0.join("stage");
        fs::create_dir(&original).unwrap();
        fs::create_dir(&stage).unwrap();
        let pointer = fixture.0.join("data_dir.txt");
        let pending = fixture.0.join("pending.txt");
        let previous = fixture.0.join("previous.txt");
        atomic_write(&pointer,original.to_string_lossy().as_bytes()).unwrap();
        atomic_write(&pending,stage.to_string_lossy().as_bytes()).unwrap();
        assert!(activate_data_dir(&pointer,&pending,&previous,&original).is_err());
        assert_eq!(fs::read_to_string(&pointer).unwrap(),original.to_string_lossy());
        assert!(pending.exists());
        let conn = rusqlite::Connection::open(stage.join("filey-erp.db")).unwrap();
        conn.execute_batch("CREATE TABLE kv_cache(key TEXT PRIMARY KEY,value TEXT);").unwrap();
        drop(conn);
        activate_data_dir(&pointer,&pending,&previous,&original).unwrap();
        assert_eq!(fs::read_to_string(&pointer).unwrap(),stage.to_string_lossy());
        assert_eq!(fs::read_to_string(&previous).unwrap(),original.to_string_lossy());
        assert!(!pending.exists());
        assert!(original.exists());
    }
}
