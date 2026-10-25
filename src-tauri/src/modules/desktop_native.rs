//! The screenshot route's desktop actions (list_windows, screenshot, click, hover, drag, type,
//! key, scroll) inside Filey's own process through the `windows` crate. It replaces
//! computer_use.ps1: no PowerShell started per action and no C# compiled per action.
//! Request and reply JSON are that helper's, field for field, so computer_use.rs swaps one call.
//!
//! Wiring (not built until then): `#[cfg(windows)] mod desktop_native;` in mod.rs, `blocked_app`
//! in computer_use.rs made `pub(super)`, and in Cargo.toml under cfg(windows):
//! `png = "0.18"` and `windows = { version = "0.61", features = ["Win32_Foundation",
//! "Win32_Graphics_Gdi", "Win32_System_Threading", "Win32_UI_HiDpi",
//! "Win32_UI_Input_KeyboardAndMouse", "Win32_UI_WindowsAndMessaging"] }`.

use base64::Engine;
use serde_json::{json, Value};
use std::time::Duration;
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject, SetBrushOrgEx,
    SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE, SRCCOPY,
};
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY,
    KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL, MOUSEINPUT,
    MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetClassNameW, GetCursorPos, GetForegroundWindow, GetGUIThreadInfo, GetSystemMetrics, GetWindowRect,
    GetWindowTextW, GetWindowThreadProcessId, IsChild, IsIconic, IsWindowVisible, SetCursorPos, SetForegroundWindow, ShowWindow,
    WindowFromPoint, GA_ROOT, GA_ROOTOWNER, GUITHREADINFO, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
    SM_YVIRTUALSCREEN, SW_RESTORE,
};

type Outcome<T> = Result<T, String>;

const MAX_PNG: usize = 4_194_304;
const MAX_EDGE: f64 = 1600.0;

fn handle(id: i64) -> HWND {
    HWND(id as isize as *mut core::ffi::c_void)
}

fn id_of(window: HWND) -> i64 {
    window.0 as isize as i64
}

fn stop_requested() -> Outcome<()> {
    // SAFETY: a plain Win32 query with no pointers.
    if unsafe { GetAsyncKeyState(0x1B) } as u16 & 0x8000 != 0 {
        return Err("Computer action stopped by Escape.".into());
    }
    Ok(())
}

fn title(window: HWND) -> String {
    let mut text = [0u16; 512];
    // SAFETY: the buffer outlives the call; the length it returns is inside the buffer.
    let n = unsafe { GetWindowTextW(window, &mut text) }.clamp(0, 512) as usize;
    String::from_utf16_lossy(&text[..n])
}

fn class_name(window: HWND) -> String {
    let mut text = [0u16; 256];
    // SAFETY: as in `title`.
    let n = unsafe { GetClassNameW(window, &mut text) }.clamp(0, 256) as usize;
    String::from_utf16_lossy(&text[..n])
}

fn process_of(window: HWND) -> u32 {
    let mut process = 0u32;
    // SAFETY: `process` outlives the call.
    unsafe { GetWindowThreadProcessId(window, Some(&mut process)) };
    process
}

fn visible(window: HWND) -> bool {
    // SAFETY: Win32 query on a window handle; a stale handle simply reads as not visible.
    unsafe { IsWindowVisible(window) }.as_bool()
}

fn rect_of(window: HWND) -> Option<RECT> {
    let mut rect = RECT::default();
    // SAFETY: `rect` outlives the call.
    unsafe { GetWindowRect(window, &mut rect) }.ok().map(|_| rect)
}

/// The executable's name without `.exe`, or None when the process cannot be opened.
fn process_name(process: u32) -> Option<String> {
    // SAFETY: the handle is closed below; the buffer and its length outlive the call.
    unsafe {
        let opened = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process).ok()?;
        let mut path = [0u16; 1024];
        let mut size = path.len() as u32;
        let read = QueryFullProcessImageNameW(opened, PROCESS_NAME_WIN32, PWSTR(path.as_mut_ptr()), &mut size);
        let _ = CloseHandle(opened);
        read.ok()?;
        let full = String::from_utf16_lossy(&path[..size as usize]);
        std::path::Path::new(&full).file_stem().map(|stem| stem.to_string_lossy().into_owned())
    }
}

/// Computer tools operate applications, not command shells or credential stores.
fn controllable(process: u32) -> bool {
    process_name(process).is_some_and(|name| !super::computer_use::blocked_app(&name))
}

