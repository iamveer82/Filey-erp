use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub full_name: String,
    pub role: String,
    pub active: bool,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct Setting {
    pub key: String,
    pub value: String,
}

#[derive(Serialize)]
pub struct AuditEntry {
    pub id: i64,
    pub actor: String,
    pub action: String,
    pub entity: String,
    pub details: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn tools_list_users(db: State<Db>) -> AppResult<Vec<User>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, username, full_name, role, active, created_at FROM users ORDER BY username",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(User {
                id: r.get(0)?,
                username: r.get(1)?,
                full_name: r.get(2)?,
                role: r.get(3)?,
                active: r.get::<_, i64>(4)? != 0,
                created_at: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn tools_create_user(
    db: State<Db>,
    username: String,
    full_name: String,
    role: String,
) -> AppResult<i64> {
    if username.trim().is_empty() {
        return Err(AppError::Validation("Username is required".into()));
    }
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO users (username, full_name, role) VALUES (?1, ?2, ?3)",
        rusqlite::params![username, full_name, role],
    )?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO audit_log (actor, action, entity, details) VALUES ('admin','create','user',?1)",
        [format!("Created user {username}")],
    )?;
    Ok(id)
}

#[tauri::command]
pub fn tools_toggle_user(db: State<Db>, user_id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "UPDATE users SET active = 1 - active WHERE id = ?1",
        [user_id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn tools_list_settings(db: State<Db>) -> AppResult<Vec<Setting>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Setting {
                key: r.get(0)?,
                value: r.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn tools_set_setting(db: State<Db>, key: String, value: String) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

#[tauri::command]
pub fn tools_audit_log(db: State<Db>) -> AppResult<Vec<AuditEntry>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare(
        "SELECT id, actor, action, entity, details, created_at
         FROM audit_log ORDER BY id DESC LIMIT 200",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(AuditEntry {
                id: r.get(0)?,
                actor: r.get(1)?,
                action: r.get(2)?,
                entity: r.get(3)?,
                details: r.get(4)?,
                created_at: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn tools_log_action(
    db: State<Db>,
    actor: String,
    action: String,
    entity: String,
    details: Option<String>,
) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO audit_log (actor, action, entity, details) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![actor, action, entity, details],
    )?;
    Ok(())
}
