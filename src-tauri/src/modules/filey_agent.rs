//! Filey Agent sidecar supervisor.
//!
//! Filey Agent (agent/, the Hermes fork) runs its JSON-RPC backend over stdio:
//! `python -m tui_gateway.entry`. This module starts it, relays every stdout line
//! to the main webview as `filey-agent-line`, and writes lines back with
//! `filey_agent_send`. The webview speaks the protocol (src/lib/fileyAgent.ts)
//! and answers the agent's `filey.tool` requests with the app's own tools.
//!
//! Stdio instead of the agent's WebSocket server: no port, no token, no Origin
//! rules — the pipe is private to this process. Same std::process choice as
//! wa_bridge (no tauri-plugin-shell permission surface).
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Webview};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct Supervisor {
    pid: u32,
    child: Child,
    stdin: Option<ChildStdin>,
}

static AGENT: Mutex<Option<Supervisor>> = Mutex::new(None);

fn venv_python(dir: &Path) -> PathBuf {
    if cfg!(windows) {
        dir.join(".venv").join("Scripts").join("python.exe")
    } else {
        dir.join(".venv").join("bin").join("python")
    }
}

/// The agent checkout and its interpreter. Installed builds look in the app data
/// dir (the first-run installer puts the agent there, outside the replaceable
/// install dir); dev builds use the repo's agent/ and its .venv.
fn agent_runtime(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(data) = app.path().app_data_dir() {
        dirs.push(data.join("agent"));
    }
    #[cfg(debug_assertions)]
    dirs.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("agent"));
    dirs.into_iter()
        .map(|dir| (venv_python(&dir), dir))
        .find(|(py, dir)| py.exists() && dir.join("tui_gateway").is_dir())
        .ok_or_else(|| "Filey Agent is not installed on this computer yet.".to_string())
}

/// Agent state (sessions, memory, skills, config) is per user and survives updates.
fn agent_home(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app.path().app_data_dir().map_err(|e| e.to_string())?.join("filey-agent");
    std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    Ok(home)
}

/// The model is Filey AI through the user's own Coins: the agent calls the ai-credits edge
/// function's OpenAI-compatible route with the signed-in user's access token, which the app
/// keeps fresh in `filey-session.json` (read per request by `key_cmd`). The provider key never
/// reaches this machine. Written once; the user may edit it afterwards (e.g. their own key).
fn seed_config(home: &Path) -> Result<(), String> {
    let path = home.join("config.yaml");
    if path.exists() {
        return Ok(());
    }
    let key_cmd = if cfg!(windows) {
        r#"type "%FILEY_HOME%\filey-session.json""#
    } else {
        r#"cat "$FILEY_HOME/filey-session.json""#
    };
    // threshold_tokens keeps every request inside the credits gateway's size bound.
    let config = format!(
        "model:\n  provider: filey\n  default: filey-ai\n\
         providers:\n  filey:\n    name: Filey AI\n    base_url: {SUPABASE_URL}/functions/v1/ai-credits\n\
         \x20   key_cmd: '{key_cmd}'\n    default_model: filey-ai\n    context_length: 131072\n    discover_models: false\n\
         compression:\n  threshold_tokens: 12000\n"
    );
    std::fs::write(&path, config).map_err(|e| format!("could not write Filey Agent config: {e}"))
}

const SUPABASE_URL: &str = "https://voyrjqgaypiylwskkwpr.supabase.co";

/// The signed-in user's access token for the model route. Called on start and on every refresh.
#[tauri::command]
pub fn filey_agent_session(window: Webview, app: AppHandle, access_token: String, expires_at: i64) -> Result<(), String> {
    super::computer_use::check_window(&window)?;
    if access_token.is_empty() || access_token.chars().any(|c| c.is_whitespace() || c == '"') {
        return Err("Invalid session token".into());
    }
    let body = serde_json::json!({ "access_token": access_token, "expires_in": (expires_at - chrono_now()).max(0) });
    std::fs::write(agent_home(&app)?.join("filey-session.json"), body.to_string())
        .map_err(|e| format!("could not store the Filey Agent session: {e}"))
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn filey_agent_start(window: Webview, app: AppHandle) -> Result<(), String> {
    super::computer_use::check_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || start_blocking(app))
        .await
        .map_err(|e| e.to_string())?
}

fn start_blocking(app: AppHandle) -> Result<(), String> {
    let mut guard = AGENT.lock().unwrap();
    if let Some(sup) = guard.as_mut() {
        if matches!(sup.child.try_wait(), Ok(None)) {
            return Ok(()); // already running; the webview re-attaches to its lines
        }
    }
    let (python, dir) = agent_runtime(&app)?;
    let home = agent_home(&app)?;
    seed_config(&home)?;

    let mut cmd = Command::new(&python);
    cmd.args(["-m", "tui_gateway.entry"])
        .current_dir(&dir)
        .env("FILEY_HOME", &home)
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| format!("could not start Filey Agent: {e}"))?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin = child.stdin.take();
    *guard = Some(Supervisor { pid, child, stdin });
    drop(guard);

    // Diagnostics go to stderr; an unread pipe would eventually freeze the agent.
    if let Some(stderr) = stderr {
        std::thread::spawn(move || for _ in BufReader::new(stderr).lines().map_while(Result::ok) {});
    }
    if let Some(stdout) = stdout {
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.starts_with('{') {
                    let _ = app.emit_to(tauri::EventTarget::webview("main"), "filey-agent-line", line);
                }
            }
            let mut guard = AGENT.lock().unwrap();
            if guard.as_ref().is_some_and(|sup| sup.pid == pid) {
                *guard = None;
            }
            drop(guard);
            let _ = app.emit_to(tauri::EventTarget::webview("main"), "filey-agent-exit", pid);
        });
    }
    Ok(())
}

/// One JSON-RPC frame from the webview to the agent.
#[tauri::command]
pub fn filey_agent_send(window: Webview, line: String) -> Result<(), String> {
    super::computer_use::check_window(&window)?;
    if line.contains('\n') {
        return Err("one frame per line".into());
    }
    let mut guard = AGENT.lock().unwrap();
    let stdin = guard
        .as_mut()
        .and_then(|sup| sup.stdin.as_mut())
        .ok_or("Filey Agent is not running")?;
    stdin
        .write_all(format!("{line}\n").as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("could not reach Filey Agent: {e}"))
}

#[tauri::command]
pub async fn filey_agent_stop(window: Webview) -> Result<(), String> {
    super::computer_use::check_window(&window)?;
    tauri::async_runtime::spawn_blocking(stop_blocking).await.map_err(|e| e.to_string())
}

fn stop_blocking() {
    let stopped = AGENT.lock().unwrap().take();
    if let Some(mut sup) = stopped {
        sup.stdin.take(); // EOF: the backend closes its sessions and exits
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while matches!(sup.child.try_wait(), Ok(None)) {
            if std::time::Instant::now() >= deadline {
                let _ = sup.child.kill();
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = sup.child.wait();
    }
}
