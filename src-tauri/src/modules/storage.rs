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
