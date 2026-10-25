//! Browser windows contain untrusted remote sites. Only the main Filey window
//! can manage them; the global invoke dispatcher rejects their custom IPC.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewBuilder,
    WebviewUrl,
};

const PREFIX: &str = "filey-browser-";
/// Each tab is a full WebView2 page; on an 8 GB laptop eight of them (plus the app and the agent)
/// ran the machine out of memory.
const MAX_TABS: usize = 4;
const MAX_URL: usize = 65_536;
/// A page read is capped so one long page cannot flood the agent's context. A
/// larger page is returned in chunks through `offset`/`next_offset`.
const MAX_READ: usize = 12_000;
/// Hard ceiling on a rendered page. The agent pages through it in `MAX_READ` chunks.
const MAX_PAGE: usize = 240_000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTab {
    id: String,
    title: String,
    url: String,
    loading: bool,
    #[serde(rename = "window_id")]
    window_id: Option<String>,
    can_go_back: bool,
    can_go_forward: bool,
    blocked_popup_url: Option<String>,
    warning: Option<String>,
}
struct Entry {
    profile: String,
    tab: BrowserTab,
    bounds: Option<BrowserBounds>,
    /// The page elements numbered by the latest `read` (backend DOM node ids), cleared on navigation.
    elements: Vec<i64>,
    /// Hash of the last rendered page, so an action can say whether it changed anything.
    page_hash: u64,
}
static TABS: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
fn tabs() -> &'static Mutex<HashMap<String, Entry>> {
    TABS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn valid_profile(profile: &str) -> bool {
    profile.len() == 64
        && profile
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn allowed_url(url: &Url) -> bool {
    let host = url.host_str().unwrap_or("");
    let loopback = matches!(host, "localhost" | "127.0.0.1" | "[::1]");
    url.as_str().len() <= MAX_URL
        && !host.is_empty()
        && url.username().is_empty()
        && url.password().is_none()
        && host != "tauri.localhost"
        && !host.ends_with(".localhost")
        && !(loopback && url.port() == Some(1420))
        && (url.scheme() == "https" || url.scheme() == "http" && loopback)
}

fn parse_url(value: &Value) -> Result<Url, String> {
    let text = value
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= MAX_URL && !s.chars().any(char::is_control))
        .ok_or("Enter an HTTPS URL of at most 65,536 characters.")?;
    let url = Url::parse(text).map_err(|_| "Enter a complete HTTPS URL.")?;
    if !allowed_url(&url) {
        return Err("Use HTTPS, or HTTP on localhost. Filey origins, credentials and custom schemes are not allowed.".into());
    }
    Ok(url)
}

/// Address-bar metadata never exposes OAuth responses or credential fields.
/// This does not alter the URL loaded by the browser engine.
fn display_url(url: &Url) -> String {
    let mut clean = url.clone();
    let _ = clean.set_username("");
    let _ = clean.set_password(None);
    clean.set_fragment(None);
    let pairs: Vec<_> = clean
        .query_pairs()
        .filter(|(key, _)| {
            let key = key.to_ascii_lowercase().replace('-', "_");
            !key.contains("token")
                && !key.contains("secret")
                && !key.contains("password")
                && !matches!(
                    key.as_str(),
                    "code"
                        | "auth_code"
                        | "authorization_code"
                        | "auth"
                        | "authorization"
                        | "passwd"
                        | "pwd"
                        | "passcode"
                        | "otp"
                        | "api_key"
                        | "apikey"
                        | "access_key"
                        | "key"
                        | "session"
                        | "session_id"
                        | "sessionid"
                        | "jsessionid"
                        | "sid"
                        | "ticket"
                        | "assertion"
                        | "credential"
                        | "signature"
                        | "sig"
                        | "samlresponse"
                        | "samlrequest"
                        | "state"
                        | "nonce"
                        | "csrf"
                        | "xsrf"
                )
        })
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    clean.set_query(None);
    if !pairs.is_empty() {
        clean.query_pairs_mut().extend_pairs(pairs);
    }
    clean.to_string()
}

fn update(id: &str, f: impl FnOnce(&mut BrowserTab)) {
    if let Ok(mut entries) = tabs().lock() {
        if let Some(entry) = entries.get_mut(id) {
            f(&mut entry.tab);
        }
    }
}

fn close_profile(app: &AppHandle, profile: Option<&str>) {
    let ids = if let Ok(mut entries) = tabs().lock() {
        let ids: Vec<_> = entries
            .iter()
            .filter(|(_, e)| profile.is_none_or(|p| p == e.profile))
            .map(|(id, _)| id.clone())
            .collect();
        for id in &ids {
            entries.remove(id);
        }
        ids
    } else {
        Vec::new()
    };
    for id in ids {
        if let Some(window) = app.get_webview(&id) {
            let _ = window.close();
        }
    }
}

