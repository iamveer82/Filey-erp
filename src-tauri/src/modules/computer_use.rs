//! Workspace-bound computer access over Tauri IPC. No network listener,
//! persisted permission, arbitrary script, executable, or shell command input.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Manager, Webview};

const MAX_OUTPUT: u64 = 6_000_000;
const SNAPSHOT_LIFETIME: Duration = Duration::from_secs(120);
const HELPER: &str = include_str!("computer_use.ps1");

struct Snapshot {
    id: String,
    captured: Instant,
    data: Value,
}
struct Session {
    token: String,
    expires: Option<Instant>,
    windows: HashMap<String, u64>,
    snapshot: Option<Snapshot>,
    root_window: Option<String>,
    dialog_owner: Option<String>,
    browser_tab: Option<String>,
}
#[derive(Default)]
struct State {
    session: Option<Session>,
    job: Option<(String, Arc<Mutex<Child>>)>,
}
static STATE: OnceLock<Mutex<State>> = OnceLock::new();
fn state() -> &'static Mutex<State> {
    STATE.get_or_init(|| Mutex::new(State::default()))
}

pub(super) fn check_window(window: &Webview) -> Result<(), String> {
    let url = window.url().map_err(|e| e.to_string())?;
    let bundled = url.scheme() == "tauri" && url.host_str() == Some("localhost")
        || matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost");
    let development = cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        && url.port() == Some(1420);
    if window.label() != "main" || !(bundled || development) {
        return Err("Computer access is available only to the local Filey desktop window.".into());
    }
    Ok(())
}

fn revoke(current: &mut State) {
    current.session = None;
    if let Some((_, child)) = current.job.take() {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
    }
}

pub fn window_closed(label: &str) {
    if label == "main" {
        if let Ok(mut current) = state().lock() {
            revoke(&mut current);
        }
    }
}

#[tauri::command]
pub fn computer_start(
    window: Webview,
    duration_seconds: Option<u64>,
    window_id: Option<String>,
    browser_tab: Option<String>,
) -> Result<Value, String> {
    check_window(&window)?;
    if !cfg!(windows) {
        return Err("Native computer control currently requires Windows.".into());
    }
    if duration_seconds.is_some_and(|seconds| !(60..=900).contains(&seconds)) {
        return Err("Computer access must last between 60 and 900 seconds.".into());
    }
    if let Some(ref tab) = browser_tab {
        let region = super::desktop_browser::computer_region(window.app_handle(), tab, false)?;
        if region["window_id"].as_str() != window_id.as_deref() { return Err("Choose the matching visible browser tab.".into()); }
    }
    if let Some(ref id) = window_id {
        #[cfg(windows)]
        let valid = super::desktop_browser::computer_windows(window.app_handle()).contains(id);
        #[cfg(not(windows))]
        let valid = false;
        if !valid {
            return Err("Choose a Filey browser window for this computer task.".into());
        }
    }
    let dialog_owner = if window_id.is_some() {
        #[cfg(windows)]
        {
            window
                .window()
                .hwnd()
                .ok()
                .map(|h| (h.0 as isize).to_string())
        }
        #[cfg(not(windows))]
        {
            None
        }
    } else {
        None
    };
    let mut current = state()
        .lock()
        .map_err(|_| "Computer access is unavailable.")?;
    revoke(&mut current);
    let token = uuid::Uuid::new_v4().to_string();
    current.session = Some(Session {
        token: token.clone(),
        expires: duration_seconds.map(|seconds| Instant::now() + Duration::from_secs(seconds)),
        windows: HashMap::new(),
        snapshot: None,
        root_window: window_id,
        dialog_owner,
        browser_tab,
    });
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    let expires_at = duration_seconds.map(|seconds| now_ms + seconds * 1000);
    Ok(json!({"sessionToken": token, "expiresAt": expires_at}))
}

#[tauri::command]
pub fn computer_stop(window: Webview, session_token: String) -> Result<(), String> {
    check_window(&window)?;
    let mut current = state()
        .lock()
        .map_err(|_| "Computer access is unavailable.")?;
    if current
        .session
        .as_ref()
        .is_some_and(|session| session.token == session_token)
    {
        revoke(&mut current);
    }
    Ok(())
}

fn session<'a>(current: &'a mut State, token: &str) -> Result<&'a mut Session, String> {
    if current
        .session
        .as_ref()
        .is_some_and(|s| s.expires.is_some_and(|expiry| expiry <= Instant::now()))
    {
        revoke(current);
    }
    current
        .session
        .as_mut()
        .filter(|s| s.token == token)
        .ok_or_else(|| {
            "Computer access is off or expired. Enable it in Filey AI before continuing.".into()
        })
}