unsafe extern "system" fn collect(window: HWND, param: LPARAM) -> BOOL {
    // SAFETY: `param` is the Vec that `top_windows` lends for the length of EnumWindows.
    let found = unsafe { &mut *(param.0 as *mut Vec<i64>) };
    if visible(window) && !title(window).is_empty() {
        found.push(id_of(window));
    }
    BOOL(i32::from(found.len() < 100))
}

fn top_windows() -> Vec<i64> {
    let mut found: Vec<i64> = Vec::new();
    // SAFETY: `found` outlives EnumWindows, which calls `collect` synchronously. A FALSE from the
    // callback (the 100-window cap) reads as an error here and is not one.
    let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut found as *mut Vec<i64> as isize)) };
    found
}

fn list_windows(request: &Value) -> Value {
    let mut candidates = top_windows();
    for extra in request["browser_windows"].as_array().into_iter().flatten() {
        if let Some(id) = extra.as_i64().or_else(|| extra.as_str().and_then(|s| s.parse().ok())) {
            candidates.push(id);
        }
    }
    let mut seen = std::collections::HashSet::new();
    candidates.retain(|id| seen.insert(*id));
    let root = request["root_window_id"].as_str().filter(|s| !s.is_empty());
    let dialog_owner = request["dialog_owner_id"].as_str().filter(|s| !s.is_empty()).or(root);
    let strict = request["strict_browser"].as_bool() == Some(true);
    let windows: Vec<Value> = candidates
        .into_iter()
        .filter_map(|id| {
            let window = handle(id);
            let process = process_of(window);
            // SAFETY: Win32 query on a window handle.
            let root_owner = id_of(unsafe { GetAncestor(window, GA_ROOTOWNER) }).to_string();
            let class = class_name(window);
            let in_scope = root.is_none_or(|root| {
                id.to_string() == root || (!strict && Some(root_owner.as_str()) == dialog_owner && class == "#32770")
            });
            (controllable(process) && visible(window) && in_scope).then(|| {
                json!({
                    "window_id": id.to_string(), "title": title(window), "process_id": process,
                    // SAFETY: Win32 query on a window handle.
                    "minimized": unsafe { IsIconic(window) }.as_bool(),
                    "root_owner_id": root_owner, "window_class": class,
                })
            })
        })
        .collect();
    json!({ "windows": windows })
}

/// The window an input action was authorized for, as its screenshot saw it.
struct Target {
    window: HWND,
    bounds: RECT,
    process: u32,
}

impl Target {
    fn check(&self) -> Outcome<()> {
        stop_requested()?;
        // SAFETY: Win32 queries on window handles.
        let front = unsafe { GetForegroundWindow() == GetAncestor(self.window, GA_ROOT) };
        let same = rect_of(self.window).is_some_and(|r| {
            r.left == self.bounds.left && r.top == self.bounds.top && r.right == self.bounds.right && r.bottom == self.bounds.bottom
        });
        if !front || !visible(self.window) || process_of(self.window) != self.process || !same {
            return Err("The target window changed. Take another screenshot before acting.".into());
        }
        Ok(())
    }

    fn check_point(&self, x: i32, y: i32) -> Outcome<()> {
        self.check()?;
        // SAFETY: Win32 queries; POINT is passed by value.
        let hit = unsafe { WindowFromPoint(POINT { x, y }) };
        let owned = hit == self.window || unsafe { IsChild(self.window, hit) }.as_bool();
        let inside = x >= self.bounds.left && x < self.bounds.right && y >= self.bounds.top && y < self.bounds.bottom;
        if !inside || !owned {
            return Err("Another window covers this point. Take a fresh screenshot before acting.".into());
        }
        Ok(())
    }

    fn check_keyboard_focus(&self) -> Outcome<()> {
        // SAFETY: Win32 query on a window handle.
        if unsafe { GetAncestor(self.window, GA_ROOT) } == self.window {
            return Ok(());
        }
        let mut info = GUITHREADINFO { cbSize: std::mem::size_of::<GUITHREADINFO>() as u32, ..Default::default() };
        // SAFETY: `info` outlives the call and carries its own size.
        let read = unsafe { GetGUIThreadInfo(0, &mut info) }.is_ok();
        let inside = read && (info.hwndFocus == self.window || unsafe { IsChild(self.window, info.hwndFocus) }.as_bool());
        if !inside {
            return Err("Click inside the browser before typing. Keyboard focus is outside this tab.".into());
        }
        Ok(())
    }

