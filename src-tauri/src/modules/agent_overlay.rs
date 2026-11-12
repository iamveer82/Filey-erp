//! While Filey AI controls the computer: a rounded black dart with a thick white outline and a
//! soft shadow follows the pointer. A pale label at the top of the screen says "Press Esc to
//! stop". There is no speech bubble: the pointer alone identifies the agent.
//!
//! The cursor is the open-computer-use idea (a drawn software cursor, not the system arrow). It
//! is drawn from a signed distance to the dart's shape, so it stays smooth at every display scale;
//! its rounded tip is the hotspot. The Windows arrow itself is hidden for as long as the dart
//! shows, and Windows brings it back by itself if Filey dies.
//!
//! The overlay is a native layered window owned by one dedicated thread — no WebView. It is
//! click-through at the OS level (WS_EX_TRANSPARENT), never takes focus, stays off Alt-Tab and out
//! of the screenshots Filey AI looks at. The old full-screen WebView overlay could hang under
//! memory pressure, and Windows then swapped it for a frozen "ghost" that swallowed every click:
//! the whole desktop looked locked.
//!
//! Only the user's own Esc ends control. A low-level keyboard hook reads the injected flag, so
//! Escape pressed BY the agent (closing a dialog) never cancels its own session.
//!
//! `glide_to` moves the real pointer smoothly to where the agent is about to act, so the user can
//! follow what it does. Windows only, like computer control itself.