pub fn window_closed(app: &AppHandle, label: &str) {
    if label == "main" {
        close_profile(app, None);
    } else if label.starts_with(PREFIX) {
        if let Ok(mut entries) = tabs().lock() {
            entries.remove(label);
        }
    }
}

// Native WebView2 history/control APIs; never evaluate page JavaScript.
#[cfg(windows)]
fn native_control(window: &Webview, action: &str) -> Result<(bool, bool), String> {
    let action = action.to_owned();
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    window
        .with_webview(move |view| {
            let result = (|| unsafe {
                let core = view
                    .controller()
                    .CoreWebView2()
                    .map_err(|e| e.to_string())?;
                let mut back = Default::default();
                let mut forward = Default::default();
                core.CanGoBack(&mut back).map_err(|e| e.to_string())?;
                core.CanGoForward(&mut forward).map_err(|e| e.to_string())?;
                match action.as_str() {
                    "back" if back.as_bool() => core.GoBack().map_err(|e| e.to_string())?,
                    "forward" if forward.as_bool() => {
                        core.GoForward().map_err(|e| e.to_string())?
                    }
                    "stop" => core.Stop().map_err(|e| e.to_string())?,
                    _ => (),
                }
                Ok((back.as_bool(), forward.as_bool()))
            })();
            let _ = send.send(result);
        })
        .map_err(|e| e.to_string())?;
    receive
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "Browser controls did not respond. Try again.".to_string())?
}
#[cfg(not(windows))]
fn native_control(_: &Webview, _: &str) -> Result<(bool, bool), String> {
    Err("The built-in browser currently requires Windows.".into())
}

/// One DevTools-protocol call on a tab. Accessibility, DOM geometry and input only: the page's
/// own JavaScript is never evaluated, the same line as native_control.
#[cfg(windows)]
fn cdp(view: &Webview, method: &str, params: Value) -> Result<Value, String> {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows_core::{HSTRING, PCWSTR};
    let (method, params) = (HSTRING::from(method), HSTRING::from(params.to_string()));
    let (send, receive) = std::sync::mpsc::sync_channel::<Result<String, String>>(1);
    view.with_webview(move |platform| {
        let failed = send.clone();
        let started = (|| unsafe {
            let core = platform.controller().CoreWebView2().map_err(|e| e.to_string())?;
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, json| {
                let _ = send.send(result.map(|_| json).map_err(|e| e.to_string()));
                Ok(())
            }));
            core.CallDevToolsProtocolMethod(PCWSTR(method.as_ptr()), PCWSTR(params.as_ptr()), &handler)
                .map_err(|e| e.to_string())
        })();
        if let Err(error) = started {
            let _ = failed.send(Err(error));
        }
    })
    .map_err(|e| e.to_string())?;
    let json = receive
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "The page did not respond. Try again.".to_string())??;
    serde_json::from_str(&json).map_err(|_| "The page returned unreadable data.".into())
}
#[cfg(not(windows))]
fn cdp(_: &Webview, _: &str, _: Value) -> Result<Value, String> {
    Err("The built-in browser currently requires Windows.".into())
}

/// Hidden tabs ask WebView2 to trim memory; the visible tab runs normally.
#[cfg(windows)]
fn memory_level(view: &Webview, low: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows_core::Interface;
    let _ = view.with_webview(move |platform| unsafe {
        if let Ok(core) = platform.controller().CoreWebView2().and_then(|core| core.cast::<ICoreWebView2_19>()) {
            let _ = core.SetMemoryUsageTargetLevel(if low {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
            } else {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
            });
        }
    });
}
#[cfg(not(windows))]
fn memory_level(_: &Webview, _: bool) {}

const INTERACTIVE: [&str; 17] = [
    "button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "menuitem", "menuitemcheckbox",
    "menuitemradio", "tab", "option", "switch", "slider", "spinbutton", "listbox", "treeitem",
];

