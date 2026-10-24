//! Always-on agent host: Filey keeps running in the tray after its window
//! closes and wakes the agent on a steady tick.
//!
//! The agent itself lives in the main webview (schedules, watches, WhatsApp and
//! Telegram listeners). Hiding the window keeps that webview alive; this module
//! only decides when the window hides instead of closing, owns the tray, and
//! sends `filey://tick` from a native thread so a hidden page still wakes on
//! time (Chromium slows a hidden page's own timers). Quit from the tray ends it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

const TICK: Duration = Duration::from_secs(30);

pub struct AlwaysOn {
    /// Close hides the window instead of quitting. On until the app says otherwise.
    keep_running: AtomicBool,
    paused: AtomicBool,
    pause_item: Mutex<Option<MenuItem<Wry>>>,
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Window close: hide when always-on is active, otherwise let it close.
pub fn hide_instead_of_close(app: &AppHandle) -> bool {
    app.try_state::<AlwaysOn>()
        .map(|state| state.keep_running.load(Ordering::SeqCst))
        .unwrap_or(false)
}

pub fn window_hidden(app: &AppHandle) {
    let _ = app.emit_to("main", "filey://hidden", ());
}

fn pause_label(paused: bool) -> &'static str {
    if paused { "Resume agent" } else { "Pause agent" }
}

fn set_paused(app: &AppHandle, paused: bool) {
    let Some(state) = app.try_state::<AlwaysOn>() else { return };
    state.paused.store(paused, Ordering::SeqCst);
    if let Some(item) = state.pause_item.lock().ok().and_then(|item| item.clone()) {
        let _ = item.set_text(pause_label(paused));
    }
    if let Some(tray) = app.tray_by_id("filey") {
        let _ = tray.set_tooltip(Some(if paused { "Filey ERP - agent paused" } else { "Filey ERP - agent on" }));
    }
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    app.manage(AlwaysOn {
        keep_running: AtomicBool::new(true),
        paused: AtomicBool::new(false),
        pause_item: Mutex::new(None),
    });

    let open = MenuItem::with_id(app, "open", "Open Filey", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", pause_label(false), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Filey", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &pause, &quit])?;
    let mut tray = TrayIconBuilder::with_id("filey")
        .tooltip("Filey ERP - agent on")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "pause" => {
                let paused = !app
                    .try_state::<AlwaysOn>()
                    .map(|state| state.paused.load(Ordering::SeqCst))
                    .unwrap_or(false);
                set_paused(app, paused);
                // The page keeps the switch and stops its own background work.
                let _ = app.emit_to("main", "filey://always-on", serde_json::json!({ "paused": paused }));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    if let Ok(mut slot) = app.state::<AlwaysOn>().pause_item.lock() {
        *slot = Some(pause);
    }

    let handle = app.handle().clone();
    std::thread::Builder::new()
        .name("filey-agent-tick".into())
        .spawn(move || loop {
            std::thread::sleep(TICK);
            let _ = handle.emit_to("main", "filey://tick", ());
        })
        .ok();
    Ok(())
}

#[derive(Serialize)]
pub struct AlwaysOnStatus {
    keep_running: bool,
    paused: bool,
}

#[tauri::command]
pub fn always_on_configure(app: AppHandle, keep_running: bool, paused: bool) -> Result<AlwaysOnStatus, String> {
    let state = app.try_state::<AlwaysOn>().ok_or("Always-on is not ready yet.")?;
    state.keep_running.store(keep_running, Ordering::SeqCst);
    set_paused(&app, paused);
    Ok(AlwaysOnStatus { keep_running, paused })
}

#[tauri::command]
pub fn always_on_notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    let clip = |text: &str, max: usize| text.chars().take(max).collect::<String>();
    app.notification()
        .builder()
        .title(clip(&title, 80))
        .body(clip(&body, 240))
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn always_on_show(app: AppHandle) {
    show_main(&app);
}
