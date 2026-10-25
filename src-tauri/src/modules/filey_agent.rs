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
        // pythonw: the windowless interpreter. The engine talks over pipes and never needs a
        // console, and some antivirus tools quarantine python.exe while leaving pythonw.exe.
        let scripts = dir.join(".venv").join("Scripts");
        let windowless = scripts.join("pythonw.exe");
        if windowless.exists() { windowless } else { scripts.join("python.exe") }
    } else {
        dir.join(".venv").join("bin").join("python")
    }
}

/// The agent and its interpreter. Dev builds use the repo's agent/ and its .venv; installed
/// builds use the engine downloaded on first use (agent_engine.rs), then an older
/// hand-placed `<app data>/agent` checkout.
fn agent_runtime(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let venv = |dir: PathBuf| {
        let py = venv_python(&dir);
        (py.exists() && dir.join("tui_gateway").is_dir()).then_some((py, dir))
    };
    #[cfg(debug_assertions)]
    if let Some(found) = venv(Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("agent")) {
        return Ok(found);
    }
    if let Some(found) = super::agent_engine::installed(app) {
        return Ok(found);
    }
    app.path()
        .app_data_dir()
        .ok()
        .and_then(|data| venv(data.join("agent")))
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
    let (model, providers) = credits_blocks();
    let config = format!("{model}{providers}{COMPRESSION_BLOCK}{AGENT_BLOCK}{TOOLS_BLOCK}");
    std::fs::write(&path, config).map_err(|e| format!("could not write Filey Agent config: {e}"))
}

/// Above the base prompt (system + visible tools, ~12K tokens) with room for a real
/// conversation. At 12000 the engine tried to compress before every single turn, and each
/// mid-session compression is an extra model call over the whole transcript.
const COMPRESSION_BLOCK: &str = "compression:\n  threshold_tokens: 40000\n";

/// The engine's own cron scheduler only runs in Hermes' messaging gateway, which Filey never
/// starts, so jobs made with its `cronjob` tool would never fire. Filey's automations
/// (create_automation, run by the app's scheduler on this engine) take that role.
const AGENT_BLOCK: &str = "agent:\n  disabled_toolsets:\n    - cronjob\n";

/// Desktop sessions carry Hermes' whole local kit; these schemas load on demand through its
/// tool-search bridge instead of riding every request (Hermes' own defaults, plus the browser,
/// kanban, speech and connector tools, and the Filey tools that are not everyday: their
/// schemas alone were ~11K tokens a request). Always visible: pdf, word, sheet,
/// filey_computer, workspace_browser, list_my_files, read_attached_document, filey_tools and filey_run.
const TOOLS_BLOCK: &str = "tools:\n  tool_search:\n    listing_max_tokens: 1500\n    defer:\n\
\x20     - slides\n      - design\n      - fig\n      - vector\n      - agent_computer\n\
\x20     - open_page\n      - show_ui\n      - use_saved_file\n\
\x20     - list_file_tools\n      - run_file_tool\n      - get_stats\n      - financial_summary\n\
\x20     - find_customers\n      - find_products\n      - list_invoices\n      - get_invoice\n\
\x20     - create_invoice_draft\n      - export_invoice_pdf\n      - create_quote\n\
\x20     - create_letter_draft\n      - delegate_task\n      - skill_manage\n\
\x20     - computer_use\n      - session_search\n      - image_generate\n      - todo_list\n\
\x20     - process_manage\n      - cronjob_manage\n      - browser_vault\n\
\x20     - drive_preview\n      - gui_tour\n      - desktop_preview\n      - annotate_preview\n\
\x20     - manage_catalog\n      - show_tip\n      - desktop_project\n      - close_terminal\n\
\x20     - apply_layout\n      - read_terminal\n      - read_window_below\n      - focus_pane\n\
\x20     - browser_navigate\n      - browser_snapshot\n      - browser_click\n      - browser_type\n\
\x20     - browser_scroll\n      - browser_back\n      - browser_press\n      - browser_get_images\n\
\x20     - browser_vision\n      - browser_console\n      - browser_cdp\n      - browser_dialog\n\
\x20     - browser_exec\n      - text_to_speech\n      - manage_connections\n      - execute_code\n\
\x20     - kanban_show\n      - kanban_list\n      - kanban_complete\n      - kanban_block\n\
\x20     - kanban_request_review\n      - kanban_request_changes\n      - kanban_heartbeat\n\
\x20     - kanban_comment\n      - kanban_create\n      - kanban_link\n      - kanban_unblock\n\
\x20     - kanban_attach\n      - kanban_attach_url\n      - kanban_attachments\n";