fn text<'a>(request: &'a Value, key: &str, max: usize) -> Result<&'a str, String> {
    request
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= max)
        .ok_or_else(|| format!("{key} is missing or invalid."))
}

fn point(request: &Value, name: &str, max: i64) -> Result<i64, String> {
    request
        .get(name)
        .and_then(Value::as_i64)
        .filter(|n| *n >= 0 && *n < max)
        .ok_or_else(|| format!("{name} must be an integer inside the screenshot."))
}

fn virtual_key(key: &str) -> Option<(u16, bool)> {
    let (key, control) = key
        .strip_prefix("Ctrl+")
        .map_or((key, false), |k| (k, true));
    if control {
        return match key {
            "A" | "C" | "V" | "Z" | "Y" | "S" => Some((key.as_bytes()[0] as u16, true)),
            _ => None,
        };
    }
    let code = match key {
        "Enter" => 13,
        "Tab" => 9,
        "Escape" => 27,
        "Backspace" => 8,
        "Delete" => 46,
        "ArrowLeft" => 37,
        "ArrowUp" => 38,
        "ArrowRight" => 39,
        "ArrowDown" => 40,
        "Home" => 36,
        "End" => 35,
        "PageUp" => 33,
        "PageDown" => 34,
        "Space" => 32,
        _ => {
            let n = key.strip_prefix('F')?.parse::<u16>().ok()?;
            if !(1..=12).contains(&n) {
                return None;
            }
            111 + n
        }
    };
    Some((code, false))
}

/// Build an allowlisted request; unknown properties never reach the helper.
fn prepare(request: &Value, active: &mut Session) -> Result<Value, String> {
    let action = text(request, "action", 24)?;
    if action == "list_windows" {
        active.snapshot = None;
        active.windows.clear();
        return Ok(
            json!({"action": action, "root_window_id": active.root_window, "dialog_owner_id": active.dialog_owner}),
        );
    }
    if action == "screenshot" {
        let window = text(request, "window_id", 24)?;
        let process = *active
            .windows
            .get(window)
            .ok_or("Choose a window_id from the latest list_windows result.")?;
        active.snapshot = None;
        return Ok(json!({"action": action, "window_id": window, "process_id": process}));
    }
    if !matches!(action, "click" | "hover" | "drag" | "type" | "key" | "scroll") {
        return Err("Unsupported computer action.".into());
    }
    let id = text(request, "snapshot_id", 64)?;
    let snapshot = active.snapshot.as_ref().filter(|s| s.id == id && s.captured.elapsed() < SNAPSHOT_LIFETIME)
        .ok_or("Take a fresh screenshot before acting. Each screenshot can authorize one input action.")?;
    let mut prepared = json!({"action": action, "window_id": snapshot.data["window_id"], "bounds": snapshot.data["bounds"], "process_id": snapshot.data["process_id"]});
    if matches!(action, "click" | "hover" | "drag" | "scroll") {
        let width = snapshot.data["width"]
            .as_i64()
            .ok_or("Invalid screenshot width.")?;
        let height = snapshot.data["height"]
            .as_i64()
            .ok_or("Invalid screenshot height.")?;
        let x = point(request, "x", width)?;
        let y = point(request, "y", height)?;
        let bounds = &snapshot.data["capture_bounds"];
        prepared["screen_x"] = json!(
            bounds["x"].as_i64().ok_or("Invalid window bounds.")?
                + x * bounds["width"].as_i64().ok_or("Invalid window width.")? / width
        );
        prepared["screen_y"] = json!(
            bounds["y"].as_i64().ok_or("Invalid window bounds.")?
                + y * bounds["height"].as_i64().ok_or("Invalid window height.")? / height
        );
        if action == "drag" {
            let to_x = point(request, "to_x", width)?;
            let to_y = point(request, "to_y", height)?;
            prepared["screen_to_x"] = json!(bounds["x"].as_i64().unwrap() + to_x * bounds["width"].as_i64().unwrap() / width);
            prepared["screen_to_y"] = json!(bounds["y"].as_i64().unwrap() + to_y * bounds["height"].as_i64().unwrap() / height);
        }
    }
    match action {
        "click" => {
            let button = request
                .get("button")
                .and_then(Value::as_str)
                .unwrap_or("left");
            if !matches!(button, "left" | "right") {
                return Err("button must be left or right.".into());
            }
            if request.get("double_click").is_some_and(|v| !v.is_boolean()) {
                return Err("double_click must be boolean.".into());
            }
            prepared["button"] = json!(button);
            prepared["double_click"] = json!(request["double_click"].as_bool().unwrap_or(false));
        }
        "type" => {
            let value = text(request, "text", 8000)?;
            if value.chars().count() > 2000
                || value
                    .chars()
                    .any(|c| c.is_control() && c != '\n' && c != '\t')
            {
                return Err("Type at most 2000 characters without control codes.".into());
            }
            prepared["text"] = json!(value);
        }
        "key" => {
            let (key, control) = virtual_key(text(request, "key", 20)?)
                .ok_or("Unsupported key. System and shell-launch shortcuts are not available.")?;
            if active.browser_tab.is_some() && (112..=123).contains(&key) {
                return Err("Function keys are unavailable in the browser workspace.".into());
            }
            prepared["virtual_key"] = json!(key);
            prepared["control"] = json!(control);
        }
        "scroll" => {
            let delta = request["delta"]
                .as_i64()
                .filter(|n| *n != 0 && (-10..=10).contains(n))
                .ok_or("delta must be an integer between -10 and 10, excluding zero.")?;
            prepared["delta"] = json!(delta);
            let axis = request.get("axis").and_then(Value::as_str).unwrap_or("vertical");
            if request.get("axis").is_some_and(|v| !v.is_string()) || !matches!(axis, "vertical" | "horizontal") {
                return Err("axis must be vertical or horizontal.".into());
            }
            prepared["axis"] = json!(axis);
        }
        "hover" | "drag" => {},
        _ => unreachable!(),
    }
    // Consume before execution: a retry cannot replay an input that succeeded
    // but whose reply was interrupted or lost.
    active.snapshot = None;
    Ok(prepared)
}