#[cfg(windows)]
mod imp {
    use std::f32::consts::TAU;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
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
        fn CreateWindowExW(
            ex: u32,
            class: *const u16,
            name: *const u16,
            style: u32,
            x: i32,
            y: i32,
            w: i32,
            h: i32,
            parent: isize,
            menu: isize,
            instance: isize,
            param: *mut c_void,
        ) -> isize;
        fn DefWindowProcW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
        fn DestroyWindow(hwnd: isize) -> i32;
        fn PeekMessageW(msg: *mut Msg, hwnd: isize, min: u32, max: u32, remove: u32) -> i32;
        fn TranslateMessage(msg: *const Msg) -> i32;
        fn DispatchMessageW(msg: *const Msg) -> isize;
        fn MsgWaitForMultipleObjects(
            count: u32,
            handles: *const isize,
            all: i32,
            ms: u32,
            mask: u32,
        ) -> u32;
        fn SetWindowsHookExW(id: i32, proc_: HookProc, module: isize, thread: u32) -> isize;
        fn UnhookWindowsHookEx(hook: isize) -> i32;
        fn CallNextHookEx(hook: isize, code: i32, wparam: usize, lparam: isize) -> isize;
        fn GetAsyncKeyState(key: i32) -> i16;
        fn GetCursorPos(point: *mut Point) -> i32;
        fn SetCursorPos(x: i32, y: i32) -> i32;
        fn UpdateLayeredWindow(
            hwnd: isize,
            dst: isize,
            at: *const Point,
            size: *const Size,
            src: isize,
            src_at: *const Point,
            key: u32,
            blend: *const Blend,
            flags: u32,
        ) -> i32;
        fn GetDC(hwnd: isize) -> isize;
        fn ReleaseDC(hwnd: isize, dc: isize) -> i32;
        fn SetWindowDisplayAffinity(hwnd: isize, affinity: u32) -> i32;
        fn ShowWindow(hwnd: isize, command: i32) -> i32;
        fn SetWindowPos(
            hwnd: isize,
            after: isize,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
        fn GetSystemMetrics(index: i32) -> i32;
        fn GetDpiForSystem() -> u32;
        fn DrawTextW(dc: isize, text: *const u16, len: i32, rect: *mut Rect, format: u32) -> i32;
    }
    #[link(name = "gdi32")]
    extern "system" {
        fn CreateCompatibleDC(dc: isize) -> isize;
        fn CreateDIBSection(
            dc: isize,
            info: *const BitmapInfo,
            usage: u32,
            bits: *mut *mut c_void,
            section: isize,
            offset: u32,
        ) -> isize;
        fn SelectObject(dc: isize, object: isize) -> isize;
        fn DeleteObject(object: isize) -> i32;
        fn DeleteDC(dc: isize) -> i32;
        fn CreateFontW(
            height: i32,
            width: i32,
            escapement: i32,
            orientation: i32,
            weight: i32,
            italic: u32,
            underline: u32,
            strike: u32,
            charset: u32,
            out_precision: u32,
            clip_precision: u32,
            quality: u32,
            pitch: u32,
            face: *const u16,
        ) -> isize;
        fn SetTextColor(dc: isize, color: u32) -> u32;
        fn SetBkMode(dc: isize, mode: i32) -> i32;
        fn GdiFlush() -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(name: *const u16) -> isize;
        fn LoadLibraryExW(name: *const u16, file: isize, flags: u32) -> isize;
        fn GetProcAddress(module: isize, name: *const u8) -> *const c_void;
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
    const LOAD_FROM_SYSTEM32: u32 = 0x800; // LOAD_LIBRARY_SEARCH_SYSTEM32

    /// The pointer: a rounded dart, black body inside a thick white outline with a soft shadow,
    /// drawn from its geometry so it is crisp at every display scale. Cursor pixels, tip first.
    const DART: [(f32, f32); 4] = [(0.0, 0.0), (18.0, 7.0), (9.8, 9.8), (7.0, 18.0)];
    /// Corner rounding of the black body.
    const ROUND: f32 = 1.0;
    /// ROUND / sqrt(2): moves the dart so its rounded tip lands exactly on the hotspot (0, 0).
    const TIP_SHIFT: f32 = 0.707;
    /// The white outline is this many cursor pixels wide around the body.
    const OUTLINE: f32 = 2.2;
    /// Shadow offset right, down, and its blur: keeps the white edge visible on white windows.
    const SHADOW: (f32, f32, f32) = (0.5, 1.0, 1.8);
    /// Transparent breathing room around the outline, in cursor pixels.
    const PAD: f32 = 3.0;
    /// The cursor is drawn this many times its size before DPI scaling. At 1.2 the dart is a
    /// touch larger than the Windows arrow, so on a PC where the arrow could not be hidden it
    /// sits inside the dart instead of poking out of it. It was 2.4, which read as oversized.
    const CURSOR_SCALE: f32 = 1.2;
    const CURSOR_BLUE: (f32, f32, f32) = (11.0, 124.0, 255.0);
    const CURSOR_INK: (f32, f32, f32) = (5.0, 5.0, 7.0);
    const CURSOR_EDGE: (f32, f32, f32) = (255.0, 255.0, 255.0);

    /// Bumped by every show and hide: the overlay thread runs only while it holds the current value.
    static RUN: AtomicU64 = AtomicU64::new(0);
    /// Set by the keyboard hook when the user (not the agent) presses Esc.
    static USER_ESC: AtomicBool = AtomicBool::new(false);
    /// Bumped by the computer helper before a click or drag; the thread plays one pulse.
    static PULSE: AtomicU64 = AtomicU64::new(0);
    static OWNER: OnceLock<Mutex<Option<(AppHandle, fn())>>> = OnceLock::new();
    /// Overlay threads hiding the Windows pointer right now. A new session can start a moment
    /// before the last one's thread has ended, so the arrow returns with the last of them.
    static HIDERS: AtomicUsize = AtomicUsize::new(0);

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    type ShowPointer = unsafe extern "system" fn(i32) -> i32;

    /// MagShowSystemCursor, loaded on first use. `None` when this Windows cannot do it; the arrow
    /// then stays visible next to the dart.
    ///
    /// Measured on Windows 11: the call needs MagInitialize once per process (any thread), and
    /// after MagUninitialize it fails, even to show the pointer again. So the magnifier runtime
    /// is started once and left alone.
    fn show_pointer() -> Option<ShowPointer> {
        static CALL: OnceLock<Option<ShowPointer>> = OnceLock::new();
        // SAFETY: documented exports of a system library, called with their documented signatures.
        *CALL.get_or_init(|| unsafe {
            // From System32 only, never from a folder a user can write to.
            let module = LoadLibraryExW(wide("Magnification.dll").as_ptr(), 0, LOAD_FROM_SYSTEM32);
            if module == 0 {
                return None;
            }
            let find = |name: &[u8]| {
                let found = GetProcAddress(module, name.as_ptr());
                (!found.is_null()).then_some(found)
            };
            let start = std::mem::transmute::<*const c_void, unsafe extern "system" fn() -> i32>(
                find(b"MagInitialize\0")?,
            );
            let show = std::mem::transmute::<*const c_void, ShowPointer>(find(b"MagShowSystemCursor\0")?);
            (start() != 0).then_some(show)
        })
    }

    /// While this lives the Windows pointer is hidden everywhere, so only the drawn dart shows.
    /// Windows ties the hiding to this process and shows the pointer again by itself when the
    /// process ends, even by `taskkill /F`: a crash cannot leave the desktop without a pointer.
    struct HiddenPointer(ShowPointer);

    impl HiddenPointer {
        fn new() -> Option<Self> {
            let show = show_pointer()?;
            // SAFETY: see show_pointer.
            if unsafe { show(0) } == 0 {
                return None;
            }
            HIDERS.fetch_add(1, Ordering::SeqCst);
            Some(Self(show))
        }

        /// Hide it again. Windows keeps no count (the last call wins), and an overlay that was
        /// just replaced may have shown the pointer a moment after this one hid it.
        fn keep(&self) {
            // SAFETY: see show_pointer.
            unsafe { (self.0)(0) };
        }
    }

    impl Drop for HiddenPointer {
        fn drop(&mut self) {
            if HIDERS.fetch_sub(1, Ordering::SeqCst) == 1 {
                // SAFETY: see show_pointer.
                unsafe { (self.0)(1) };
            }
        }
    }

    unsafe extern "system" fn window_proc(
        hwnd: isize,
        msg: u32,
        wparam: usize,
        lparam: isize,
    ) -> isize {
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
                size: 40,
                width,
                height: -height,
                planes: 1,
                bit_count: 32,
                compression: 0,
                size_image: 0,
                x_ppm: 0,
                y_ppm: 0,
                clr_used: 0,
                clr_important: 0,
                colors: [0],
            };
            let dc = CreateCompatibleDC(0);
            let mut bits: *mut c_void = std::ptr::null_mut();
            let bitmap = CreateDIBSection(dc, &info, 0, &mut bits, 0, 0);
            if dc == 0 || bitmap == 0 || bits.is_null() {
                if bitmap != 0 {
                    DeleteObject(bitmap);
                }
                if dc != 0 {
                    DeleteDC(dc);
                }
                return None;
            }
            let old = SelectObject(dc, bitmap);
            Some(Self {
                dc,
                bitmap,
                old,
                bits: bits as *mut u32,
                width,
                height,
            })
        }
        fn pixels(&mut self) -> &mut [u32] {
            // SAFETY: the DIB section holds width*height 32-bit pixels for the surface's lifetime.
            unsafe {
                std::slice::from_raw_parts_mut(self.bits, (self.width * self.height) as usize)
            }
        }
        unsafe fn present(&self, hwnd: isize, at: Point, alpha: u8) {
            let size = Size {
                cx: self.width,
                cy: self.height,
            };
            let origin = Point::default();
            let blend = Blend {
                op: 0,
                flags: 0,
                alpha,
                format: 1,
            };
            let screen = GetDC(0);
            UpdateLayeredWindow(
                hwnd, screen, &at, &size, self.dc, &origin, 0, &blend, ULW_ALPHA,
            );
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

    /// Composite one straight-alpha colour over the accumulating pixel.
    fn blend(rgb: &mut [f32; 3], alpha: &mut f32, colour: (f32, f32, f32), a: f32) {
        let a = a.clamp(0.0, 1.0);
        if a <= 0.0 {
            return;
        }
        let keep = 1.0 - a;
        rgb[0] = colour.0 * a + rgb[0] * keep;
        rgb[1] = colour.1 * a + rgb[1] * keep;
        rgb[2] = colour.2 * a + rgb[2] * keep;
        *alpha = a + *alpha * keep;
    }

    fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
        if (edge1 - edge0).abs() < f32::EPSILON {
            return if x >= edge1 { 1.0 } else { 0.0 };
        }
        let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    }

