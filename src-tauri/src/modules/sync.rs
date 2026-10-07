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

/// Compare-and-set over the whole read set of a local transaction. Every key in
/// `expected` must still hold the value the caller read (`None` = absent) before
/// any of `entries` is written (`None` = delete). Returns `false`, writing
/// nothing, when another window or process committed first.
#[tauri::command]
pub async fn cache_compare_set_many(
    db: State<'_, Db>,
    entries: Vec<(String, Option<String>)>,
    expected: Vec<(String, Option<String>)>,
) -> AppResult<bool> {
    let mut conn = db.0.lock().map_err(|e| AppError::Pool(e.to_string()))?;
    compare_cache_batch(&mut conn, &entries, &expected)
}

fn valid_cache_key(key: &str) -> bool {
    key.starts_with("localdb:") || key == "syncjournal"
}

fn compare_cache_batch(
    conn: &mut Connection,
    entries: &[(String, Option<String>)],
    expected: &[(String, Option<String>)],
) -> AppResult<bool> {
    if entries.len() > 256
        || expected.len() > 512
        || entries.iter().any(|(key, _)| !valid_cache_key(key))
        || expected.iter().any(|(key, _)| !valid_cache_key(key))
    {
        return Err(AppError::Io("Invalid local transaction comparisons".into()));
    }
    let read_keys: std::collections::HashSet<_> = expected.iter().map(|(key, _)| key).collect();
    let write_keys: std::collections::HashSet<_> = entries.iter().map(|(key, _)| key).collect();
    if read_keys.len() != expected.len()
        || write_keys.len() != entries.len()
        || entries.iter().any(|(key, _)| !read_keys.contains(key))
    {
        return Err(AppError::Io("Invalid local transaction comparisons".into()));
    }
    // IMMEDIATE takes the write lock before the reads, so no other connection
    // can slip a commit in between our comparison and our writes.
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    for (key, value) in expected {
        if read_cache_value(&tx, key)? != *value {
            tx.rollback()?;
            return Ok(false);
        }
    }
    for (key, value) in entries {
        match value {
            Some(value) => {
                tx.execute(
                    "INSERT INTO kv_cache(key,value,updated_at) VALUES(?1,?2,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
                    rusqlite::params![key, value],
                )?;
            }
            None => {
                tx.execute("DELETE FROM kv_cache WHERE key = ?1", [key])?;
            }
        }
    }
    tx.commit()?;
    Ok(true)
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
    fn compare_set_writes_only_when_every_expected_value_still_holds() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE kv_cache(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT); INSERT INTO kv_cache(key,value) VALUES('localdb:orders','v1');").unwrap();
        let stale = vec![("localdb:orders".to_string(), Some("v0".to_string())), ("syncjournal".to_string(), None)];
        let writes = vec![("localdb:orders".to_string(), Some("v2".to_string())), ("syncjournal".to_string(), Some("dirty".to_string()))];
        assert!(!compare_cache_batch(&mut conn, &writes, &stale).unwrap());
        assert_eq!(read_cache_value(&conn, "localdb:orders").unwrap().as_deref(), Some("v1"));
        assert_eq!(read_cache_value(&conn, "syncjournal").unwrap(), None);

        let fresh = vec![("localdb:orders".to_string(), Some("v1".to_string())), ("syncjournal".to_string(), None)];
        assert!(compare_cache_batch(&mut conn, &writes, &fresh).unwrap());
        assert_eq!(read_cache_value(&conn, "localdb:orders").unwrap().as_deref(), Some("v2"));
        assert_eq!(read_cache_value(&conn, "syncjournal").unwrap().as_deref(), Some("dirty"));

        let delete = vec![("syncjournal".to_string(), None)];
        let current = vec![("syncjournal".to_string(), Some("dirty".to_string()))];
        assert!(compare_cache_batch(&mut conn, &delete, &current).unwrap());
        assert_eq!(read_cache_value(&conn, "syncjournal").unwrap(), None);

        let foreign = vec![("outbox".to_string(), Some("x".to_string()))];
        assert!(compare_cache_batch(&mut conn, &foreign, &[]).is_err());

        assert!(compare_cache_batch(&mut conn, &writes, &[]).is_err());
        assert!(compare_cache_batch(&mut conn, &writes, &[fresh[0].clone(), fresh[0].clone()]).is_err());
        assert!(compare_cache_batch(&mut conn, &[writes[0].clone(), writes[0].clone()], &fresh).is_err());
    }

    #[test]
    fn compare_set_rolls_back_records_and_journal_on_a_failed_write() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE kv_cache(key TEXT PRIMARY KEY,value TEXT CHECK(value <> 'reject'),updated_at TEXT); INSERT INTO kv_cache(key,value) VALUES('localdb:invoice_docs','original');").unwrap();
        let expected = vec![("localdb:invoice_docs".into(), Some("original".into())), ("syncjournal".into(), None)];
        let writes = vec![("localdb:invoice_docs".into(), Some("replacement".into())), ("syncjournal".into(), Some("reject".into()))];
        assert!(compare_cache_batch(&mut conn, &writes, &expected).is_err());
        assert_eq!(read_cache_value(&conn, "localdb:invoice_docs").unwrap().as_deref(), Some("original"));
        assert_eq!(read_cache_value(&conn, "syncjournal").unwrap(), None);
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

    #[test]
    fn compare_set_waits_for_a_peer_connection_and_rejects_its_stale_snapshot() {
        struct TestDb(std::path::PathBuf);
        impl Drop for TestDb {
            fn drop(&mut self) {
                assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
                let name = self.0.file_name().unwrap().to_str().unwrap();
                assert!(name.starts_with("filey-native-cas-") && name.ends_with(".db"));
                for suffix in ["", "-journal", "-wal", "-shm"] {
                    let path = self.0.with_file_name(format!("{name}{suffix}"));
                    match std::fs::remove_file(path) {
                        Ok(()) => (),
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                        Err(error) => panic!("Could not remove owned CAS fixture: {error}"),
                    }
                }
            }
        }
        let fixture = TestDb(std::env::temp_dir().join(format!("filey-native-cas-{}.db", uuid::Uuid::new_v4())));
        let mut peer = Connection::open(&fixture.0).unwrap();
        peer.execute_batch("CREATE TABLE kv_cache(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT); INSERT INTO kv_cache(key,value) VALUES('localdb:orders','original');").unwrap();
        let expected = vec![("localdb:orders".into(), Some("original".into())), ("syncjournal".into(), None), ("localdb:orphan".into(), None)];
        let writes = vec![("localdb:orders".into(), Some("stale replacement".into())), ("syncjournal".into(), Some("stale journal".into())), ("localdb:orphan".into(), Some("orphan".into()))];
        let held = peer.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).unwrap();
        held.execute_batch("UPDATE kv_cache SET value='peer record' WHERE key='localdb:orders'; INSERT INTO kv_cache(key,value) VALUES('syncjournal','peer journal');").unwrap();
        let path = fixture.0.clone();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let mut conn = Connection::open(path).unwrap();
            conn.busy_timeout(std::time::Duration::from_secs(2)).unwrap();
            started_tx.send(()).unwrap();
            let result = compare_cache_batch(&mut conn, &writes, &expected);
            drop(conn);
            done_tx.send(result).unwrap();
        });
        let started = started_rx.recv_timeout(std::time::Duration::from_secs(5));
        let early = done_rx.recv_timeout(std::time::Duration::from_millis(100));
        let waited = matches!(early, Err(std::sync::mpsc::RecvTimeoutError::Timeout));
        // Release the peer before any assertions, so failure cannot strand a writer.
        held.commit().unwrap();
        let result = match early {
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => done_rx.recv_timeout(std::time::Duration::from_secs(5)),
            outcome => outcome,
        }.expect("Native CAS must finish within the bounded wait after peer commit");
        // The completion signal is sent after its connection is closed.
        worker.join().unwrap();
        started.unwrap();
        assert!(waited, "Native CAS must wait for the peer's write transaction");
        assert!(!result.unwrap(), "The peer's committed changes invalidate the original read set");
        assert_eq!(read_cache_value(&peer, "localdb:orders").unwrap().as_deref(), Some("peer record"));
        assert_eq!(read_cache_value(&peer, "syncjournal").unwrap().as_deref(), Some("peer journal"));
        assert_eq!(read_cache_value(&peer, "localdb:orphan").unwrap(), None);
        drop(peer);
    }
}
