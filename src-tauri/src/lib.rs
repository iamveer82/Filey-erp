mod db;
mod error;
mod modules;

use db::Db;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // DB lives in the user-chosen folder (or the default app-data dir).
            let db_path = modules::storage::resolve_db_path(app.handle());
            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            // Apply a queued restore (if any) before the DB is opened.
            modules::storage::apply_pending_restore(app.handle());
            let conn = Connection::open(&db_path).expect("open db");
            db::init(&conn).expect("init db");
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Offline cache / sync outbox
            modules::sync::cache_get,
            modules::sync::cache_set,
            modules::sync::outbox_add,
            modules::sync::outbox_list,
            modules::sync::outbox_remove,
            modules::sync::outbox_clear,
            // AI provider proxy (bypasses webview CORS for any provider)
            modules::ai::ai_proxy,
            // Email (SMTP)
            modules::email::send_email,
            // Composio (managed integrations: Gmail/Slack/Telegram…)
            modules::composio::composio_connect,
            modules::composio::composio_connection_status,
            modules::composio::composio_list_connections,
            modules::composio::composio_execute,
            // Storage locations + backup/restore
            modules::storage::get_data_dir,
            modules::storage::set_data_dir,
            modules::storage::restart_app,
            modules::storage::write_doc_file,
            modules::storage::backup_db,
            modules::storage::restore_db,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
