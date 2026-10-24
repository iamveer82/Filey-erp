//! While Filey AI controls the computer: a click-through, always-on-top window over the screen
//! with a light blue edge and the chosen mascot following the pointer (public/agent-overlay.html).
//! The system arrow stays visible. Esc pressed anywhere hands control back.
//!
//! The page needs no Tauri permissions: the pointer is pushed into it with `eval`. Windows only,
//! like computer control itself.

#[cfg(windows)]
mod imp {
    use base64::Engine;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;
    use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

    const LABEL: &str = "agent-overlay";
    const ESC: i32 = 0x1B;

    /// Bumped by every show and hide: a watcher runs only while it holds the current value.
    static RUN: AtomicU64 = AtomicU64::new(0);
    static APP: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();

    fn mascot_bytes(name: &str) -> &'static [u8] {
        match name {
            "mint" => include_bytes!("../../../public/mascots/mint.png"),
            "orange" => include_bytes!("../../../public/mascots/orange.png"),
            "purple" => include_bytes!("../../../public/mascots/purple.png"),
            _ => include_bytes!("../../../public/mascots/blue.png"),
        }
    }

    fn mascot_name(raw: &str) -> String {
        match raw {
            "mint" | "orange" | "purple" | "blue" => raw.to_string(),
            _ => "blue".to_string(),
        }
    }

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(key: i32) -> i16;
        fn GetCursorPos(point: *mut Point) -> i32;
        fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
        fn SetWindowDisplayAffinity(hwnd: isize, affinity: u32) -> i32;
        fn ShowWindow(hwnd: isize, command: i32) -> i32;
    }

    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOOLWINDOW: isize = 0x80;
    const WS_EX_NOACTIVATE: isize = 0x0800_0000;
    const WDA_EXCLUDEFROMCAPTURE: u32 = 0x11;
    const SW_SHOWNOACTIVATE: i32 = 4;

    /// The overlay must never take focus (computer control checks the target window is in front),
    /// never be on Alt-Tab, and never appear in the screenshots Filey AI looks at.
    fn show_passive(hwnd: isize) {
        // SAFETY: Win32 calls on the overlay's own window handle.
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);
            SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
    }

    fn esc_down() -> bool {
        // SAFETY: plain Win32 query with no pointers.
        (unsafe { GetAsyncKeyState(ESC) } as u16 & 0x8000) != 0
    }

    /// Show the overlay and watch for Esc until `hide`. On Esc, `revoke` ends the session and
    /// the main window hears `computer-escape`. `mascot` is blue, mint, orange, or purple.
    pub fn show(app: &AppHandle, revoke: fn(), mascot: &str) {
        let face = mascot_name(mascot);
        let face_url = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(mascot_bytes(&face))
        );
        let run = RUN.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(mut slot) = APP.get_or_init(Default::default).lock() {
            *slot = Some(app.clone());
        }
        let Some(monitor) = app.primary_monitor().ok().flatten() else { return };
        let (origin, scale) = (*monitor.position(), monitor.scale_factor());
        if app.get_webview_window(LABEL).is_none() {
            let size = monitor.size().to_logical::<f64>(scale);
            let at = origin.to_logical::<f64>(scale);
            let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("agent-overlay.html".into()))
                .title("Filey AI is using your computer")
                .transparent(true)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .focused(false)
                .resizable(false)
                .shadow(false)
                .visible(true)
                .inner_size(size.width, size.height)
                .position(at.x, at.y)
                .build();
            if let Ok(window) = built {
                // Clicks and keys go to the apps underneath, as if the overlay were not there.
                let _ = window.set_ignore_cursor_events(true);
                match window.hwnd() {
                    Ok(hwnd) => show_passive(hwnd.0 as isize),
                    Err(_) => {
                        let _ = window.close();
                    }
                }
            }
        }
        let app = app.clone();
        std::thread::spawn(move || {
            // Esc already held when control starts is not a takeover; a new press is.
            let mut was_down = esc_down();
            let mut last = (i32::MIN, i32::MIN);
            let mut face_tries = 0u8;
            while RUN.load(Ordering::SeqCst) == run {
                let down = esc_down();
                if down && !was_down {
                    revoke();
                    hide();
                    let _ = app.emit_to("main", "computer-escape", ());
                    return;
                }
                was_down = down;
                if let Some(window) = app.get_webview_window(LABEL) {
                    if face_tries < 8 {
                        face_tries += 1;
                        let _ = window.eval(format!("window.fileyMascot&&window.fileyMascot({face_url:?})"));
                    }
                    let mut p = Point { x: 0, y: 0 };
                    // SAFETY: `p` outlives the call.
                    if unsafe { GetCursorPos(&mut p) } != 0 && (p.x, p.y) != last {
                        last = (p.x, p.y);
                        let (x, y) = (f64::from(p.x - origin.x) / scale, f64::from(p.y - origin.y) / scale);
                        let _ = window.eval(format!("window.fileyPointer&&window.fileyPointer({x:.1},{y:.1})"));
                    }
                }
                std::thread::sleep(Duration::from_millis(30));
            }
        });
    }

    /// Stop watching and take the overlay away.
    pub fn hide() {
        RUN.fetch_add(1, Ordering::SeqCst);
        let app = APP.get_or_init(Default::default).lock().ok().and_then(|slot| slot.clone());
        if let Some(window) = app.and_then(|app| app.get_webview_window(LABEL)) {
            let _ = window.close();
        }
    }
}

#[cfg(windows)]
pub use imp::{hide, show};

#[cfg(not(windows))]
pub fn show(_app: &tauri::AppHandle, _revoke: fn(), _mascot: &str) {}

#[cfg(not(windows))]
pub fn hide() {}
