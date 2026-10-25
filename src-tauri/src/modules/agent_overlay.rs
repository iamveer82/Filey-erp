//! While Filey AI controls the computer: a soft glowing ring follows the pointer and a small
//! label at the top of the screen says "Filey AI is using your computer · Press Esc to stop".
//!
//! Both are native layered windows owned by one dedicated thread — no WebView. They are
//! click-through at the OS level (WS_EX_TRANSPARENT), never take focus, stay off Alt-Tab and
//! out of the screenshots Filey AI looks at. The old full-screen WebView overlay could hang
//! under memory pressure, and Windows then swapped it for a frozen "ghost" that swallowed
//! every click: the whole desktop looked locked.
//!
//! Only the user's own Esc ends control. A low-level keyboard hook reads the injected flag, so
//! Escape pressed BY the agent (closing a dialog) never cancels its own session.
//!
//! `glide_to` moves the real pointer smoothly to where the agent is about to act, so the user
//! can follow what it does. Windows only, like computer control itself.

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Point {
        x: i32,
        y: i32,
    }
    #[repr(C)]
    struct Size {
        cx: i32,
        cy: i32,
    }
    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }
    #[repr(C)]
    struct Blend {
        op: u8,
        flags: u8,
        alpha: u8,
        format: u8,
    }
    #[repr(C)]
    struct BitmapInfo {
        size: u32,
        width: i32,
        height: i32,
        planes: u16,
        bit_count: u16,
        compression: u32,
        size_image: u32,
        x_ppm: i32,
        y_ppm: i32,
        clr_used: u32,
        clr_important: u32,
        colors: [u32; 1],
    }
    #[repr(C)]
    struct WndClass {
        size: u32,
        style: u32,
        proc_: unsafe extern "system" fn(isize, u32, usize, isize) -> isize,
        cls_extra: i32,
        wnd_extra: i32,
        instance: isize,
        icon: isize,
        cursor: isize,
        background: isize,
        menu_name: *const u16,
        class_name: *const u16,
        icon_small: isize,
    }
    #[repr(C)]
    struct Msg {
        hwnd: isize,
        message: u32,
        wparam: usize,
        lparam: isize,
        time: u32,
        pt: Point,
        private: u32,
    }
    #[repr(C)]
    struct KeyboardHook {
        vk_code: u32,
        scan_code: u32,
        flags: u32,
        time: u32,
        extra: usize,
    }

    type HookProc = unsafe extern "system" fn(i32, usize, isize) -> isize;

    #[link(name = "user32")]
    extern "system" {
        fn RegisterClassExW(class: *const WndClass) -> u16;
        fn CreateWindowExW(ex: u32, class: *const u16, name: *const u16, style: u32, x: i32, y: i32, w: i32, h: i32,
            parent: isize, menu: isize, instance: isize, param: *mut c_void) -> isize;
        fn DefWindowProcW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
        fn DestroyWindow(hwnd: isize) -> i32;
        fn PeekMessageW(msg: *mut Msg, hwnd: isize, min: u32, max: u32, remove: u32) -> i32;
        fn TranslateMessage(msg: *const Msg) -> i32;
        fn DispatchMessageW(msg: *const Msg) -> isize;
        fn MsgWaitForMultipleObjects(count: u32, handles: *const isize, all: i32, ms: u32, mask: u32) -> u32;
        fn SetWindowsHookExW(id: i32, proc_: HookProc, module: isize, thread: u32) -> isize;
        fn UnhookWindowsHookEx(hook: isize) -> i32;
        fn CallNextHookEx(hook: isize, code: i32, wparam: usize, lparam: isize) -> isize;
        fn GetAsyncKeyState(key: i32) -> i16;
        fn GetCursorPos(point: *mut Point) -> i32;
        fn SetCursorPos(x: i32, y: i32) -> i32;
        fn UpdateLayeredWindow(hwnd: isize, dst: isize, at: *const Point, size: *const Size, src: isize,
            src_at: *const Point, key: u32, blend: *const Blend, flags: u32) -> i32;
        fn GetDC(hwnd: isize) -> isize;
        fn ReleaseDC(hwnd: isize, dc: isize) -> i32;
        fn SetWindowDisplayAffinity(hwnd: isize, affinity: u32) -> i32;
        fn ShowWindow(hwnd: isize, command: i32) -> i32;
        fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        fn GetSystemMetrics(index: i32) -> i32;
        fn GetDpiForSystem() -> u32;
        fn DrawTextW(dc: isize, text: *const u16, len: i32, rect: *mut Rect, format: u32) -> i32;
    }
    #[link(name = "gdi32")]
    extern "system" {
        fn CreateCompatibleDC(dc: isize) -> isize;
        fn CreateDIBSection(dc: isize, info: *const BitmapInfo, usage: u32, bits: *mut *mut c_void, section: isize, offset: u32) -> isize;
        fn SelectObject(dc: isize, object: isize) -> isize;
        fn DeleteObject(object: isize) -> i32;
        fn DeleteDC(dc: isize) -> i32;
        fn CreateFontW(height: i32, width: i32, escapement: i32, orientation: i32, weight: i32, italic: u32,
            underline: u32, strike: u32, charset: u32, out_precision: u32, clip_precision: u32, quality: u32,
            pitch: u32, face: *const u16) -> isize;
        fn SetTextColor(dc: isize, color: u32) -> u32;
        fn SetBkMode(dc: isize, mode: i32) -> i32;
        fn GdiFlush() -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(name: *const u16) -> isize;
    }

    const WS_POPUP: u32 = 0x8000_0000;
    const WS_EX: u32 = 0x0008_0000 /* layered */ | 0x20 /* transparent */ | 0x8 /* topmost */
        | 0x80 /* toolwindow */ | 0x0800_0000 /* noactivate */;
    const WH_KEYBOARD_LL: i32 = 13;
    const WM_KEYDOWN: usize = 0x100;
    const WM_SYSKEYDOWN: usize = 0x104;
    const LLKHF_INJECTED: u32 = 0x10;
    const VK_ESCAPE: u32 = 0x1B;
    const ULW_ALPHA: u32 = 2;
    const WDA_EXCLUDEFROMCAPTURE: u32 = 0x11;
    const SW_SHOWNOACTIVATE: i32 = 4;
    const HWND_TOPMOST: isize = -1;
    const SWP_KEEP_TOP: u32 = 0x1 | 0x2 | 0x10; // no size, no move, no activate
    const QS_ALLINPUT: u32 = 0x04FF;
    const PM_REMOVE: u32 = 1;

    /// Bumped by every show and hide: the overlay thread runs only while it holds the current value.
    static RUN: AtomicU64 = AtomicU64::new(0);
    /// Set by the keyboard hook when the user (not the agent) presses Esc.
    static USER_ESC: AtomicBool = AtomicBool::new(false);
    static OWNER: OnceLock<Mutex<Option<(AppHandle, fn())>>> = OnceLock::new();

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// The glow colour follows the mascot chosen in Appearance.
    fn colour(mascot: &str) -> (f32, f32, f32) {
        match mascot {
            "mint" => (16.0, 185.0, 129.0),
            "orange" => (249.0, 115.0, 22.0),
            "purple" => (139.0, 92.0, 246.0),
            _ => (59.0, 130.0, 246.0),
        }
    }

    unsafe extern "system" fn window_proc(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize {
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    /// Runs on the overlay thread for every key on the system: keep it tiny.
    unsafe extern "system" fn keyboard_hook(code: i32, wparam: usize, lparam: isize) -> isize {
        if code >= 0 && (wparam == WM_KEYDOWN || wparam == WM_SYSKEYDOWN) {
            let key = &*(lparam as *const KeyboardHook);
            if key.vk_code == VK_ESCAPE && key.flags & LLKHF_INJECTED == 0 {
                USER_ESC.store(true, Ordering::SeqCst);
            }
        }
        CallNextHookEx(0, code, wparam, lparam)
    }

    /// A premultiplied BGRA bitmap in a memory DC, ready for UpdateLayeredWindow.
    struct Surface {
        dc: isize,
        bitmap: isize,
        old: isize,
        bits: *mut u32,
        width: i32,
        height: i32,
    }

    impl Surface {
        unsafe fn new(width: i32, height: i32) -> Option<Self> {
            let info = BitmapInfo {
                size: 40, width, height: -height, planes: 1, bit_count: 32, compression: 0,
                size_image: 0, x_ppm: 0, y_ppm: 0, clr_used: 0, clr_important: 0, colors: [0],
            };
            let dc = CreateCompatibleDC(0);
            let mut bits: *mut c_void = std::ptr::null_mut();
            let bitmap = CreateDIBSection(dc, &info, 0, &mut bits, 0, 0);
            if dc == 0 || bitmap == 0 || bits.is_null() {
                if bitmap != 0 { DeleteObject(bitmap); }
                if dc != 0 { DeleteDC(dc); }
                return None;
            }
            let old = SelectObject(dc, bitmap);
            Some(Self { dc, bitmap, old, bits: bits as *mut u32, width, height })
        }
        fn pixels(&mut self) -> &mut [u32] {
            // SAFETY: the DIB section holds width*height 32-bit pixels for the surface's lifetime.
            unsafe { std::slice::from_raw_parts_mut(self.bits, (self.width * self.height) as usize) }
        }
        unsafe fn present(&self, hwnd: isize, at: Point, alpha: u8) {
            let size = Size { cx: self.width, cy: self.height };
            let origin = Point::default();
            let blend = Blend { op: 0, flags: 0, alpha, format: 1 };
            let screen = GetDC(0);
            UpdateLayeredWindow(hwnd, screen, &at, &size, self.dc, &origin, 0, &blend, ULW_ALPHA);
            ReleaseDC(0, screen);
        }
    }

    impl Drop for Surface {
        fn drop(&mut self) {
            // SAFETY: these GDI objects were created in `new` and are released once.
            unsafe {
                SelectObject(self.dc, self.old);
                DeleteObject(self.bitmap);
                DeleteDC(self.dc);
            }
        }
    }

    fn premultiplied((r, g, b): (f32, f32, f32), a: f32) -> u32 {
        let a = a.clamp(0.0, 1.0);
        let c = |v: f32| (v * a).round().clamp(0.0, 255.0) as u32;
        ((a * 255.0).round() as u32) << 24 | c(r) << 16 | c(g) << 8 | c(b)
    }

    /// A soft ring with a faint core, centred in the square.
    fn paint_glow(surface: &mut Surface, rgb: (f32, f32, f32)) {
        let side = surface.width as f32;
        let (centre, ring, spread, core) = (side / 2.0, side * 0.27, side * 0.085, side * 0.2);
        let width = surface.width as usize;
        for (i, px) in surface.pixels().iter_mut().enumerate() {
            let (x, y) = ((i % width) as f32 + 0.5 - centre, (i / width) as f32 + 0.5 - centre);
            let d = (x * x + y * y).sqrt();
            let halo = (-((d - ring) / spread).powi(2)).exp() * 0.95;
            let fill = (-(d / core).powi(2)).exp() * 0.28;
            *px = premultiplied(rgb, halo.max(fill));
        }
    }

    /// The "Press Esc to stop" label: white text on a dark capsule.
    unsafe fn label(scale: f32) -> Option<Surface> {
        let text = wide("Filey AI is using your computer  ·  Press Esc to stop");
        let font = CreateFontW(-(15.0 * scale) as i32, 0, 0, 0, 600, 0, 0, 0, 1, 0, 0, 4 /* antialiased */, 0,
            wide("Segoe UI").as_ptr());
        let probe = CreateCompatibleDC(0);
        let old_font = SelectObject(probe, font);
        let mut measured = Rect { left: 0, top: 0, right: 0, bottom: 0 };
        DrawTextW(probe, text.as_ptr(), -1, &mut measured, 0x400 /* calcrect */ | 0x20 | 0x800);
        SelectObject(probe, old_font);
        DeleteDC(probe);
        let (height, pad) = ((36.0 * scale) as i32, (20.0 * scale) as i32);
        let width = measured.right + pad * 2;
        let mut surface = Surface::new(width, height)?;
        let old = SelectObject(surface.dc, font);
        SetTextColor(surface.dc, 0x00FF_FFFF);
        SetBkMode(surface.dc, 1);
        let mut area = Rect { left: 0, top: 0, right: width, bottom: height };
        DrawTextW(surface.dc, text.as_ptr(), -1, &mut area, 0x1 | 0x4 | 0x20 | 0x800);
        GdiFlush();
        SelectObject(surface.dc, old);
        DeleteObject(font);
        // GDI wrote white text with no alpha: use its brightness as coverage over the capsule.
        let (w, h) = (width as f32, height as f32);
        let radius = h / 2.0;
        let stride = width as usize;
        for (i, px) in surface.pixels().iter_mut().enumerate() {
            let ink = ((*px >> 16) & 0xFF).max((*px >> 8) & 0xFF).max(*px & 0xFF) as f32 / 255.0;
            let (x, y) = ((i % stride) as f32 + 0.5, (i / stride) as f32 + 0.5);
            let dx = (x - x.clamp(radius, w - radius)).abs();
            let dy = y - radius;
            let inside = (radius - (dx * dx + dy * dy).sqrt() + 0.5).clamp(0.0, 1.0);
            let bg = (17.0, 24.0, 39.0);
            let mix = |a: f32, b: f32| a * (1.0 - ink) + b * ink;
            *px = premultiplied((mix(bg.0, 255.0), mix(bg.1, 255.0), mix(bg.2, 255.0)), 0.9 * inside);
        }
        Some(surface)
    }

    unsafe fn layered_window(class: &[u16], instance: isize, w: i32, h: i32) -> isize {
        let hwnd = CreateWindowExW(WS_EX, class.as_ptr(), class.as_ptr(), WS_POPUP, 0, 0, w, h, 0, 0, instance,
            std::ptr::null_mut());
        if hwnd != 0 {
            SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        hwnd
    }

    fn overlay_thread(run: u64, rgb: (f32, f32, f32)) {
        // SAFETY: every Win32 object below is created and destroyed on this thread.
        unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let class = wide("FileyAgentOverlay");
            let wc = WndClass {
                size: std::mem::size_of::<WndClass>() as u32, style: 0, proc_: window_proc, cls_extra: 0,
                wnd_extra: 0, instance, icon: 0, cursor: 0, background: 0, menu_name: std::ptr::null(),
                class_name: class.as_ptr(), icon_small: 0,
            };
            RegisterClassExW(&wc); // already registered on later runs; that is fine
            let scale = (GetDpiForSystem().max(96) as f32) / 96.0;
            let side = (92.0 * scale) as i32;
            let Some(mut glow) = Surface::new(side, side) else { return };
            paint_glow(&mut glow, rgb);
            let ring = layered_window(&class, instance, side, side);
            let tag = label(scale);
            let tag_window = tag.as_ref().map_or(0, |t| layered_window(&class, instance, t.width, t.height));
            if let Some(ref t) = tag {
                let at = Point { x: (GetSystemMetrics(0) - t.width) / 2, y: (16.0 * scale) as i32 };
                t.present(tag_window, at, 255);
            }
            USER_ESC.store(false, Ordering::SeqCst);
            let hook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard_hook, instance, 0);
            // Without the hook (rare), fall back to polling Esc; that cannot tell agent keys apart.
            let mut esc_was_down = GetAsyncKeyState(VK_ESCAPE as i32) as u16 & 0x8000 != 0;
            let started = Instant::now();
            let mut last_top = Instant::now();
            let mut msg = std::mem::zeroed::<Msg>();
            while RUN.load(Ordering::SeqCst) == run {
                MsgWaitForMultipleObjects(0, std::ptr::null(), 0, 16, QS_ALLINPUT);
                while PeekMessageW(&mut msg, 0, 0, 0, PM_REMOVE) != 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                if hook == 0 {
                    let down = GetAsyncKeyState(VK_ESCAPE as i32) as u16 & 0x8000 != 0;
                    if down && !esc_was_down { USER_ESC.store(true, Ordering::SeqCst); }
                    esc_was_down = down;
                }
                if USER_ESC.swap(false, Ordering::SeqCst) {
                    let owner = OWNER.get_or_init(Default::default).lock().ok().and_then(|o| o.clone());
                    if let Some((app, revoke)) = owner {
                        revoke(); // ends the session and calls hide(), which ends this loop
                        let _ = app.emit_to("main", "computer-escape", ());
                    }
                    RUN.fetch_add(1, Ordering::SeqCst);
                    break;
                }
                let mut p = Point::default();
                if ring != 0 && GetCursorPos(&mut p) != 0 {
                    // A slow breathing pulse, so the glow reads as "busy" rather than a stuck graphic.
                    let t = started.elapsed().as_secs_f32();
                    let alpha = 175.0 + 80.0 * (t * std::f32::consts::TAU / 1.6).sin();
                    glow.present(ring, Point { x: p.x - side / 2, y: p.y - side / 2 }, alpha as u8);
                }
                if last_top.elapsed() > Duration::from_secs(1) {
                    last_top = Instant::now();
                    for hwnd in [ring, tag_window] {
                        if hwnd != 0 { SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_KEEP_TOP); }
                    }
                }
            }
            if hook != 0 { UnhookWindowsHookEx(hook); }
            for hwnd in [ring, tag_window] {
                if hwnd != 0 { DestroyWindow(hwnd); }
            }
        }
    }

    /// Show the glow and the label, and watch for the user's Esc until `hide`. On Esc,
    /// `revoke` ends the session and the main window hears `computer-escape`.
    pub fn show(app: &AppHandle, revoke: fn(), mascot: &str) {
        let run = RUN.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(mut owner) = OWNER.get_or_init(Default::default).lock() {
            *owner = Some((app.clone(), revoke));
        }
        let rgb = colour(mascot);
        std::thread::Builder::new()
            .name("filey-agent-overlay".into())
            .spawn(move || overlay_thread(run, rgb))
            .ok();
    }

    /// Stop watching and take the overlay away (the thread notices within one frame).
    pub fn hide() {
        RUN.fetch_add(1, Ordering::SeqCst);
    }

    /// Move the real pointer smoothly to (x, y) in screen pixels before the agent acts there,
    /// so the user sees where it is about to click. Ease-out over about a quarter second.
    pub fn glide_to(x: i64, y: i64) {
        // SAFETY: plain Win32 pointer calls with stack values.
        unsafe {
            let (left, top) = (GetSystemMetrics(76), GetSystemMetrics(77));
            let (right, bottom) = (left + GetSystemMetrics(78), top + GetSystemMetrics(79));
            let (Ok(x), Ok(y)) = (i32::try_from(x), i32::try_from(y)) else { return };
            if x < left || y < top || x >= right || y >= bottom { return }
            let mut from = Point::default();
            if GetCursorPos(&mut from) == 0 { return }
            let (dx, dy) = ((x - from.x) as f32, (y - from.y) as f32);
            if dx.abs() + dy.abs() < 4.0 { return }
            const STEPS: i32 = 16;
            for step in 1..=STEPS {
                let t = step as f32 / STEPS as f32;
                let eased = 1.0 - (1.0 - t).powi(3);
                SetCursorPos(from.x + (dx * eased).round() as i32, from.y + (dy * eased).round() as i32);
                std::thread::sleep(Duration::from_millis(15));
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn premultiplies_and_clamps() {
            assert_eq!(premultiplied((255.0, 255.0, 255.0), 1.0), 0xFFFF_FFFF);
            assert_eq!(premultiplied((255.0, 0.0, 0.0), 0.0), 0);
            assert_eq!(premultiplied((200.0, 100.0, 50.0), 0.5) >> 24, 128);
            assert_eq!(premultiplied((10.0, 10.0, 10.0), 2.0) >> 24, 255);
        }

        #[test]
        fn glow_colour_follows_the_mascot() {
            assert_eq!(colour("mint"), (16.0, 185.0, 129.0));
            assert_eq!(colour("anything"), colour("blue"));
        }
    }
}

#[cfg(windows)]
pub use imp::{glide_to, hide, show};

#[cfg(not(windows))]
pub fn show(_app: &tauri::AppHandle, _revoke: fn(), _mascot: &str) {}

#[cfg(not(windows))]
pub fn hide() {}

#[cfg(not(windows))]
pub fn glide_to(_x: i64, _y: i64) {}