/// The page as the agent reads it: headings and text in order, and every control numbered
/// `[n] role "name" = "value"`. Returns the text and the backend node id of each number.
fn render_page(nodes: &[Value]) -> (String, Vec<i64>) {
    let field = |node: &Value, key: &str| -> String {
        let text = node[key]["value"].as_str().map(str::to_owned)
            .or_else(|| node[key]["value"].as_f64().map(|n| n.to_string())).unwrap_or_default();
        text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(160).collect()
    };
    let role = |node: &Value| node["role"]["value"].as_str().unwrap_or_default().to_owned();
    let mut parent: HashMap<&str, &str> = HashMap::new();
    let mut by_id: HashMap<&str, &Value> = HashMap::new();
    for node in nodes {
        let Some(id) = node["nodeId"].as_str() else { continue };
        by_id.insert(id, node);
        for child in node["childIds"].as_array().into_iter().flatten() {
            if let Some(child) = child.as_str() { parent.insert(child, id); }
        }
    }
    // Text inside a numbered control repeats its name; leave it out.
    let inside_control = |id: &str| {
        let mut at = id;
        for _ in 0..4 {
            let Some(up) = parent.get(at) else { return false };
            if by_id.get(up).is_some_and(|node| INTERACTIVE.contains(&role(node).as_str())) { return true; }
            at = up;
        }
        false
    };
    let (mut out, mut elements, mut last_text) = (String::new(), Vec::new(), String::new());
    for node in nodes {
        if node["ignored"].as_bool() == Some(true) { continue; }
        let kind = role(node);
        let name = field(node, "name");
        let line = if INTERACTIVE.contains(&kind.as_str()) {
            let Some(backend) = node["backendDOMNodeId"].as_i64() else { continue };
            let mut line = format!("[{}] {kind} \"{name}\"", elements.len() + 1);
            let value = field(node, "value");
            if !value.is_empty() {
                // Password fields come through masked; never echo even that.
                let masked = value.chars().all(|c| matches!(c, '•' | '*' | '●'));
                line += &if masked { " = (hidden)".to_owned() } else { format!(" = \"{value}\"") };
            }
            for property in node["properties"].as_array().into_iter().flatten() {
                let (key, on) = (property["name"].as_str().unwrap_or_default(), property["value"]["value"].clone());
                match key {
                    "disabled" | "focused" | "required" if on == json!(true) => line += &format!(" ({key})"),
                    "checked" | "expanded" | "selected" | "pressed" if on == json!(true) || on == json!("true") => line += &format!(" ({key})"),
                    _ => {}
                }
            }
            elements.push(backend);
            line
        } else if kind == "heading" && !name.is_empty() {
            format!("# {name}")
        } else if kind == "StaticText" && !name.is_empty()
            && node["nodeId"].as_str().is_some_and(|id| !inside_control(id)) && name != last_text {
            last_text = name.clone();
            name
        } else {
            continue;
        };
        if out.len() + line.len() + 1 > MAX_PAGE {
            out += "\n… (page is too long to render; narrow the task)";
            break;
        }
        out += &line;
        out.push('\n');
    }
    (out, elements)
}

fn element(id: &str, request: &Value) -> Result<i64, String> {
    let index = request["element"].as_u64().filter(|n| *n >= 1).ok_or("element must be a number from the latest read.")?;
    tabs()
        .lock()
        .map_err(|_| "Browser state unavailable.")?
        .get(id)
        .and_then(|entry| entry.elements.get(index as usize - 1).copied())
        .ok_or_else(|| format!("Element {index} is not in the latest read of this page. Read it again."))
}

/// One context-sized chunk of the rendered page, counted in characters so
/// `next_offset` is what the model sees. Element numbers stay global: a chunk
/// never renumbers controls.
fn page_slice(text: &str, offset: usize) -> (String, Option<usize>) {
    let chars: Vec<char> = text.chars().collect();
    let start = offset.min(chars.len());
    let end = start.saturating_add(MAX_READ).min(chars.len());
    let mut page: String = chars[start..end].iter().collect();
    let next = (end < chars.len()).then_some(end);
    if let Some(next) = next {
        page.push_str(&format!("\n… (page continues at offset {next})"));
    }
    (page, next)
}