    /// Signed distance from `p` to a polygon, negative inside (Inigo Quilez's sdPolygon).
    fn polygon_distance(p: (f32, f32), v: &[(f32, f32)]) -> f32 {
        let dot = |a: (f32, f32), b: (f32, f32)| a.0 * b.0 + a.1 * b.1;
        let sub = |a: (f32, f32), b: (f32, f32)| (a.0 - b.0, a.1 - b.1);
        let mut d = dot(sub(p, v[0]), sub(p, v[0]));
        let mut sign = 1.0;
        let mut j = v.len() - 1;
        for i in 0..v.len() {
            let e = sub(v[j], v[i]);
            let w = sub(p, v[i]);
            let t = (dot(w, e) / dot(e, e)).clamp(0.0, 1.0);
            d = d.min(dot((w.0 - e.0 * t, w.1 - e.1 * t), (w.0 - e.0 * t, w.1 - e.1 * t)));
            let c = (p.1 >= v[i].1, p.1 < v[j].1, e.0 * w.1 > e.1 * w.0);
            if (c.0 && c.1 && c.2) || (!c.0 && !c.1 && !c.2) {
                sign = -sign;
            }
            j = i;
        }
        sign * d.sqrt()
    }

    /// Signed distance to the rounded dart at a hotspot-relative point, negative inside.
    fn dart_distance(x: f32, y: f32) -> f32 {
        polygon_distance((x - TIP_SHIFT, y - TIP_SHIFT), &DART) - ROUND
    }

