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
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                modules::computer_use::window_closed(window.label());
                modules::desktop_browser::window_closed(window.app_handle(), window.label());
            }
        })
        .setup(|app| {
            modules::storage::recover_storage_startup(app.handle());
            // DB lives in the user-chosen folder (or the default app-data dir).
            let db_path = modules::storage::resolve_db_path(app.handle());
            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let conn = Connection::open(&db_path).expect("open db");
            db::init(&conn).expect("init db");
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(|invoke| {
            // Untrusted browser windows must never invoke app commands, even
            // if a site navigates an iframe to a bundled or development URL.
            if invoke.message.webview().label() != "main" {
                invoke
                    .resolver
                    .reject("Filey commands are available only in the main app window.");
                return true;
            }
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                // Offline cache / sync outbox
                modules::sync::cache_get,
                modules::sync::cache_set,
                modules::sync::cache_set_many,
                modules::credentials::credential_read,
                modules::credentials::credential_write,
                modules::credentials::credential_quarantine,
                modules::sync::outbox_add,
                modules::sync::outbox_list,
                modules::sync::outbox_remove,
                modules::sync::outbox_clear,
                // AI provider proxy (bypasses webview CORS for any provider)
                modules::ai::ai_proxy,
                modules::ai::ai_download_media,
                // Email (SMTP)
                modules::email::send_email,
                // Composio (managed integrations: Gmail/Slack/Telegram…)
                modules::composio::composio_connect,
                modules::composio::composio_has_key,
                modules::composio::composio_connection_status,
                modules::composio::composio_list_connections,
                modules::composio::composio_list_tools,
                modules::composio::composio_search_toolkits,
                modules::composio::composio_execute,
                // Storage locations + backup/restore
                modules::storage::get_data_dir,
                modules::storage::set_data_dir,
                modules::storage::storage_recovery_status,
                modules::storage::cancel_pending_storage,
                modules::storage::restart_app,
                modules::storage::write_doc_file,
                modules::storage::blob_write,
                modules::storage::blob_read,
                modules::storage::blob_delete,
                modules::storage::backup_db,
                modules::storage::restore_db,
                modules::storage::backup_all,
                modules::storage::restore_all,
                // First-run desktop shortcut (Windows)
                modules::shortcut::create_desktop_shortcut,
                // WhatsApp bridge sidecar (QR-paired session, supervised here)
                modules::wa_bridge::wa_bridge_start,
                modules::wa_bridge::wa_bridge_stop,
                modules::wa_bridge::wa_bridge_state,
                modules::wa_bridge::wa_bridge_reset,
                modules::wa_bridge::wa_bridge_reply,
                modules::wa_bridge::wa_bridge_send,
                modules::wa_bridge::wa_bridge_send_file,
                // Owner-only shell execution (terminal / repo run)
                modules::shell::shell_exec,
                // Explicit, short-lived native computer control (Windows).
                modules::computer_use::computer_start,
                modules::computer_use::computer_stop,
                modules::computer_use::computer_command,
                modules::desktop_browser::desktop_browser_command,
            modules::desktop_browser::desktop_browser_layout,
            ];
            handler(invoke)
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