/// FNV-1a: compare rendered pages without keeping another copy of the text.
fn page_hash(text: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in text.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn set_page_hash(id: &str, hash: u64) {
    if let Ok(mut entries) = tabs().lock() {
        if let Some(entry) = entries.get_mut(id) { entry.page_hash = hash; }
    }
}

fn state_json(text: &str, count: usize, offset: usize) -> Value {
    let (page, next) = page_slice(text, offset);
    json!({
        "page": page,
        "elements": count,
        "offset": offset,
        "next_offset": next,
        "hint": match next {
            Some(next) => format!("Act by number. Read offset {next} for the rest of the page."),
            None => "Act by number: click {element}, type {element, text}, press {key} or scroll.".to_owned(),
        },
    })
}

fn rendered_page(view: &Webview, id: &str) -> Result<(String, usize), String> {
    let _ = cdp(view, "Accessibility.enable", json!({}));
    let tree = cdp(view, "Accessibility.getFullAXTree", json!({}))?;
    let (text, elements) = render_page(tree["nodes"].as_array().map(Vec::as_slice).unwrap_or_default());
    let count = elements.len();
    if let Ok(mut entries) = tabs().lock() {
        if let Some(entry) = entries.get_mut(id) { entry.elements = elements; }
    }
    Ok((text, count))
}

fn read_state(view: &Webview, id: &str, offset: usize) -> Result<Value, String> {
    let (text, count) = rendered_page(view, id)?;
    set_page_hash(id, page_hash(&text));
    Ok(state_json(&text, count, offset))
}

/// Return the new page after an action, the way a browser agent observes the
/// result before choosing its next step. An unchanged page is reported without
/// resending the same text; a navigation in flight is left to the agent.
fn settle_and_read(view: &Webview, id: &str) -> Option<Value> {
    std::thread::sleep(Duration::from_millis(120));
    let loading = tabs().lock().ok()
        .and_then(|entries| entries.get(id).map(|entry| entry.tab.loading))
        .unwrap_or(false);
    if loading { return None; }
    let (text, count) = rendered_page(view, id).ok()?;
    let hash = page_hash(&text);
    let previous = tabs().lock().ok()
        .and_then(|entries| entries.get(id).map(|entry| entry.page_hash))
        .unwrap_or(0);
    if previous != 0 && previous == hash {
        return Some(json!({"changed": false, "elements": count,
            "hint": "The page did not change. Read only if you need the current text."}));
    }
    set_page_hash(id, hash);
    let mut state = state_json(&text, count, 0);
    state["changed"] = json!(true);
    Some(state)
}

fn with_state(mut out: Value, state: Option<Value>) -> Value {
    match state {
        Some(state) => {
            if let (Some(out), Some(state)) = (out.as_object_mut(), state.as_object()) {
                out.extend(state.clone());
            }
        }
        None => {
            out["loading"] = json!(true);
            out["hint"] = json!("The page is still changing. Read again when it settles.");
        }
    }
    out
}

fn key_event(view: &Webview, kind: &str, key: &str, code: u32, text: Option<&str>, modifiers: u32, commands: &[&str]) -> Result<(), String> {
    let mut event = json!({"type": kind, "key": key, "code": key, "windowsVirtualKeyCode": code, "modifiers": modifiers});
    if let Some(text) = text { event["text"] = json!(text); }
    if !commands.is_empty() { event["commands"] = json!(commands); }
    cdp(view, "Input.dispatchKeyEvent", event).map(|_| ())
}

/// read / click / type / press / scroll / wait on a tab, through the page's
/// accessibility tree. Every mutating action returns the new page when it has
/// settled, so the agent's next step starts from a fresh observation.
fn page_action(view: &Webview, id: &str, action: &str, request: &Value) -> Result<Value, String> {
    match action {
        "read" => read_state(view, id, request["offset"].as_u64().unwrap_or(0) as usize),
        "click" => {
            let node = element(id, request)?;
            let _ = cdp(view, "DOM.enable", json!({}));
            let _ = cdp(view, "DOM.scrollIntoViewIfNeeded", json!({"backendNodeId": node}));
            let model = cdp(view, "DOM.getBoxModel", json!({"backendNodeId": node}))?;
            let quad: Vec<f64> = model["model"]["content"].as_array().into_iter().flatten().filter_map(Value::as_f64).collect();
            if quad.len() != 8 { return Err("That element has no visible box. Read the page again.".into()); }
            let (x, y) = ((quad[0] + quad[2] + quad[4] + quad[6]) / 4.0, (quad[1] + quad[3] + quad[5] + quad[7]) / 4.0);
            for (kind, extra) in [("mouseMoved", json!({})), ("mousePressed", json!({"button": "left", "clickCount": 1})),
                ("mouseReleased", json!({"button": "left", "clickCount": 1}))] {
                let mut event = json!({"type": kind, "x": x, "y": y});
                if let (Some(event), Some(extra)) = (event.as_object_mut(), extra.as_object()) { event.extend(extra.clone()); }
                cdp(view, "Input.dispatchMouseEvent", event)?;
            }
            Ok(with_state(json!({"clicked": request["element"]}), settle_and_read(view, id)))
        }
        "type" => {
            let node = element(id, request)?;
            let text = request["text"].as_str()
                .filter(|t| t.chars().count() <= 2000 && !t.chars().any(|c| c.is_control() && c != '\n' && c != '\t'))
                .ok_or("text must be at most 2000 characters without control codes.")?;
            cdp(view, "DOM.focus", json!({"backendNodeId": node}))?;
            // Replace what is there: select all, then insert.
            key_event(view, "rawKeyDown", "a", 65, None, 2, &["selectAll"])?;
            key_event(view, "keyUp", "a", 65, None, 2, &[])?;
            cdp(view, "Input.insertText", json!({"text": text}))?;
            Ok(with_state(json!({"typed_into": request["element"]}), settle_and_read(view, id)))
        }
        "press" => {
            let key = request["key"].as_str().unwrap_or_default();
            let (code, text) = match key {
                "Enter" => (13, Some("\r")), "Tab" => (9, None), "Escape" => (27, None), "Backspace" => (8, None),
                "ArrowDown" => (40, None), "ArrowUp" => (38, None), "ArrowLeft" => (37, None), "ArrowRight" => (39, None),
                "PageDown" => (34, None), "PageUp" => (33, None), "Home" => (36, None), "End" => (35, None),
                "Space" => (32, Some(" ")),
                _ => return Err("key must be Enter, Tab, Escape, Backspace, an arrow, PageUp, PageDown, Home, End or Space.".into()),
            };
            key_event(view, if text.is_some() { "keyDown" } else { "rawKeyDown" }, key, code, text, 0, &[])?;
            key_event(view, "keyUp", key, code, None, 0, &[])?;
            Ok(with_state(json!({"pressed": key}), settle_and_read(view, id)))
        }
        "scroll" => {
            let direction = request["direction"].as_str().unwrap_or("down");
            if direction != "up" && direction != "down" { return Err("direction must be up or down.".into()); }
            let pages = request["pages"].as_f64().unwrap_or(1.0);
            if !(1.0..=10.0).contains(&pages) { return Err("pages must be between 1 and 10.".into()); }
            let (x, y) = if request["element"].as_u64().is_some() {
                let node = element(id, request)?;
                let _ = cdp(view, "DOM.enable", json!({}));
                let _ = cdp(view, "DOM.scrollIntoViewIfNeeded", json!({"backendNodeId": node}));
                let model = cdp(view, "DOM.getBoxModel", json!({"backendNodeId": node}))?;
                let quad: Vec<f64> = model["model"]["content"].as_array().into_iter().flatten().filter_map(Value::as_f64).collect();
                if quad.len() != 8 { return Err("That element has no visible box. Read the page again.".into()); }
                ((quad[0] + quad[2] + quad[4] + quad[6]) / 4.0, (quad[1] + quad[3] + quad[5] + quad[7]) / 4.0)
            } else {
                let metrics = cdp(view, "Page.getLayoutMetrics", json!({}))?;
                let viewport = &metrics["cssLayoutViewport"];
                (viewport["clientWidth"].as_f64().unwrap_or(800.0) / 2.0,
                 viewport["clientHeight"].as_f64().unwrap_or(600.0) / 2.0)
            };
            let distance = y.max(1.0) * 0.9 * pages * if direction == "up" { -1.0 } else { 1.0 };
            cdp(view, "Input.dispatchMouseEvent", json!({
                "type": "mouseWheel", "x": x, "y": y, "deltaX": 0, "deltaY": distance,
                "button": "none", "clickCount": 0, "modifiers": 0,
            }))?;
            Ok(json!({"scrolled": direction, "pages": pages,
                "hint": "Read again, or take a screenshot when the layout matters."}))
        }
        "wait" => {
            let ms = request["ms"].as_u64().filter(|ms| (100..=5000).contains(ms))
                .ok_or("ms must be between 100 and 5000.")?;
            std::thread::sleep(Duration::from_millis(ms));
            Ok(with_state(json!({"waited_ms": ms}), settle_and_read(view, id)))
        }
        _ => Err("Unsupported browser action.".into()),
    }
}

fn read_tabs(app: &AppHandle, profile: &str) -> Result<Vec<BrowserTab>, String> {
    let mut result: Vec<_> = tabs()
        .lock()
        .map_err(|_| "Browser state unavailable.")?
        .values()
        .filter(|entry| entry.profile == profile)
        .map(|entry| entry.tab.clone())
        .collect();
    for tab in &mut result {
        if let Some(window) = app.get_webview(&tab.id) {
            if let Ok(url) = window.url() {
                if allowed_url(&url) {
                    tab.url = display_url(&url);
                }
            }
            if let Ok((back, forward)) = native_control(&window, "state") {
                tab.can_go_back = back;
                tab.can_go_forward = forward;
            }
        }
    }
    result.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(result)
}

fn open(app: &AppHandle, profile: &str, url: Url) -> Result<String, String> {
    let id = format!("{PREFIX}{}", uuid::Uuid::new_v4());
    let tab = BrowserTab {
        id: id.clone(),
        title: "Filey Browser".into(),
        url: display_url(&url),
        loading: true,
        window_id: None,
        can_go_back: false,
        can_go_forward: false,
        blocked_popup_url: None,
        warning: None,
    };
    {
        let mut entries = tabs().lock().map_err(|_| "Browser state unavailable.")?;
        if entries.len() >= MAX_TABS {
            return Err(
                "Close a browser tab before opening another. Filey supports up to 4 tabs.".into(),
            );
        }
        entries.insert(
            id.clone(),
            Entry {
                profile: profile.into(),
                tab,
                bounds: None,
                elements: Vec::new(),
                page_hash: 0,
            },
        );
    }
    let outcome = (|| {
        let directory = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("browser-profiles")
            .join(profile);
        std::fs::create_dir_all(&directory)
            .map_err(|e| format!("Could not create browser profile: {e}"))?;
        let navigation_id = id.clone();
        let popup_id = id.clone();
        let download_id = id.clone();
        let builder = WebviewBuilder::new(&id, WebviewUrl::External(url))
            .data_directory(directory).devtools(false).browser_extensions_enabled(false)
            .disable_drag_drop_handler()
            .on_navigation(move |url| {
                let allowed = allowed_url(url);
                if !allowed { update(&navigation_id, |tab| { tab.loading = false; tab.warning = Some("Blocked an unsupported browser address.".into()); }); }
                else { update(&navigation_id, |tab| { tab.loading = true; tab.warning = None; tab.blocked_popup_url = None; }); }
                allowed
            })
            .on_new_window(move |url, _| {
                update(&popup_id, |tab| {
                    tab.blocked_popup_url = allowed_url(&url).then(|| display_url(&url));
                    tab.warning = Some("This site requested another window. Open the link from Filey's browser controls.".into());
                });
                NewWindowResponse::Deny
            })
            .on_download(move |_, _| {
                update(&download_id, |tab| tab.warning = Some("Download blocked. Use your regular browser to choose where to save the file.".into()));
                false
            })
            .on_document_title_changed(|window, title| {
                let title: String = title.chars().filter(|c| !c.is_control()).take(180).collect();
                update(window.label(), |tab| tab.title = title.clone());

            })
            .on_page_load(|window, payload| {
                update(window.label(), |tab| {
                    if allowed_url(payload.url()) { tab.url = display_url(payload.url()); }
                    tab.loading = matches!(payload.event(), PageLoadEvent::Started);
                });
                // A new page: element numbers from the last read no longer point anywhere.
                if matches!(payload.event(), PageLoadEvent::Started) {
                    if let Ok(mut entries) = tabs().lock() {
                        if let Some(entry) = entries.get_mut(window.label()) { entry.elements.clear(); }
                    }
                }
            });
        let parent = app
            .get_window("main")
            .ok_or("Filey window is unavailable.")?;
        let window = parent
            .add_child(
                builder,
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(1.0, 1.0),
            )
            .map_err(|e| format!("Could not open Filey Browser: {e}"))?;
        window.hide().map_err(|e| e.to_string())?;
        let present = tabs()
            .lock()
            .map_err(|_| "Browser state unavailable.")?
            .contains_key(&id);
        if !present {
            let _ = window.close();
            return Err("Browser opening was canceled because the workspace changed.".into());
        }
        #[cfg(windows)]
        {
            let browser_id = id.clone();
            window
                .with_webview(move |view| unsafe {
                    let mut handle = Default::default();
                    if view.controller().ParentWindow(&mut handle).is_ok() {
                        update(&browser_id, |tab| {
                            tab.window_id = Some((handle.0 as isize).to_string())
                        });
                    }
                })
                .map_err(|e| e.to_string())?;
        }
        Ok(id.clone())
    })();
    if outcome.is_err() {
        if let Ok(mut entries) = tabs().lock() {
            entries.remove(&id);
        }
    }
    outcome
}

#[tauri::command]
pub async fn desktop_browser_command(
    window: Webview,
    profile: String,
    request: Value,
) -> Result<Value, String> {
    super::computer_use::check_window(&window)?;
    if !cfg!(windows) {
        return Err("The built-in browser currently requires Windows.".into());
    }
    if !valid_profile(&profile) {
        return Err("A signed-in browser profile is required.".into());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let action = request["action"]
            .as_str()
            .ok_or("Choose a browser action.")?;
        let mut selected = None;
        let mut page = None;
        match action {
            "open" => {
                selected = Some(open(&app, &profile, parse_url(&request["url"])?)?);
            }
            "list" => (),
            "close_all" => close_profile(&app, Some(&profile)),
            "navigate" | "back" | "forward" | "reload" | "stop" | "focus" | "close" | "read" | "click" | "type"
            | "press" | "scroll" | "wait" => {
                let id = request["tab_id"]
                    .as_str()
                    .ok_or("Choose an open browser tab.")?;
                let valid = tabs()
                    .lock()
                    .map_err(|_| "Browser state unavailable.")?
                    .get(id)
                    .is_some_and(|entry| entry.profile == profile);
                if !valid {
                    return Err("The browser tab does not belong to the current workspace.".into());
                }
                let tab_window = app.get_webview(id).ok_or("The browser tab was closed.")?;
                match action {
                    "navigate" => {
                        tab_window
                            .navigate(parse_url(&request["url"])?)
                            .map_err(|e| e.to_string())?;
                    }
                    "reload" => tab_window.reload().map_err(|e| e.to_string())?,
                    "read" | "click" | "type" | "press" | "scroll" | "wait" => {
                        page = Some(page_action(&tab_window, id, action, &request)?);
                    }
                    "focus" => {
                        tab_window.set_focus().map_err(|e| e.to_string())?;
                    }
                    "close" => {
                        tab_window.close().map_err(|e| e.to_string())?;
                        tabs()
                            .lock()
                            .map_err(|_| "Browser state unavailable.")?
                            .remove(id);
                    }
                    _ => {
                        native_control(&tab_window, action)?;
                        if action == "stop" {
                            update(id, |tab| tab.loading = false);
                        }
                    }
                }
                if action != "close" {
                    selected = Some(id.to_string());
                }
            }
            _ => return Err("Unsupported browser action.".into()),
        }
        let tabs = read_tabs(&app, &profile)?;
        let tab = selected.and_then(|id| tabs.iter().find(|tab| tab.id == id).cloned());
        let mut result = json!({ "tabs": tabs, "tab": tab });
        if let (Some(result), Some(Value::Object(page))) = (result.as_object_mut(), page) {
            result.extend(page);
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Copy, Deserialize)]
pub struct BrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl BrowserBounds {
    fn valid(self, width: f64, height: f64) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|n| n.is_finite())
            && self.x >= 0.0
            && self.y >= 0.0
            && self.width >= 1.0
            && self.height >= 1.0
            && self.x + self.width <= width + 1.0
            && self.y + self.height <= height + 1.0
    }
}

