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
const MAX_TABS: usize = 8;
const MAX_URL: usize = 65_536;

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
                "Close a browser tab before opening another. Filey supports up to 8 tabs.".into(),
            );
        }
        entries.insert(
            id.clone(),
            Entry {
                profile: profile.into(),
                tab,
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
        match action {
            "open" => {
                selected = Some(open(&app, &profile, parse_url(&request["url"])?)?);
            }
            "list" => (),
            "close_all" => close_profile(&app, Some(&profile)),
            "navigate" | "back" | "forward" | "reload" | "stop" | "focus" | "close" => {
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
        Ok(json!({ "tabs": tabs, "tab": tab }))
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
            if let Some(view) = app.get_webview(id) {
                view.hide().map_err(|e| e.to_string())?;
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
        view.show().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
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