    fn move_to(&self, x: i32, y: i32) -> Outcome<()> {
        self.check_point(x, y)?;
        // SAFETY: plain Win32 calls; `at` outlives GetCursorPos.
        unsafe {
            SetCursorPos(x, y).map_err(|_| "Windows blocked cursor movement.".to_string())?;
            let mut at = POINT::default();
            if GetCursorPos(&mut at).is_err() || at.x != x || at.y != y {
                return Err("The cursor could not reach the selected point. No click or scroll was sent.".into());
            }
        }
        Ok(())
    }

    fn send(&self, inputs: &[INPUT], release_left_on_failure: bool) -> Outcome<()> {
        self.check()?;
        if inputs.iter().any(|input| input.r#type == INPUT_KEYBOARD) {
            self.check_keyboard_focus()?;
        }
        // SAFETY: the slice and the INPUT size describe valid input records.
        let accepted = unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) } as usize;
        if accepted != inputs.len() {
            // Releasing a partially injected drag is cleanup, never a replay, so it is not gated
            // on focus or Escape: a held button must be let go.
            if release_left_on_failure && accepted > 0 {
                // SAFETY: as above.
                unsafe { SendInput(&[mouse(MOUSEEVENTF_LEFTUP, 0, 0, 0)], std::mem::size_of::<INPUT>() as i32) };
            }
            return Err("Windows blocked input. Elevated or protected windows cannot be controlled.".into());
        }
        Ok(())
    }

    fn type_text(&self, text: &str) -> Outcome<()> {
        for unit in text.encode_utf16() {
            // A line break must not press bare Enter and send a chat early.
            if unit == u16::from(b'\n') {
                self.send(&[key(16, false), key(13, false), key(13, true), key(16, true)], false)?;
                continue;
            }
            let up = KEYBD_EVENT_FLAGS(KEYEVENTF_UNICODE.0 | KEYEVENTF_KEYUP.0);
            self.send(&[keyboard(0, unit, KEYEVENTF_UNICODE), keyboard(0, unit, up)], false)?;
        }
        Ok(())
    }

    fn press(&self, code: u16, control: bool) -> Outcome<()> {
        if control {
            self.send(&[key(17, false), key(code, false), key(code, true), key(17, true)], false)
        } else {
            self.send(&[key(code, false), key(code, true)], false)
        }
    }

    fn click(&self, right: bool, twice: bool) -> Outcome<()> {
        let (down, up) = if right { (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP) } else { (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP) };
        let pair = [mouse(down, 0, 0, 0), mouse(up, 0, 0, 0)];
        self.send(&pair, false)?;
        if twice {
            self.send(&pair, false)?;
        }
        Ok(())
    }

    fn scroll(&self, delta: i32, horizontal: bool) -> Outcome<()> {
        let flags = if horizontal { MOUSEEVENTF_HWHEEL } else { MOUSEEVENTF_WHEEL };
        self.send(&[mouse(flags, 0, 0, (delta * 120) as u32)], false)
    }

    fn drag(&self, x: i32, y: i32, to_x: i32, to_y: i32) -> Outcome<()> {
        // SAFETY: plain Win32 queries.
        let (left, top, width, height) = unsafe {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN),
                GetSystemMetrics(SM_CYVIRTUALSCREEN),
            )
        };
        if width < 2 || height < 2 {
            return Err("Display dimensions are unavailable.".into());
        }
        let mut inputs = vec![mouse(MOUSEEVENTF_LEFTDOWN, 0, 0, 0)];
        let absolute = MOUSE_EVENT_FLAGS(MOUSEEVENTF_MOVE.0 | MOUSEEVENTF_ABSOLUTE.0 | MOUSEEVENTF_VIRTUALDESK.0);
        for i in 1..=16 {
            let (px, py) = (x + (to_x - x) * i / 16, y + (to_y - y) * i / 16);
            self.check_point(px, py)?;
            let dx = (i64::from(px - left) * 65535 / i64::from(width - 1)) as i32;
            let dy = (i64::from(py - top) * 65535 / i64::from(height - 1)) as i32;
            inputs.push(mouse(absolute, dx, dy, 0));
        }
        inputs.push(mouse(MOUSEEVENTF_LEFTUP, 0, 0, 0));
        // No held button spans calls; a partial insert gets a best-effort release in `send`.
        // An uncertain drag is never retried.
        self.send(&inputs, true)
    }
}

