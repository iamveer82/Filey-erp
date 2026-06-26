// User-chosen storage locations.
//  - The local database (filey-erp.db) folder, persisted in a pointer file so
//    it survives restarts and is read before the DB opens.
//  - Writing generated documents (PDFs) as real files to a folder of the
//    user's choosing.

use crate::db::Db;
use crate::error::{AppError, AppResult};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

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

/// Point the app at a new data folder: copy the current DB there and record the
/// choice. The app must restart afterwards to open the DB from the new path.
#[tauri::command]
pub fn set_data_dir(app: AppHandle, dir: String) -> AppResult<String> {
    let target = PathBuf::from(&dir);
    fs::create_dir_all(&target).map_err(|e| AppError::Io(e.to_string()))?;
    let src = resolve_db_path(&app);
    let dst = target.join("filey-erp.db");
    if src.exists() && src != dst {
        fs::copy(&src, &dst).map_err(|e| AppError::Io(e.to_string()))?;
    }
    fs::write(pointer_file(&app), target.to_string_lossy().as_bytes())
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dst.to_string_lossy().to_string())
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
pub fn write_doc_file(dir: String, filename: String, bytes: Vec<u8>) -> AppResult<String> {
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

fn file_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;
    match entry.get_password() {
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
        Err(_) => {
            let mut key = [0u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut key);
            let b64 = base64::engine::general_purpose::STANDARD.encode(key);
            entry.set_password(&b64).map_err(|e| e.to_string())?;
            Ok(key)
        }
    }
}

fn encrypt_blob(plain: &[u8]) -> Result<Vec<u8>, String> {
    let key = file_key()?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
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
    // Legacy plaintext (written before encryption) lacks the header → return raw.
    if data.len() < ENC_MAGIC.len() + 12 || &data[..ENC_MAGIC.len()] != ENC_MAGIC {
        return Ok(data.to_vec());
    }
    let key = file_key()?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let nonce = &data[ENC_MAGIC.len()..ENC_MAGIC.len() + 12];
    let ct = &data[ENC_MAGIC.len() + 12..];
    cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn blob_write(app: AppHandle, path: String, bytes: Vec<u8>) -> AppResult<()> {
    let p = blob_path(&app, &path).ok_or_else(|| AppError::Io("invalid path".into()))?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::Io(e.to_string()))?;
    }
    let enc = encrypt_blob(&bytes).map_err(AppError::Io)?;
    fs::write(&p, &enc).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn blob_read(app: AppHandle, path: String) -> AppResult<Vec<u8>> {
    let p = blob_path(&app, &path).ok_or_else(|| AppError::Io("invalid path".into()))?;
    let raw = fs::read(&p).map_err(|e| AppError::Io(e.to_string()))?;
    decrypt_blob(&raw).map_err(AppError::Io)
}

#[tauri::command]
pub fn blob_delete(app: AppHandle, path: String) -> AppResult<()> {
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
pub fn backup_db(db: State<Db>, dest: String) -> AppResult<String> {
    let p = PathBuf::from(&dest);
    if p.exists() {
        fs::remove_file(&p).map_err(|e| AppError::Io(e.to_string()))?;
    }
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute("VACUUM INTO ?1", [&dest])?;
    Ok(dest)
}

/// Queue a restore: record the source file; it's applied at the next startup
/// (before the DB opens) so the live, open database is never overwritten.
#[tauri::command]
pub fn restore_db(app: AppHandle, src: String) -> AppResult<()> {
    if !PathBuf::from(&src).exists() {
        return Err(AppError::Io("backup file not found".into()));
    }
    fs::write(pending_restore_file(&app), src.as_bytes())
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

// ---- full backup (DB + files-on-disk) ----

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
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
#[tauri::command]
pub fn backup_all(app: AppHandle, db: State<Db>, dest: String) -> AppResult<String> {
    let dir = PathBuf::from(&dest);
    fs::create_dir_all(&dir).map_err(|e| AppError::Io(e.to_string()))?;
    let db_dest = dir.join("filey-erp.db");
    if db_dest.exists() {
        fs::remove_file(&db_dest).map_err(|e| AppError::Io(e.to_string()))?;
    }
    let db_dest_str = db_dest.to_string_lossy().to_string();
    {
        let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
        conn.execute("VACUUM INTO ?1", [&db_dest_str])?;
    }
    let files = files_dir(&app);
    if files.exists() {
        copy_dir_all(&files, &dir.join("files"))
            .map_err(|e| AppError::Io(e.to_string()))?;
    }
    Ok(dir.to_string_lossy().to_string())
}

/// Restore a full backup folder. Files (not locked) are copied back immediately;
/// the DB is queued and applied at the next startup (it's open right now). Caller
/// restarts after this returns.
#[tauri::command]
pub fn restore_all(app: AppHandle, src: String) -> AppResult<()> {
    let dir = PathBuf::from(&src);
    let db_src = dir.join("filey-erp.db");
    if !db_src.exists() {
        return Err(AppError::Io("backup folder has no filey-erp.db".into()));
    }
    let files_src = dir.join("files");
    if files_src.exists() {
        let files_dst = files_dir(&app);
        if files_dst.exists() {
            fs::remove_dir_all(&files_dst).ok();
        }
        copy_dir_all(&files_src, &files_dst).map_err(|e| AppError::Io(e.to_string()))?;
    }
    fs::write(pending_restore_file(&app), db_src.to_string_lossy().as_bytes())
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

/// Apply a queued restore at startup: copy the recorded backup over the active
/// DB, then clear the marker. Call before opening the connection.
pub fn apply_pending_restore(app: &AppHandle) {
    let ptr = pending_restore_file(app);
    if let Ok(src) = fs::read_to_string(&ptr) {
        let src = src.trim();
        if !src.is_empty() && PathBuf::from(src).exists() {
            let _ = fs::copy(src, resolve_db_path(app));
        }
    }
    let _ = fs::remove_file(ptr);
}