#[tauri::command]
pub async fn computer_command(
    window: Webview,
    session_token: String,
    request: Value,
) -> Result<Value, String> {
    check_window(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || execute(app, session_token, request))
        .await
        .map_err(|e| e.to_string())?
}

fn execute(app: tauri::AppHandle, token: String, request: Value) -> Result<Value, String> {
    if !cfg!(windows) {
        return Err("Native computer control currently requires Windows.".into());
    }
    let (id, child, mut stdout, mut stderr, action) = {
        let mut current = state()
            .lock()
            .map_err(|_| "Computer access is unavailable.")?;
        if current.job.is_some() {
            return Err("A computer action is already running. Wait or stop it first.".into());
        }
        let active = session(&mut current, &token)?;
        let region = if let Some(ref tab) = active.browser_tab {
            let region = super::desktop_browser::computer_region(&app, tab, request["action"] != "list_windows")?;
            if !matches!(request["action"].as_str(), Some("list_windows" | "screenshot"))
                && active.snapshot.as_ref().is_none_or(|shot| shot.data["browser_region"] != region) {
                active.snapshot = None;
                return Err("The browser moved or changed. Take a fresh screenshot.".into());
            }
            Some(region)
        } else { None };
        let mut prepared = prepare(&request, active)?;
        if let Some(region) = region { prepared["browser_region"] = region; prepared["strict_browser"] = json!(true); }
        if prepared["action"] == "list_windows" {
            prepared["browser_windows"] = json!(super::desktop_browser::computer_windows(&app));
        }
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(
            HELPER
                .encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect::<Vec<_>>(),
        );
        let system_root =
            std::env::var_os("SystemRoot").ok_or("Windows system directory is unavailable.")?;
        let executable = std::path::PathBuf::from(system_root)
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let mut command = Command::new(executable);
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-EncodedCommand",
                &encoded,
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut process = command
            .spawn()
            .map_err(|e| format!("Could not start native computer helper: {e}"))?;
        let mut input = process
            .stdin
            .take()
            .ok_or("Computer helper input unavailable.")?;
        if let Err(error) = input.write_all(prepared.to_string().as_bytes()) {
            let _ = process.kill();
            return Err(error.to_string());
        }
        drop(input);
        let stdout = process
            .stdout
            .take()
            .ok_or("Computer helper output unavailable.")?;
        let stderr = process
            .stderr
            .take()
            .ok_or("Computer helper error output unavailable.")?;
        let child = Arc::new(Mutex::new(process));
        let id = uuid::Uuid::new_v4().to_string();
        current.job = Some((id.clone(), child.clone()));
        (
            id,
            child,
            stdout,
            stderr,
            prepared["action"].as_str().unwrap().to_string(),
        )
    };
    let output = std::thread::spawn(move || {
        let mut data = Vec::new();
        stdout
            .by_ref()
            .take(MAX_OUTPUT + 1)
            .read_to_end(&mut data)
            .map(|_| data)
    });
    let errors = std::thread::spawn(move || {
        let mut data = Vec::new();
        stderr
            .by_ref()
            .take(64_000)
            .read_to_end(&mut data)
            .map(|_| data)
    });
    let started = Instant::now();
    let status = loop {
        let allowed = {
            let mut current = state()
                .lock()
                .map_err(|_| "Computer access is unavailable.")?;
            session(&mut current, &token).is_ok()
        };
        if !allowed || started.elapsed() > Duration::from_secs(20) {
            let _ = child
                .lock()
                .map_err(|_| "Computer helper unavailable.")?
                .kill();
            break Err(if allowed {
                "Computer action timed out."
            } else {
                "Computer action stopped."
            }
            .to_string());
        }
        match child
            .lock()
            .map_err(|_| "Computer helper unavailable.")?
            .try_wait()
        {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(error) => break Err(error.to_string()),
        }
    };
    // Kill/reap before joining pipe readers so stop never leaves a helper alive.
    if let Ok(mut process) = child.lock() {
        if status.is_err() {
            let _ = process.kill();
        }
        let _ = process.wait();
    }
    let output = output
        .join()
        .map_err(|_| "Computer output reader failed.")?
        .map_err(|e| e.to_string())?;
    let errors = errors
        .join()
        .map_err(|_| "Computer error reader failed.")?
        .map_err(|e| e.to_string())?;
    let mut current = state()
        .lock()
        .map_err(|_| "Computer access is unavailable.")?;
    if current
        .job
        .as_ref()
        .is_some_and(|(job_id, _)| *job_id == id)
    {
        current.job = None;
    }
    let status = status?;
    if !status.success() {
        let message = String::from_utf8_lossy(&errors)
            .chars()
            .take(1200)
            .collect::<String>();
        if message.contains("Computer action stopped by Escape") {
            revoke(&mut current);
        }
        return Err(format!("Computer action failed: {message}"));
    }
    let active = session(&mut current, &token)?;
    if output.len() as u64 > MAX_OUTPUT {
        return Err("Computer response exceeded its size limit.".into());
    }
    let mut result: Value =
        serde_json::from_slice(&output).map_err(|_| "Computer helper returned invalid output.")?;
    if action == "list_windows" {
        active.windows = result["windows"]
            .as_array()
            .ok_or("Invalid window list.")?
            .iter()
            .filter(|w| {
                active.root_window.as_ref().is_none_or(|root| {
                    w["window_id"].as_str() == Some(root.as_str())
                        || active.browser_tab.is_none() && w["root_owner_id"].as_str()
                            == active.dialog_owner.as_deref().or(Some(root.as_str()))
                            && w["window_class"].as_str() == Some("#32770")
                })
            })
            .filter_map(|w| {
                Some((
                    w["window_id"].as_str()?.to_owned(),
                    w["process_id"].as_u64()?,
                ))
            })
            .collect();
    } else if action == "screenshot" {
        if let Some(ref tab) = active.browser_tab {
            let region = super::desktop_browser::computer_region(&app, tab, false)?;
            if result["browser_region"] != region {
                active.snapshot = None;
                return Err("The browser moved during capture. Take a fresh screenshot.".into());
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        result["snapshot_id"] = json!(id);
        result["coordinate_system"] =
            json!("screenshot pixels; take a new screenshot after every input action");
        active.snapshot = Some(Snapshot {
            id,
            captured: Instant::now(),
            data: json!({"window_id": result["window_id"], "process_id": result["process_id"], "bounds": result["bounds"], "capture_bounds": result["capture_bounds"], "width": result["width"], "height": result["height"], "browser_region":result["browser_region"]}),
        });
        result
            .as_object_mut()
            .ok_or("Invalid screenshot result.")?
            .remove("bounds");
        result.as_object_mut().unwrap().remove("capture_bounds");
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn active() -> Session {
        Session {
            token: "session".into(),
            expires: None,
            windows: HashMap::from([("123".into(), 456)]),
            root_window: None,
            dialog_owner: None,
            browser_tab: None,
            snapshot: Some(Snapshot {
                id: "fresh".into(),
                captured: Instant::now(),
                data: json!({"window_id":"123", "process_id":456, "width":800, "height":400, "bounds":{"x":-108,"y":12,"width":1616,"height":816}, "capture_bounds":{"x":-100,"y":20,"width":1600,"height":800}}),
            }),
        }
    }
    #[test]
    fn default_access_has_no_deadline_but_requires_its_token_and_can_be_revoked() {
        let mut current = State {
            session: Some(active()),
            job: None,
        };
        assert!(session(&mut current, "wrong-token").is_err());
        assert!(session(&mut current, "session").unwrap().expires.is_none());
        revoke(&mut current);
        assert!(session(&mut current, "session").is_err());
    }
    #[test]
    fn pointer_actions_stay_inside_the_snapshot_and_cannot_be_replayed() {
        let mut current = active();
        assert!(prepare(&json!({"action":"drag","snapshot_id":"fresh","x":10,"y":20,"to_x":800,"to_y":30}), &mut current).is_err());
        let drag = prepare(&json!({"action":"drag","snapshot_id":"fresh","x":10,"y":20,"to_x":300,"to_y":150}), &mut current).unwrap();
        assert_eq!(drag["screen_x"], -80);
        assert_eq!(drag["screen_to_x"], 500);
        assert_eq!(drag["screen_to_y"], 320);
        assert!(current.snapshot.is_none());
        assert!(prepare(&json!({"action":"hover","snapshot_id":"fresh","x":1,"y":1}), &mut current).is_err());
        let hover = prepare(&json!({"action":"hover","snapshot_id":"fresh","x":5,"y":5}), &mut active()).unwrap();
        assert_eq!(hover["screen_y"], 30);
        let scroll = prepare(&json!({"action":"scroll","snapshot_id":"fresh","x":5,"y":5,"delta":2,"axis":"horizontal"}), &mut active()).unwrap();
        assert_eq!(scroll["axis"], "horizontal");
        assert!(prepare(&json!({"action":"scroll","snapshot_id":"fresh","x":5,"y":5,"delta":2,"axis":"diagonal"}), &mut active()).is_err());
    }
    #[test]
    fn validates_targets_and_consumes_snapshots_without_executing_any_input() {
        let mut browser = active();
        browser.browser_tab = Some("tab".into());
        assert!(prepare(&json!({"action":"key","snapshot_id":"fresh","key":"F12"}), &mut browser).is_err());
        let click = prepare(&json!({"action":"click","snapshot_id":"fresh","x":20,"y":10}), &mut browser).unwrap();
        assert_eq!(click["screen_x"], -60);
        assert_eq!(click["screen_y"], 40);
        let mut bound = active();
        bound.root_window = Some("123".into());
        assert_eq!(
            prepare(&json!({"action":"list_windows"}), &mut bound).unwrap()["root_window_id"],
            "123"
        );
        assert!(bound.windows.is_empty());
        assert!(prepare(
            &json!({"action":"screenshot","window_id":"999"}),
            &mut bound
        )
        .is_err());
        let mut listed = active();
        let capture = prepare(
            &json!({"action":"screenshot","window_id":"123"}),
            &mut listed,
        )
        .unwrap();
        assert_eq!(capture["process_id"], 456);
        assert!(listed.snapshot.is_none());
        let mut expired = active();
        expired.expires = Some(Instant::now() - Duration::from_secs(1));
        let mut expired_state = State {
            session: Some(expired),
            job: None,
        };
        assert!(session(&mut expired_state, "session").is_err());
        assert!(expired_state.session.is_none());
        let mut session = active();
        assert!(prepare(
            &json!({"action":"screenshot","window_id":"999"}),
            &mut session
        )
        .is_err());
        assert!(prepare(
            &json!({"action":"click","snapshot_id":"fresh","x":800,"y":5}),
            &mut session
        )
        .is_err());
        assert!(prepare(
            &json!({"action":"key","snapshot_id":"fresh","key":"Win+R"}),
            &mut session
        )
        .is_err());
        let prepared = prepare(
            &json!({"action":"click","snapshot_id":"fresh","x":100,"y":20,"code":"ignored"}),
            &mut session,
        )
        .unwrap();
        assert_eq!(prepared["screen_x"], 100);
        assert_eq!(prepared["screen_y"], 60);
        assert!(prepared.get("code").is_none());
        assert!(prepare(
            &json!({"action":"type","snapshot_id":"fresh","text":"duplicate"}),
            &mut session
        )
        .is_err());
        assert_eq!(virtual_key("Ctrl+A"), Some((65, true)));
        assert_eq!(virtual_key("F12"), Some((123, false)));
        let mut session = active();
        session.snapshot.as_mut().unwrap().captured = Instant::now() - Duration::from_secs(121);
        assert!(prepare(
            &json!({"action":"key","snapshot_id":"fresh","key":"Enter"}),
            &mut session
        )
        .is_err());
    }
}