    struct Glyph {
        scale: f32,
        /// Cursor window top-left relative to the hotspot, in cursor pixels.
        left: f32,
        top: f32,
        width: i32,
        height: i32,
    }

    impl Glyph {
        fn pixel_width(&self) -> i32 {
            self.width
        }
        fn pixel_height(&self) -> i32 {
            self.height
        }
    }

    /// The window around the dart, outline and shadow at this scale.
    fn load_glyph(scale: f32) -> Glyph {
        let near = -(OUTLINE + PAD);
        let far = 18.0 + TIP_SHIFT + ROUND + OUTLINE + SHADOW.1 + SHADOW.2 + PAD;
        let side = ((far - near) * scale).round().max(1.0) as i32;
        Glyph { scale, left: near, top: near, width: side, height: side }
    }

    fn render(surface: &mut Surface, glyph: &Glyph, angle: f32, pulse: Option<f32>) {
        let width = surface.width as usize;
        let height = surface.height as usize;
        let scale = glyph.scale;
        let (sin, cos) = angle.sin_cos();
        let pixels = surface.pixels();
        for y in 0..height {
            for x in 0..width {
                // Window point -> local source coordinates relative to the hotspot, rotated around
                // the hotspot so the pointer leans into its movement.
                let vx = glyph.left + (x as f32 + 0.5) / scale;
                let vy = glyph.top + (y as f32 + 0.5) / scale;
                let rx = vx * cos + vy * sin;
                let ry = -vx * sin + vy * cos;
                let distance = dart_distance(rx, ry);

                let mut rgb = [0.0f32; 3];
                let mut alpha = 0.0f32;
                let aa = 0.5;

                // Click: a blue ring leaving the hotspot, under the pointer.
                if let Some(progress) = pulse {
                    let radius = 7.0 + progress * 22.0;
                    let band =
                        (-((rx * rx + ry * ry).sqrt() - radius) / 1.8).exp() * (1.0 - progress);
                    blend(&mut rgb, &mut alpha, CURSOR_BLUE, 0.8 * band);
                }

                // Soft shadow, the white outline, then the black body on top.
                let shadow = dart_distance(rx - SHADOW.0, ry - SHADOW.1);
                let shade = 1.0 - smoothstep(OUTLINE - SHADOW.2, OUTLINE + SHADOW.2, shadow);
                blend(&mut rgb, &mut alpha, CURSOR_INK, 0.32 * shade);
                let edge = 1.0 - smoothstep(OUTLINE - aa, OUTLINE + aa, distance);
                blend(&mut rgb, &mut alpha, CURSOR_EDGE, edge);
                let body = 1.0 - smoothstep(-aa, aa, distance);
                blend(&mut rgb, &mut alpha, CURSOR_INK, body);

                pixels[y * width + x] = premultiplied((rgb[0], rgb[1], rgb[2]), alpha);
            }
        }
    }

