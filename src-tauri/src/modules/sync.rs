use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct OutboxEntry {
    pub id: i64,
    pub op: String,
    pub created_at: String,
}

#[tauri::command]
pub fn cache_get(db: State<Db>, key: String) -> AppResult<Option<String>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let val = conn
        .query_row(
            "SELECT value FROM kv_cache WHERE key = ?1",
            [key],
            |r| r.get::<_, String>(0),
        )
        .ok();
    Ok(val)
}

#[tauri::command]
pub fn cache_set(db: State<Db>, key: String, value: String) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute(
        "INSERT INTO kv_cache (key, value, updated_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

#[tauri::command]
pub fn outbox_add(db: State<Db>, op: String) -> AppResult<i64> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute("INSERT INTO outbox (op) VALUES (?1)", [op])?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn outbox_list(db: State<Db>) -> AppResult<Vec<OutboxEntry>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt =
        conn.prepare("SELECT id, op, created_at FROM outbox ORDER BY id ASC")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(OutboxEntry {
                id: r.get(0)?,
                op: r.get(1)?,
                created_at: r.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn outbox_remove(db: State<Db>, entry_id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute("DELETE FROM outbox WHERE id = ?1", [entry_id])?;
    Ok(())
}

#[tauri::command]
pub fn outbox_clear(db: State<Db>) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute("DELETE FROM outbox", [])?;
    Ok(())
}