/// A key file the engine reads per request with `key_cmd` (bare token on stdout).
fn key_cmd(file: &str) -> String {
    if cfg!(windows) {
        format!(r#"type "%FILEY_HOME%\{file}""#)
    } else {
        format!(r#"cat "$FILEY_HOME/{file}""#)
    }
}

/// Filey AI on the user's own Coins (the default).
fn credits_blocks() -> (String, String) {
    (
        "model:\n  provider: filey\n  default: filey-ai\n".into(),
        format!(
            "providers:\n  filey:\n    name: Filey AI\n    base_url: {SUPABASE_URL}/functions/v1/ai-credits\n\
             \x20   key_cmd: '{}'\n    default_model: filey-ai\n    context_length: 131072\n    discover_models: false\n",
            key_cmd("filey-session.json")
        ),
    )
}

/// A YAML single-quoted scalar.
fn quoted(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// The person's own provider from Settings → AI (OpenAI-compatible or Anthropic).
fn own_blocks(own: &OwnModel) -> (String, String) {
    let api_mode = if own.anthropic { "anthropic_messages" } else { "chat_completions" };
    (
        format!("model:\n  provider: own\n  default: {}\n", quoted(&own.model)),
        format!(
            "providers:\n  own:\n    name: Your AI provider\n    base_url: {}\n    key_cmd: '{}'\n\
             \x20   default_model: {}\n    api_mode: {api_mode}\n    discover_models: false\n",
            quoted(&own.base_url),
            key_cmd("own-model-key.txt"),
            quoted(&own.model)
        ),
    )
}

/// Replace whole top-level YAML blocks (`key:` at column 0 through the next top-level line),
/// appending any that are missing. Everything else in the file — settings the person or the
/// engine added — is kept as it is.
fn replace_top_level(current: &str, blocks: &[(&str, String)]) -> String {
    let mut out = String::new();
    let mut skipping = false;
    let mut done: Vec<&str> = Vec::new();
    for line in current.lines() {
        let top = line.chars().next().is_some_and(|c| !c.is_whitespace() && c != '#');
        if top {
            skipping = false;
            let key = line.split(':').next().unwrap_or("").trim();
            if let Some((name, block)) = blocks.iter().find(|(name, _)| *name == key) {
                out.push_str(block);
                done.push(name);
                skipping = true;
                continue;
            }
        }
        if !skipping {
            out.push_str(line);
            out.push('\n');
        }
    }
    for (name, block) in blocks {
        if !done.contains(name) {
            out.push_str(block);
        }
    }
    out
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnModel {
    base_url: String,
    model: String,
    api_key: String,
    anthropic: bool,
}

/// Point the engine at the model chosen in Settings → AI: Filey AI (no `own`) or the
/// person's own provider and key. Returns whether the config changed; the app restarts
/// an idle engine to apply it.
#[tauri::command]
pub fn filey_agent_model(window: Webview, app: AppHandle, own: Option<OwnModel>) -> Result<bool, String> {
    super::computer_use::check_window(&window)?;
    let home = agent_home(&app)?;
    seed_config(&home)?;
    let key_file = home.join("own-model-key.txt");
    let (model, providers) = match &own {
        None => {
            let _ = std::fs::remove_file(&key_file);
            credits_blocks()
        }
        Some(own) => {
            let plain = |value: &str| !value.is_empty() && value.len() <= 400 && !value.chars().any(|c| c.is_control());
            if !plain(&own.model) || !plain(&own.base_url)
                || !(own.base_url.starts_with("https://") || own.base_url.starts_with("http://"))
            {
                return Err("The AI provider address or model name is not valid.".into());
            }
            let key = own.api_key.trim();
            if key.chars().any(|c| c.is_control()) || key.len() > 4096 {
                return Err("The AI provider key is not valid.".into());
            }
            // A local model server (Ollama, LM Studio) needs no key; the engine still wants one.
            std::fs::write(&key_file, if key.is_empty() { "none" } else { key })
                .map_err(|e| format!("could not store the AI provider key: {e}"))?;
            own_blocks(own)
        }
    };
    let path = home.join("config.yaml");
    let current = std::fs::read_to_string(&path).unwrap_or_default();
    // compression and tools are Filey's to tune (request size), so they follow each release.
    let mut next = replace_top_level(&current, &[
        ("model", model),
        ("providers", providers),
        ("compression", COMPRESSION_BLOCK.into()),
        ("tools", TOOLS_BLOCK.into()),
    ]);
    // Older configs predate this block; an `agent:` block the engine or person wrote is left alone.
    if !next.lines().any(|line| line.trim_end() == "agent:") {
        next.push_str(AGENT_BLOCK);
    }
    if next == current {
        return Ok(false);
    }
    std::fs::write(&path, next).map_err(|e| format!("could not update Filey Agent config: {e}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_only_the_model_blocks_and_keeps_the_rest() {
        let (model, providers) = credits_blocks();
        let start = format!("{model}{providers}compression:\n  threshold_tokens: 12000\nmcp_servers:\n  files: {{}}\n");
        let own = OwnModel { base_url: "https://api.example.test/v1".into(), model: "gpt-x".into(), api_key: "k".into(), anthropic: false };
        let (m, p) = own_blocks(&own);
        let next = replace_top_level(&start, &[("model", m), ("providers", p)]);
        assert!(next.contains("provider: own"));
        assert!(next.contains("base_url: 'https://api.example.test/v1'"));
        assert!(next.contains("api_mode: chat_completions"));
        assert!(!next.contains("Filey AI"));
        assert!(next.contains("compression:\n  threshold_tokens: 12000\n"));
        assert!(next.contains("mcp_servers:\n  files: {}\n"));
        // And back to Filey AI.
        let (m, p) = credits_blocks();
        let back = replace_top_level(&next, &[("model", m), ("providers", p)]);
        assert_eq!(back, start);
    }

    #[test]
    fn managed_blocks_replace_an_older_config() {
        let old = "compression:\n  threshold_tokens: 12000\ntools:\n  tool_search:\n    defer:\n      - computer_use\nonboarding:\n  seen: {}\n";
        let next = replace_top_level(old, &[("compression", COMPRESSION_BLOCK.into()), ("tools", TOOLS_BLOCK.into())]);
        assert!(next.contains("threshold_tokens: 40000") && !next.contains("12000"));
        assert!(next.contains("    listing_max_tokens: 1500\n") && next.contains("      - create_letter_draft\n"));
        assert!(next.contains("      - kanban_attachments\n") && next.contains("onboarding:\n  seen: {}\n"));
    }

    #[test]
    fn quotes_values_safely() {
        assert_eq!(quoted("it's"), "'it''s'");
    }
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

    // The engine starts only from this app: a one-time secret in its environment
    // that must match the first line on its private stdin (agent/tui_gateway/entry.py).
    let token: String = rand::random::<[u8; 24]>().iter().map(|b| format!("{b:02x}")).collect();
    let mut cmd = Command::new(&python);
    cmd.args(["-m", "tui_gateway.entry"])
        .current_dir(&dir)
        .env("FILEY_LAUNCH_TOKEN", &token)
        .env("FILEY_HOME", &home)
        // This sidecar runs on the owner's machine, so app sessions get the real
        // terminal and file tools. A hosted backend never sees this flag.
        .env("FILEY_APP_LOCAL", "1")
        // Dev builds pre-approve the agent's own terminal and file tools so a
        // desktop test can run commands without an approval card. Release
        // builds leave approvals on. Destructive-command blocks still apply.
        .env("FILEY_YOLO_MODE", if cfg!(debug_assertions) { "1" } else { "0" })
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
    let mut stdin = child.stdin.take();
    if let Some(pipe) = stdin.as_mut() {
        pipe.write_all(format!("{{\"filey_launch\":\"{token}\"}}\n").as_bytes())
            .and_then(|_| pipe.flush())
            .map_err(|e| format!("could not start Filey Agent: {e}"))?;
    }
    *guard = Some(Supervisor { pid, child, stdin });
    drop(guard);

    // Diagnostics go to stderr; an unread pipe would eventually freeze the agent.
    // The last lines are kept so an engine that dies at startup can say why.
    let tail = std::sync::Arc::new(Mutex::new(std::collections::VecDeque::<String>::new()));
    let stderr_reader = stderr.map(|stderr| {
        let tail = tail.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut tail) = tail.lock() {
                    if tail.len() == 8 {
                        tail.pop_front();
                    }
                    tail.push_back(line.chars().take(300).collect());
                }
            }
        })
    });
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
            // Not a join: a command the agent started can inherit stderr and hold it
            // open after the engine is gone. A moment is enough for its last words.
            if stderr_reader.is_some() {
                std::thread::sleep(Duration::from_millis(300));
            }
            let last: Vec<String> = tail.lock().map(|t| t.iter().cloned().collect()).unwrap_or_default();
            let _ = app.emit_to(
                tauri::EventTarget::webview("main"),
                "filey-agent-exit",
                serde_json::json!({ "pid": pid, "stderr": last }),
            );
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

/// Stop the engine if it runs (used before replacing its files).
pub fn stop_engine() {
    stop_blocking();
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
