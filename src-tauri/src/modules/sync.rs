use crate::db::Db;
use crate::error::{AppError, AppResult};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct OutboxEntry {
    pub id: i64,
    pub op: String,
    pub created_at: String,
}

#[tauri::command]
pub async fn cache_get(db: State<'_, Db>, key: String) -> AppResult<Option<String>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    read_cache_value(&conn, &key)
}

fn read_cache_value(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM kv_cache WHERE key = ?1", [key], |r| {
            r.get::<_, String>(0)
        })
        .optional()?)
}

#[tauri::command]
pub async fn cache_set(db: State<'_, Db>, key: String, value: String) -> AppResult<()> {
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
pub async fn cache_set_many(db: State<'_, Db>, entries: Vec<(String, String)>) -> AppResult<()> {
    let mut conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    write_cache_batch(&mut conn, &entries)
}

fn write_cache_batch(conn: &mut Connection, entries: &[(String, String)]) -> AppResult<()> {
    if entries.len() > 256 || entries.iter().any(|(key, _)| !key.starts_with("localdb:") && key != "syncjournal") {
        return Err(AppError::Io("Invalid local transaction entries".into()));
    }
    let tx = conn.transaction()?;
    for (key, value) in entries {
        tx.execute("INSERT INTO kv_cache(key,value,updated_at) VALUES(?1,?2,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", rusqlite::params![key,value])?;
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub async fn outbox_add(db: State<'_, Db>, op: String) -> AppResult<i64> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute("INSERT INTO outbox (op) VALUES (?1)", [op])?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn outbox_list(db: State<'_, Db>) -> AppResult<Vec<OutboxEntry>> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    let mut stmt = conn.prepare("SELECT id, op, created_at FROM outbox ORDER BY id ASC")?;
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
pub async fn outbox_remove(db: State<'_, Db>, entry_id: i64) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute("DELETE FROM outbox WHERE id = ?1", [entry_id])?;
    Ok(())
}

#[tauri::command]
pub async fn outbox_clear(db: State<'_, Db>) -> AppResult<()> {
    let conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    conn.execute("DELETE FROM outbox", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collection_and_journal_batch_rolls_back_together_on_a_failed_write() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE kv_cache(key TEXT PRIMARY KEY,value TEXT CHECK(value <> 'reject'),updated_at TEXT); INSERT INTO kv_cache(key,value) VALUES('localdb:invoice_docs','original');").unwrap();
        let changes = vec![("localdb:invoice_docs".into(), "replacement".into()), ("syncjournal".into(), "reject".into())];
        assert!(write_cache_batch(&mut conn, &changes).is_err());
        assert_eq!(read_cache_value(&conn,"localdb:invoice_docs").unwrap().as_deref(),Some("original"));
        assert_eq!(read_cache_value(&conn,"syncjournal").unwrap(),None);
        write_cache_batch(&mut conn,&[("localdb:invoice_docs".into(),"committed".into()),("syncjournal".into(),"pending".into())]).unwrap();
        assert_eq!(read_cache_value(&conn,"syncjournal").unwrap().as_deref(),Some("pending"));
    }

    #[test]
    fn missing_cache_keys_are_optional_but_database_errors_are_not() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE kv_cache (key TEXT PRIMARY KEY, value TEXT);
            INSERT INTO kv_cache VALUES ('records', '[{\"id\":1}]');",
        )
        .unwrap();
        assert_eq!(read_cache_value(&conn, "missing").unwrap(), None);
        assert_eq!(
            read_cache_value(&conn, "records").unwrap().as_deref(),
            Some("[{\"id\":1}]")
        );
        conn.execute_batch("DROP TABLE kv_cache;").unwrap();
        assert!(matches!(
            read_cache_value(&conn, "records"),
            Err(AppError::Db(_))
        ));
    }
}