    /// The "Press Esc to stop" label: white text on a dark capsule.
    unsafe fn label(scale: f32) -> Option<Surface> {
        let text = wide("Filey is using your computer  ·  Press Esc to stop");
        let font = CreateFontW(
            -(14.0 * scale) as i32,
            0,
            0,
            0,
            600,
            0,
            0,
            0,
            1,
            0,
            0,
            4, /* antialiased */
            0,
            wide("Segoe UI").as_ptr(),
        );
        let probe = CreateCompatibleDC(0);
        let old_font = SelectObject(probe, font);
        let mut measured = Rect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        DrawTextW(
            probe,
            text.as_ptr(),
            -1,
            &mut measured,
            0x400 /* calcrect */ | 0x20 | 0x800,
        );
        SelectObject(probe, old_font);
        DeleteDC(probe);
        let (height, pad) = ((34.0 * scale) as i32, (18.0 * scale) as i32);
        let width = measured.right + pad * 2;
        let mut surface = match Surface::new(width, height) {
            Some(surface) => surface,
            None => {
                DeleteObject(font);
                return None;
            }
        };
        let old = SelectObject(surface.dc, font);
        SetTextColor(surface.dc, 0x00FF_FFFF);
        SetBkMode(surface.dc, 1);
        let mut area = Rect {
            left: 0,
            top: 0,
            right: width,
            bottom: height,
        };
        DrawTextW(
            surface.dc,
            text.as_ptr(),
            -1,
            &mut area,
            0x1 | 0x4 | 0x20 | 0x800,
        );
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
            *px = premultiplied(
                (mix(bg.0, 255.0), mix(bg.1, 255.0), mix(bg.2, 255.0)),
                0.9 * inside,
            );
        }
        Some(surface)
    }

    unsafe fn layered_window(class: &[u16], instance: isize, w: i32, h: i32) -> isize {
        let hwnd = CreateWindowExW(
            WS_EX,
            class.as_ptr(),
            class.as_ptr(),
            WS_POPUP,
            0,
            0,
            w,
            h,
            0,
            0,
            instance,
            std::ptr::null_mut(),
        );
        if hwnd != 0 {
            SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        hwnd
    }

    fn overlay_thread(run: u64) {
        // SAFETY: every Win32 object below is created and destroyed on this thread.
        unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let class = wide("FileyAgentOverlay");
            let wc = WndClass {
                size: std::mem::size_of::<WndClass>() as u32,
                style: 0,
                proc_: window_proc,
                cls_extra: 0,
                wnd_extra: 0,
                instance,
                icon: 0,
                cursor: 0,
                background: 0,
                menu_name: std::ptr::null(),
                class_name: class.as_ptr(),
                icon_small: 0,
            };
            RegisterClassExW(&wc); // already registered on later runs; that is fine
            let dpi = (GetDpiForSystem().max(96) as f32) / 96.0;
            let scale = dpi * CURSOR_SCALE;
            let glyph = load_glyph(scale);
            let side_w = glyph.pixel_width();
            let side_h = glyph.pixel_height();
            let Some(mut surface) = Surface::new(side_w, side_h) else {
                return;
            };
            render(&mut surface, &glyph, 0.0, None);
            let cursor = layered_window(&class, instance, side_w, side_h);
            let tag = label(dpi);
            let tag_window = tag
                .as_ref()
                .map_or(0, |t| layered_window(&class, instance, t.width, t.height));
            if let Some(ref t) = tag {
                let left = GetSystemMetrics(76);
                let top = GetSystemMetrics(77);
                let width = GetSystemMetrics(78);
                let at = Point {
                    x: left + (width - t.width) / 2,
                    y: top + (16.0 * dpi) as i32,
                };
                t.present(tag_window, at, 255);
            }
            USER_ESC.store(false, Ordering::SeqCst);
            let hook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard_hook, instance, 0);
            // Without the hook (rare), fall back to polling Esc; that cannot tell agent keys apart.
            let mut esc_was_down = GetAsyncKeyState(VK_ESCAPE as i32) as u16 & 0x8000 != 0;
            let started = Instant::now();
            let mut shown = Point::default();
            if GetCursorPos(&mut shown) == 0 {
                shown = Point { x: 0, y: 0 };
            }
            let mut smooth = (shown.x as f32, shown.y as f32);
            let mut angle = 0.0f32;
            let mut idle_since = Instant::now();
            let mut seen_pulse = PULSE.load(Ordering::SeqCst);
            let mut pulse_at: Option<Instant> = None;
            let mut last_top = Instant::now();
            let mut last_present: Option<Instant> = None;
            let mut idle = false;
            let mut msg = std::mem::zeroed::<Msg>();
            // Only with a dart to look at instead: no dart window, the arrow stays.
            let hidden = if cursor != 0 { HiddenPointer::new() } else { None };
            while RUN.load(Ordering::SeqCst) == run {
                // Full frame rate while the agent moves; a lazy wobble when it rests.
                MsgWaitForMultipleObjects(
                    0,
                    std::ptr::null(),
                    0,
                    if idle { 30 } else { 12 },
                    QS_ALLINPUT,
                );
                while PeekMessageW(&mut msg, 0, 0, 0, PM_REMOVE) != 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                if hook == 0 {
                    let down = GetAsyncKeyState(VK_ESCAPE as i32) as u16 & 0x8000 != 0;
                    if down && !esc_was_down {
                        USER_ESC.store(true, Ordering::SeqCst);
                    }
                    esc_was_down = down;
                }
                if USER_ESC.swap(false, Ordering::SeqCst) {
                    let owner = OWNER
                        .get_or_init(Default::default)
                        .lock()
                        .ok()
                        .and_then(|o| o.clone());
                    if let Some((app, revoke)) = owner {
                        revoke(); // ends the session and calls hide(), which ends this loop
                        let _ = app.emit_to("main", "computer-escape", ());
                    }
                    RUN.fetch_add(1, Ordering::SeqCst);
                    break;
                }
                let mut target = Point::default();
                if cursor == 0 || GetCursorPos(&mut target) == 0 {
                    continue;
                }
                let (tx, ty) = (target.x as f32, target.y as f32);
                let (dx, dy) = (tx - smooth.0, ty - smooth.1);
                let moving = dx.abs() + dy.abs() > 0.4;
                if moving {
                    idle_since = Instant::now();
                }
                // A short spring, so the drawn cursor settles onto the real pointer instead of
                // teleporting with each 15 ms step of the glide.
                smooth.0 += dx * 0.55;
                smooth.1 += dy * 0.55;
                let now = Instant::now();
                idle = now.duration_since(idle_since) > Duration::from_millis(1100);
                let t = started.elapsed().as_secs_f32();
                let target_angle = if idle {
                    (t * TAU * 0.22).sin() * 0.035
                } else {
                    (dx * 0.018).clamp(-0.16, 0.16)
                };
                angle += (target_angle - angle) * 0.18;
                let bob = if idle {
                    (t * TAU * 0.42).sin() * 1.1 * dpi
                } else {
                    0.0
                };

                let pulse_count = PULSE.load(Ordering::SeqCst);
                if pulse_count != seen_pulse {
                    seen_pulse = pulse_count;
                    pulse_at = Some(now);
                }
                let pulse = pulse_at.and_then(|at| {
                    let progress = now.duration_since(at).as_secs_f32() / 0.45;
                    if progress <= 1.0 {
                        Some(progress)
                    } else {
                        None
                    }
                });
                if last_top.elapsed() > Duration::from_secs(1) {
                    last_top = Instant::now();
                    for hwnd in [cursor, tag_window] {
                        if hwnd != 0 {
                            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_KEEP_TOP);
                        }
                    }
                    if let Some(ref hidden) = hidden {
                        hidden.keep();
                    }
                }
                // Repaint only when something visible changed: pointer motion and clicks run
                // at full rate, the idle wobble at ~16 fps.
                let full_rate = moving || pulse.is_some();
                let due = last_present.map_or(true, |last| {
                    now.duration_since(last)
                        >= Duration::from_millis(if full_rate { 12 } else { 60 })
                });
                if !due {
                    continue;
                }
                render(&mut surface, &glyph, angle, pulse);
                let at = Point {
                    x: (smooth.0 + glyph.left * scale) as i32,
                    y: (smooth.1 + glyph.top * scale + bob) as i32,
                };
                let fade =
                    ((now.duration_since(started).as_secs_f32() / 0.12).min(1.0) * 255.0) as u8;
                surface.present(cursor, at, fade);
                last_present = Some(now);
            }
            drop(hidden); // the arrow is back before the dart goes
            if hook != 0 {
                UnhookWindowsHookEx(hook);
            }
            for hwnd in [cursor, tag_window] {
                if hwnd != 0 {
                    DestroyWindow(hwnd);
                }
            }
        }
    }

    /// Show the software cursor and the label, and watch for the user's Esc until `hide`. On Esc,
    /// `revoke` ends the session and the main window hears `computer-escape`.
    pub fn show(app: &AppHandle, revoke: fn(), _mascot: &str) {
        let run = RUN.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(mut owner) = OWNER.get_or_init(Default::default).lock() {
            *owner = Some((app.clone(), revoke));
        }
        std::thread::Builder::new()
            .name("filey-agent-overlay".into())
            .spawn(move || overlay_thread(run))
            .ok();
    }

    /// Stop watching and take the overlay away (the thread notices within one frame).
    pub fn hide() {
        RUN.fetch_add(1, Ordering::SeqCst);
    }

    /// Play one click pulse under the pointer (the computer helper calls this before a click).
    pub fn pulse_click() {
        PULSE.fetch_add(1, Ordering::SeqCst);
    }

    /// Move the real pointer smoothly to (x, y) in screen pixels before the agent acts there,
    /// so the user sees where it is about to click. Ease-out over about a quarter second.
    pub fn glide_to(x: i64, y: i64) {
        // SAFETY: plain Win32 pointer calls with stack values.
        unsafe {
            let (left, top) = (GetSystemMetrics(76), GetSystemMetrics(77));
            let (right, bottom) = (left + GetSystemMetrics(78), top + GetSystemMetrics(79));
            let (Ok(x), Ok(y)) = (i32::try_from(x), i32::try_from(y)) else {
                return;
            };
            if x < left || y < top || x >= right || y >= bottom {
                return;
            }
            let mut from = Point::default();
            if GetCursorPos(&mut from) == 0 {
                return;
            }
            let (dx, dy) = ((x - from.x) as f32, (y - from.y) as f32);
            if dx.abs() + dy.abs() < 4.0 {
                return;
            }
            const STEPS: i32 = 16;
            for step in 1..=STEPS {
                let t = step as f32 / STEPS as f32;
                let eased = 1.0 - (1.0 - t).powi(3);
                SetCursorPos(
                    from.x + (dx * eased).round() as i32,
                    from.y + (dy * eased).round() as i32,
                );
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

        /// Runs the real overlay for a moment (long enough for one re-hide): it ends cleanly and
        /// the arrow is back. On a build machine with no desktop to draw on nothing gets hidden,
        /// so only the balance is asserted; the count is printed for a run with --nocapture.
        #[test]
        fn the_arrow_is_hidden_only_while_the_overlay_runs() {
            let run = RUN.fetch_add(1, Ordering::SeqCst) + 1;
            let overlay = std::thread::spawn(move || overlay_thread(run));
            std::thread::sleep(Duration::from_millis(1500));
            let hiding = HIDERS.load(Ordering::SeqCst);
            eprintln!("overlays hiding the arrow: {hiding}");
            assert!(hiding <= 1);
            hide();
            overlay.join().expect("the overlay thread ends cleanly");
            assert_eq!(HIDERS.load(Ordering::SeqCst), 0, "the arrow is back");
        }

        #[test]
        fn the_dart_tip_is_the_hotspot() {
            assert!(dart_distance(0.0, 0.0).abs() < 0.15, "rounded tip sits on the hotspot");
            assert!(dart_distance(6.0, 6.0) < 0.0, "inside the body");
            assert!(dart_distance(-1.0, -1.0) > 0.0, "nothing beyond the tip");
            assert!(dart_distance(14.0, 14.0) > OUTLINE, "the notch stays open");
            let glyph = load_glyph(2.0);
            assert!(glyph.pixel_width() > 50 && glyph.pixel_width() == glyph.pixel_height());
        }

        #[test]
        fn renders_a_black_dart_with_a_white_outline() {
            unsafe {
                let glyph = load_glyph(3.0);
                let mut surface = Surface::new(glyph.pixel_width(), glyph.pixel_height())
                    .expect("a memory DIB section");
                render(&mut surface, &glyph, 0.0, None);
                let (sw, sh) = (surface.width as usize, surface.height as usize);
                let pixels = surface.pixels();
                let at = |x: usize, y: usize| pixels[y * sw + x];
                let point = |mx: f32, my: f32| {
                    (((mx - glyph.left) * glyph.scale) as usize, ((my - glyph.top) * glyph.scale) as usize)
                };
                let (x, y) = point(6.0, 6.0);
                let body = at(x, y);
                assert_eq!(body >> 24, 255, "body is opaque");
                assert!(((body >> 16) & 0xFF) < 24 && ((body >> 8) & 0xFF) < 24 && (body & 0xFF) < 30, "body is black");
                // Just past the top edge, between the body and the outline's outer rim.
                let (x, y) = point(9.0, 2.0);
                let edge = at(x, y);
                assert!(edge >> 24 > 240 && (edge & 0xFF) > 240 && ((edge >> 8) & 0xFF) > 240, "outline is white");
                assert_eq!(at(sw - 1, 0) >> 24, 0, "corner is transparent");
                assert_eq!(at(sw - 1, sh - 1) >> 24, 0, "corner is transparent");
                assert_eq!(at(0, 0) >> 24, 0, "corner is transparent");
            }
        }
    }
}

#[cfg(windows)]
pub use imp::{glide_to, hide, pulse_click, show};

#[cfg(not(windows))]
pub fn show(_app: &tauri::AppHandle, _revoke: fn(), _mascot: &str) {}

#[cfg(not(windows))]
pub fn hide() {}

#[cfg(not(windows))]
pub fn pulse_click() {}

#[cfg(not(windows))]
pub fn glide_to(_x: i64, _y: i64) {}