/// Only handles of Filey's live child webviews are offered to computer use.
pub(super) fn computer_windows(app: &AppHandle) -> Vec<String> {
    tabs()
        .lock()
        .map(|entries| {
            entries
                .iter()
                .filter(|(id, _)| app.get_webview(id).is_some())
                .filter_map(|(_, entry)| entry.tab.window_id.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// Absolute screen pixels of the visible tab, never the surrounding Filey UI.
pub(super) fn computer_region(app: &AppHandle, id: &str, focus: bool) -> Result<Value, String> {
    let (bounds, window_id) = {
        let entries = tabs().lock().map_err(|_| "Browser state unavailable.")?;
        let entry = entries.get(id).ok_or("The agent browser tab was closed.")?;
        (entry.bounds.ok_or("Open the browser panel and close any dialogs before continuing." )?, entry.tab.window_id.clone())
    };
    let parent = app.get_window("main").ok_or("Filey window unavailable.")?;
    let origin = parent.inner_position().map_err(|e| e.to_string())?;
    let scale = parent.scale_factor().map_err(|e| e.to_string())?;
    if focus { app.get_webview(id).ok_or("Browser tab unavailable.")?.set_focus().map_err(|e|e.to_string())?; }
    Ok(json!({"tab_id":id,"window_id":window_id,"x":origin.x + (bounds.x * scale).round() as i32,
        "y":origin.y + (bounds.y * scale).round() as i32, "width":(bounds.width * scale).round() as i32,"height":(bounds.height * scale).round() as i32}))
}

#[tauri::command]
pub async fn desktop_browser_layout(
    window: Webview,
    profile: String,
    bounds: Option<BrowserBounds>,
    tab_id: Option<String>,
) -> Result<(), String> {
    super::computer_use::check_window(&window)?;
    if !valid_profile(&profile) {
        return Err("A signed-in browser profile is required.".into());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let ids: Vec<String> = tabs()
            .lock()
            .map_err(|_| "Browser state unavailable.")?
            .iter()
            .filter(|(_, e)| e.profile == profile)
            .map(|(id, _)| id.clone())
            .collect();
        // Hide first, including when a caller supplies an invalid rectangle.
        for id in &ids {
            if let Ok(mut entries) = tabs().lock() { if let Some(entry) = entries.get_mut(id) { entry.bounds = None; } }
            if let Some(view) = app.get_webview(id) {
                view.hide().map_err(|e| e.to_string())?;
                memory_level(&view, true);
            }
        }
        let Some(bounds) = bounds else {
            return Ok(());
        };
        let id = tab_id
            .filter(|id| ids.contains(id))
            .ok_or("Choose a tab in this workspace.")?;
        let parent = app
            .get_window("main")
            .ok_or("Filey window is unavailable.")?;
        let size = parent
            .inner_size()
            .map_err(|e| e.to_string())?
            .to_logical::<f64>(parent.scale_factor().map_err(|e| e.to_string())?);
        if !bounds.valid(size.width, size.height) {
            return Err("Browser bounds must stay inside Filey.".into());
        }
        let view = app.get_webview(&id).ok_or("The browser tab was closed.")?;
        view.set_bounds(Rect {
            position: LogicalPosition::new(bounds.x, bounds.y).into(),
            size: LogicalSize::new(bounds.width, bounds.height).into(),
        })
        .map_err(|e| e.to_string())?;
        view.show().map_err(|e| e.to_string())?;
        memory_level(&view, false);
        if let Ok(mut entries) = tabs().lock() { if let Some(entry) = entries.get_mut(&id) { entry.bounds = Some(bounds); } }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn page_read_numbers_controls_and_hides_passwords() {
        let nodes = json!([
            {"nodeId":"1","role":{"value":"RootWebArea"},"name":{"value":"Instagram"},"childIds":["2","3","4","5","7"]},
            {"nodeId":"2","role":{"value":"heading"},"name":{"value":"Log in"}},
            {"nodeId":"3","role":{"value":"textbox"},"name":{"value":"Username"},"value":{"value":"veer"},"backendDOMNodeId":11},
            {"nodeId":"4","role":{"value":"textbox"},"name":{"value":"Password"},"value":{"value":"••••••"},"backendDOMNodeId":12,
             "properties":[{"name":"required","value":{"value":true}}]},
            {"nodeId":"5","role":{"value":"button"},"name":{"value":"Log in"},"backendDOMNodeId":13,"childIds":["6"]},
            {"nodeId":"6","role":{"value":"StaticText"},"name":{"value":"Log in"}},
            {"nodeId":"7","role":{"value":"StaticText"},"name":{"value":"Forgot   password?"}},
            {"nodeId":"8","ignored":true,"role":{"value":"button"},"name":{"value":"Hidden"},"backendDOMNodeId":99}
        ]);
        let (text, elements) = render_page(nodes.as_array().unwrap());
        assert_eq!(elements, vec![11, 12, 13]);
        assert!(text.contains("# Log in\n"));
        assert!(text.contains("[1] textbox \"Username\" = \"veer\""));
        assert!(text.contains("[2] textbox \"Password\" = (hidden) (required)"));
        assert!(text.contains("[3] button \"Log in\""));
        assert!(text.contains("Forgot password?"));
        assert_eq!(text.matches("Log in").count(), 2, "button text is not repeated: {text}");
        assert!(!text.contains("Hidden"));
    }
    #[test]
    fn long_pages_are_read_in_stable_chunks() {
        let text = "a".repeat(MAX_READ + 10);
        let (page, next) = page_slice(&text, 0);
        assert_eq!(next, Some(MAX_READ));
        assert!(page.starts_with(&"a".repeat(MAX_READ)));
        assert!(page.contains(&format!("offset {MAX_READ})")));
        let (rest, next) = page_slice(&text, MAX_READ);
        assert_eq!(next, None);
        assert_eq!(rest, "a".repeat(10));
        // Offsets are character-based, so a multi-byte code point is never split.
        let (page, next) = page_slice("a漢b", 1);
        assert_eq!(page, "漢b");
        assert_eq!(next, None);
    }
    #[test]
    fn browser_bounds_stay_inside_the_app() {
        let valid = BrowserBounds {
            x: 500.0,
            y: 80.0,
            width: 400.0,
            height: 600.0,
        };
        assert!(valid.valid(1000.0, 800.0));
        for invalid in [
            BrowserBounds { x: -1.0, ..valid },
            BrowserBounds {
                width: f64::NAN,
                ..valid
            },
            BrowserBounds {
                width: 900.0,
                ..valid
            },
            BrowserBounds {
                height: 0.0,
                ..valid
            },
        ] {
            assert!(!invalid.valid(1000.0, 800.0));
        }
    }
    #[test]
    fn only_accepts_web_urls_and_safe_profile_components() {
        for url in [
            "https://www.instagram.com/",
            "https://web.whatsapp.com/send?phone=123",
            "http://127.0.0.1:3100/",
            "http://[::1]:3000/",
        ] {
            assert!(parse_url(&json!(url)).is_ok(), "{url}");
        }
        for url in [
            "javascript:alert(1)",
            "file:///C:/data.txt",
            "tauri://localhost/",
            "https://tauri.localhost/",
            "http://localhost:1420/",
            "https://ipc.localhost/",
            "https://user:password@example.com/",
            "http://example.com/",
            "https://example.com/\n",
        ] {
            assert!(parse_url(&json!(url)).is_err(), "{url}");
        }
        assert!(valid_profile(&"a".repeat(64)));
        assert!(!valid_profile("../../other-profile"));
        assert!(!valid_profile(&"G".repeat(64)));
    }
    #[test]
    fn strips_credentials_from_state_without_changing_navigation() {
        let actual = Url::parse("https://example.com/callback?code=private&access_token=hidden&Api-Key=private&search=invoice#id_token=hidden").unwrap();
        assert_eq!(
            display_url(&actual),
            "https://example.com/callback?search=invoice"
        );
        assert!(actual.as_str().contains("private"));
        let long_caption = format!(
            "https://web.whatsapp.com/send?text={}",
            "%E6%BC%A2".repeat(4000)
        );
        assert!(parse_url(&json!(long_caption)).is_ok());
        assert!(parse_url(&json!(format!(
            "https://example.com/?q={}",
            "x".repeat(MAX_URL)
        )))
        .is_err());
    }
}
