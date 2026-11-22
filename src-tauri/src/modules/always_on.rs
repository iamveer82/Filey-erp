//! Always-on agent host: Filey keeps running in the tray after its window
//! closes and wakes the agent on a steady tick.
//!
//! The agent itself lives in the main webview (schedules, watches, WhatsApp and
//! Telegram listeners). Hiding the window keeps that webview alive; this module
//! only decides when the window hides instead of closing, owns the tray, and
//! sends `filey://tick` from a native thread so a hidden page still wakes on
//! time (Chromium slows a hidden page's own timers). Quit from the tray ends it.

use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

const TICK: Duration = Duration::from_secs(30);

/// Ticks the page has not answered. A page blocked behind a dialog (a print
/// preview left open, then the window closed to the tray) runs no script at
/// all: WhatsApp messages, schedules and watches queued behind it for hours
/// while the tray still said "agent on". Counted in ticks, not clock time, so
/// a laptop waking from sleep is not mistaken for a stalled page.
static MISSED: AtomicI32 = AtomicI32::new(-BOOT_GRACE);
/// Unanswered ticks before a hidden page is reloaded (2.5 minutes).
const STALLED: i32 = 5;
/// Extra ticks a page gets to load before it has to answer (5 minutes).
const BOOT_GRACE: i32 = 10;

/// True when this many unanswered ticks mean the page should be reloaded.
/// Only a hidden window: with the window on screen the owner can see what is
/// blocking it, and a reload there would throw away what they are doing.
fn should_reload(missed: i32, window_visible: bool) -> bool {
    missed >= STALLED && !window_visible
}

fn reload_if_stalled(app: &AppHandle, missed: i32) {
    let Some(window) = app.get_webview_window("main") else { return };
    // Unknown visibility counts as visible: never reload on a guess.
    if !should_reload(missed, window.is_visible().unwrap_or(true)) {
        return;
    }
    MISSED.store(-BOOT_GRACE, Ordering::SeqCst);
    let _ = window.reload();
}

/// The page answers every tick with this; silence is how a stall is noticed.
#[tauri::command]
pub fn always_on_alive() {
    MISSED.store(0, Ordering::SeqCst);
}

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
            let missed = MISSED.fetch_add(1, Ordering::SeqCst) + 1;
            let _ = handle.emit_to("main", "filey://tick", ());
            reload_if_stalled(&handle, missed);
        })
        .ok();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_hidden_page_that_stopped_answering_is_reloaded() {
        assert!(!should_reload(STALLED - 1, false), "a slow moment is not a stall");
        assert!(should_reload(STALLED, false));
        assert!(!should_reload(STALLED * 100, true), "a visible window is the owner's to fix");
        assert!(!should_reload(-BOOT_GRACE, false), "a page still loading gets its grace");
    }
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

/// Held while a long task works: dropping the sender ends the thread that keeps Windows awake.
static KEEP_AWAKE: Mutex<Option<std::sync::mpsc::Sender<()>>> = Mutex::new(None);

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn SetThreadExecutionState(flags: u32) -> u32;
}

/// Stop Windows going to sleep on idle while a long task works (the screen may still turn
/// off). The request belongs to the thread that makes it, so one thread holds it until told
/// to stop; it also ends by itself when Filey quits.
#[tauri::command]
pub fn always_on_keep_awake(on: bool) {
    let Ok(mut slot) = KEEP_AWAKE.lock() else { return };
    if on == slot.is_some() {
        return;
    }
    if !on {
        *slot = None;
        return;
    }
    let (stop, stopped) = std::sync::mpsc::channel::<()>();
    let spawned = std::thread::Builder::new().name("filey-keep-awake".into()).spawn(move || {
        const ES_CONTINUOUS: u32 = 0x8000_0000;
        const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
        #[cfg(windows)]
        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
        }
        let _ = stopped.recv(); // returns once the sender is dropped
        #[cfg(windows)]
        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS);
        }
        let _ = (ES_CONTINUOUS, ES_SYSTEM_REQUIRED);
    });
    if spawned.is_ok() {
        *slot = Some(stop);
    }
}