fn mouse(flags: MOUSE_EVENT_FLAGS, dx: i32, dy: i32, data: u32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 { mi: MOUSEINPUT { dx, dy, mouseData: data, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

fn keyboard(code: u16, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(code), wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

/// A virtual key; the navigation block (PageUp..ArrowDown, Delete) is sent as extended keys.
fn key(code: u16, up: bool) -> INPUT {
    let mut flags = if up { KEYEVENTF_KEYUP.0 } else { 0 };
    if (33..=40).contains(&code) || code == 46 {
        flags |= KEYEVENTF_EXTENDEDKEY.0;
    }
    keyboard(code, 0, KEYBD_EVENT_FLAGS(flags))
}

/// The capture area scaled so its long edge is at most 1600 px, as PNG bytes.
fn capture_png(x: i32, y: i32, width: i32, height: i32) -> Outcome<(Vec<u8>, i32, i32)> {
    let scale = (MAX_EDGE / f64::from(width.max(height))).min(1.0);
    let (image_width, image_height) = (((f64::from(width) * scale) as i32).max(1), ((f64::from(height) * scale) as i32).max(1));
    let mut bgra = vec![0u8; image_width as usize * image_height as usize * 4];
    // SAFETY: every GDI object made here is released below; `bgra` and `info` outlive GetDIBits,
    // and the bitmap is deselected before GetDIBits reads it, as that call requires.
    let (copied, lines) = unsafe {
        let screen = GetDC(None);
        let memory = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, image_width, image_height);
        let previous = SelectObject(memory, bitmap.into());
        SetStretchBltMode(memory, HALFTONE);
        let _ = SetBrushOrgEx(memory, 0, 0, None);
        let copied = StretchBlt(memory, 0, 0, image_width, image_height, Some(screen), x, y, width, height, SRCCOPY).as_bool();
        SelectObject(memory, previous);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: image_width,
                biHeight: -image_height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let lines = GetDIBits(memory, bitmap, 0, image_height as u32, Some(bgra.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        (copied, lines)
    };
    if !copied || lines != image_height {
        return Err("Could not capture the window. Take another screenshot.".into());
    }
    let rgb: Vec<u8> = bgra.chunks_exact(4).flat_map(|p| [p[2], p[1], p[0]]).collect();
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, image_width as u32, image_height as u32);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(&rgb).map_err(|e| e.to_string())?;
        writer.finish().map_err(|e| e.to_string())?;
    }
    Ok((png_bytes, image_width, image_height))
}

fn bounds_json(bounds: &Value) -> Option<RECT> {
    let n = |k: &str| bounds[k].as_i64().map(|v| v as i32);
    let (x, y, width, height) = (n("x")?, n("y")?, n("width")?, n("height")?);
    Some(RECT { left: x, top: y, right: x + width, bottom: y + height })
}

/// Restores the thread's DPI awareness when an action ends, however it ends.
struct DpiScope(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT);

impl Drop for DpiScope {
    fn drop(&mut self) {
        // SAFETY: restores the context this thread had before `run`.
        unsafe { SetThreadDpiAwarenessContext(self.0) };
    }
}

/// One helper request, answered with the JSON computer_use.ps1 printed.
pub fn run(request: &Value) -> Outcome<Value> {
    // Physical pixels for every rectangle and point, like the helper's SetProcessDPIAware.
    // SAFETY: per-thread setting, restored by the guard.
    let _dpi = DpiScope(unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) });
    stop_requested()?;
    let action = request["action"].as_str().unwrap_or_default();
    if action == "list_windows" {
        return Ok(list_windows(request));
    }

    let window_id = request["window_id"].as_str().and_then(|s| s.parse::<i64>().ok());
    let window = window_id.map(handle).filter(|w| visible(*w)).ok_or("The selected window is no longer available. List windows again.")?;
    let process = process_of(window);
    if request["process_id"].as_u64() != Some(u64::from(process)) {
        return Err("The selected window was replaced. List windows again.".into());
    }
    if !controllable(process) {
        return Err("This protected application is not available to computer tools.".into());
    }
    let expected = bounds_json(&request["bounds"]);
    // SAFETY: Win32 calls on the selected window handle.
    unsafe {
        if action == "screenshot" {
            if IsIconic(window).as_bool() {
                let _ = ShowWindow(window, SW_RESTORE);
            }
        } else {
            let before = rect_of(window);
            if IsIconic(window).as_bool() || before.is_none() || before.map(|r| (r.left, r.top, r.right, r.bottom)) != expected.map(|r| (r.left, r.top, r.right, r.bottom)) {
                return Err("The window moved or resized. Take a new screenshot before acting.".into());
            }
        }
        let front = GetAncestor(window, GA_ROOT);
        let _ = SetForegroundWindow(front);
        std::thread::sleep(Duration::from_millis(180));
        stop_requested()?;
        if GetForegroundWindow() != front {
            return Err("The selected window is not in front. Bring it to the foreground and take another screenshot.".into());
        }
    }
    let rect = rect_of(window).ok_or("Could not locate the selected window.")?;
    let (width, height) = (rect.right - rect.left, rect.bottom - rect.top);
    if width <= 0 || height <= 0 || i64::from(width) * i64::from(height) > 16_000_000 {
        return Err("Window size is unsupported. Resize it and take another screenshot.".into());
    }

    if action == "screenshot" {
        // SAFETY: plain Win32 queries.
        let (left, top, right, bottom) = unsafe {
            let (x, y) = (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN));
            (x, y, x + GetSystemMetrics(SM_CXVIRTUALSCREEN), y + GetSystemMetrics(SM_CYVIRTUALSCREEN))
        };
        // Maximized windows include an invisible border outside the display. Capture only visible
        // pixels while keeping the full window bounds for the input guard.
        let (mut cx, mut cy) = (rect.left.max(left), rect.top.max(top));
        let (mut cw, mut ch) = (rect.right.min(right) - cx, rect.bottom.min(bottom) - cy);
        let region = &request["browser_region"];
        if !region.is_null() {
            let r = |k: &str| region[k].as_f64().map(|v| v as i32);
            let (rx, ry, rw, rh) = (r("x"), r("y"), r("width"), r("height"));
            let (Some(rx), Some(ry), Some(rw), Some(rh)) = (rx, ry, rw, rh) else {
                return Err("Keep the entire browser panel visible before taking a screenshot.".into());
            };
            if rx < cx || ry < cy || rx + rw > cx + cw || ry + rh > cy + ch {
                return Err("Keep the entire browser panel visible before taking a screenshot.".into());
            }
            (cx, cy, cw, ch) = (rx, ry, rw, rh);
        }
        if cw <= 0 || ch <= 0 {
            return Err("Move the window onto the display before capturing it.".into());
        }
        let (png_bytes, image_width, image_height) = capture_png(cx, cy, cw, ch)?;
        if png_bytes.len() > MAX_PNG {
            return Err("Screenshot is too large. Resize the window and try again.".into());
        }
        return Ok(json!({
            "window_id": request["window_id"], "process_id": process, "title": title(window),
            "width": image_width, "height": image_height,
            "bounds": { "x": rect.left, "y": rect.top, "width": width, "height": height },
            "capture_bounds": { "x": cx, "y": cy, "width": cw, "height": ch },
            "browser_region": request["browser_region"],
            "image": { "dataBase64": base64::engine::general_purpose::STANDARD.encode(png_bytes), "mediaType": "image/png" },
        }));
    }

    if expected.map(|r| (r.left, r.top, r.right, r.bottom)) != Some((rect.left, rect.top, rect.right, rect.bottom)) {
        return Err("The window moved or resized. Take a new screenshot before acting.".into());
    }
    let target = Target { window, bounds: rect, process };
    target.check()?;
    let at = |k: &str| request[k].as_i64().map(|v| v as i32).ok_or_else(|| format!("{k} is missing."));
    if matches!(action, "click" | "hover" | "drag" | "scroll") {
        target.move_to(at("screen_x")?, at("screen_y")?)?;
    }
    match action {
        "click" => {
            target.check_point(at("screen_x")?, at("screen_y")?)?;
            target.click(request["button"] == "right", request["double_click"].as_bool() == Some(true))?;
        }
        "hover" => target.check_point(at("screen_x")?, at("screen_y")?)?,
        "drag" => target.drag(at("screen_x")?, at("screen_y")?, at("screen_to_x")?, at("screen_to_y")?)?,
        "type" => target.type_text(request["text"].as_str().unwrap_or_default())?,
        "scroll" => {
            target.check_point(at("screen_x")?, at("screen_y")?)?;
            target.scroll(at("delta")?, request["axis"] == "horizontal")?;
        }
        "key" => {
            let code = request["virtual_key"].as_u64().and_then(|k| u16::try_from(k).ok()).ok_or("virtual_key is missing.")?;
            target.press(code, request["control"].as_bool() == Some(true))?;
        }
        _ => return Err("Unsupported computer action.".into()),
    }
    Ok(json!({ "ok": true, "action": action, "window_id": request["window_id"], "needs_screenshot": true }))
}
