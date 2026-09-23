//! WhatsApp bridge supervisor.
//!
//! The bridge is a QR-paired WhatsApp session (see tools/wa-bridge). A session
//! is a long-lived socket with rolling auth state, so it cannot live in an edge
//! function — it runs here, as a sidecar this process starts and outlives.
//!
//! Spawned with std::process::Command rather than tauri-plugin-shell: the app
//! exposes its own three commands, so pulling in the plugin would add a
//! permission surface (arbitrary command execution from JS) to save nothing.
//!
//! The sidecar prints one JSON object per line prefixed with "FILEY ". A reader
//! thread parses those into BRIDGE, which the UI polls through wa_bridge_state
//! and which also rides out on the `wa-bridge` event for live updates.
//!
//! LOCAL AGENT: there is no webhook anymore. Incoming messages arrive as
//! `{type:"message", id, from, text, fromName}` lines, which are re-emitted to
//! the frontend as the `wa-message` event; the frontend runs the app's own
//! agent and answers with `wa_bridge_reply`, which writes the reply back to the
//! sidecar's stdin. The brain, memory and tools all live in the app — no server.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Webview};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct BridgeState {
    /// "stopped" | "starting" | "connecting" | "connected" | "reconnecting"
    /// | "logged_out" | "error"
    pub state: String,
    /// PNG data URL of the pairing QR, present only while it is scannable.
    pub qr: Option<String>,
    /// Last error worth showing a human.
    pub error: Option<String>,
    /// The paired JID once connected (the owner's own chat in self-chat mode).
    pub me: Option<String>,
}

struct Supervisor {
    pid: u32,
    // Held for this process's session lifetime; another Filey window must not
    // kill this bridge or write to the same Signal credential directory.
    session_lock: Option<std::fs::File>,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    state: BridgeState,
    deliveries: HashMap<String, mpsc::Sender<Result<String, String>>>,
}

static BRIDGE: Mutex<Option<Supervisor>> = Mutex::new(None);
static LIFECYCLE: Mutex<()> = Mutex::new(());

fn set_state(app: &AppHandle, pid: u32, mutate: impl FnOnce(&mut BridgeState)) {
    let mut guard = BRIDGE.lock().unwrap();
    if let Some(sup) = guard.as_mut() {
        if sup.pid != pid {
            return;
        } // a stopped reader must not overwrite its replacement
        mutate(&mut sup.state);
        let snapshot = sup.state.clone();
        drop(guard);
        // Best-effort: a missing window is not a reason to lose the session.
        let _ = app.emit_to(tauri::EventTarget::webview("main"), "wa-bridge", snapshot);
    }
}

/// Sidecar path. Tauri places externalBin next to the app executable, with the
/// target triple stripped at bundle time.
///
/// Dev builds get two extra fallbacks, because `tauri dev` copies nothing:
/// the triple-suffixed name next to the dev executable, and the repo's
/// `src-tauri/binaries/` output of build.ps1 (found via CARGO_MANIFEST_DIR,
/// which only exists to dev builds). Without these, WhatsApp was packaged-
/// build-only: dev started no bridge, and every message sat unanswered.
fn sidecar_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let plain = if cfg!(windows) {
        "filey-wa-bridge.exe"
    } else {
        "filey-wa-bridge"
    };
    let tripled = if cfg!(windows) {
        "filey-wa-bridge-x86_64-pc-windows-msvc.exe"
    } else if cfg!(target_arch = "aarch64") {
        "filey-wa-bridge-aarch64-apple-darwin"
    } else {
        "filey-wa-bridge-x86_64-apple-darwin"
    };

    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    // Packaged builds: next to the executable. Dev builds: the binaries dir.
    if let Ok(dir) = std::env::current_exe() {
        if let Some(dir) = dir.parent() {
            candidates.push(dir.join(plain));
            candidates.push(dir.join(tripled)); // tauri dev layout
        }
    }
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("binaries").join(plain));
    }
    // Repo checkout: build.ps1 compiles the sidecar into src-tauri/binaries.
    candidates.push(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(tripled),
    );

    candidates
        .into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| "WhatsApp bridge binary is not installed with this build".to_string())
}

fn lock_session(dir: &std::path::Path) -> Result<std::fs::File, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    // Outside the pairing directory so Re-pair cannot delete a held lock.
    let file = std::fs::OpenOptions::new().read(true).write(true).create(true)
        .truncate(false).open(dir.join("wa-bridge.lock")).map_err(|e| e.to_string())?;
    file.try_lock().map_err(|e| match e {
        std::fs::TryLockError::WouldBlock => "WhatsApp is already running in another Filey window. Close that window before connecting here.".to_string(),
        std::fs::TryLockError::Error(error) => format!("Could not protect the WhatsApp session: {error}"),
    })?;
    Ok(file)
}

/// Start (or restart) the bridge. No webhook — messages route to the app's own
/// agent over stdin/stdout.
///
/// Async because getting here is not free: stopping the old bridge waits on a
/// child process. On the main
/// thread that is a window that stops painting, and a sidecar that refuses to
/// die is a window that never comes back.
#[tauri::command]
pub async fn wa_bridge_start(window: Webview, app: AppHandle, owner_number: Option<String>) -> Result<BridgeState, String> {
    super::computer_use::check_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _lifecycle = LIFECYCLE.lock().unwrap();
        wa_bridge_start_blocking(app, owner_number, false)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn wa_bridge_start_blocking(app: AppHandle, owner_number: Option<String>, reset: bool) -> Result<BridgeState, String> {
    wa_bridge_stop_blocking();

    let bin = sidecar_path(&app)?;
    // Session state must outlive updates, so it goes in the per-user app data
    // dir — never beside the binary, which reinstalls replace.
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let session_lock = lock_session(&app_dir)?;
    let state_dir = app_dir.join("wa-bridge");
    if reset && state_dir.exists() {
        std::fs::remove_dir_all(&state_dir).map_err(|e| format!("Could not clear WhatsApp pairing: {e}"))?;
    }
    std::fs::create_dir_all(&state_dir).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&bin);
    cmd.env("FILEY_BRIDGE_STATE", &state_dir)
        .env("FILEY_BRIDGE_OWNER", owner_number.unwrap_or_default())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW); // no console window on launch

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start bridge: {e}"))?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin = child.stdin.take();

    {
        let mut guard = BRIDGE.lock().unwrap();
        *guard = Some(Supervisor {
            pid,
            session_lock: Some(session_lock),
            child: Some(child),
            stdin,
            state: BridgeState {
                state: "starting".into(),
                qr: None,
                error: None,
                me: None,
            },
            deliveries: HashMap::new(),
        });
    }

    // Baileys writes diagnostics to stderr. An unread pipe eventually fills and
    // freezes the sidecar even though the UI still says it is connected.
    if let Some(stderr) = stderr {
        std::thread::spawn(move || {
            // Third-party diagnostics may contain Signal session keys. Drain
            // the pipe, but expose only the bridge's structured status errors.
            for _ in BufReader::new(stderr).lines().map_while(Result::ok) {}
        });
    }

    if let Some(stdout) = stdout {
        let app2 = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Some(payload) = line.strip_prefix("FILEY ") else {
                    // Never persist library diagnostics, raw messages or QR
                    // material in desktop logs. Status travels via FILEY JSON.
                    continue;
                };
                let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else {
                    continue;
                };
                match v.get("type").and_then(|t| t.as_str()) {
                    Some("qr") => {
                        let url = v
                            .get("dataUrl")
                            .and_then(|d| d.as_str())
                            .unwrap_or("")
                            .to_string();
                        set_state(&app2, pid, |s| {
                            s.qr = Some(url);
                            s.state = "connecting".into();
                        });
                    }
                    Some("status") => {
                        let st = v
                            .get("state")
                            .and_then(|s| s.as_str())
                            .unwrap_or("")
                            .to_string();
                        let me = v.get("me").and_then(|m| m.as_str()).map(String::from);
                        set_state(&app2, pid, |s| {
                            // A scanned code is spent — drop it so the UI stops
                            // showing a QR nobody can use.
                            if st != "connecting" {
                                s.qr = None;
                            }
                            s.state = st.clone();
                            s.error = v.get("error").and_then(|e| e.as_str()).map(String::from);
                            if st == "logged_out" {
                                s.me = None;
                            }
                            if let Some(m) = me {
                                s.me = Some(m);
                            }
                        });
                    }
                    Some("delivery") => {
                        let mut guard = BRIDGE.lock().unwrap();
                        if let Some(sup) = guard.as_mut().filter(|sup| sup.pid == pid) {
                            if let Some(id) = v.get("requestId").and_then(|id| id.as_str()) {
                                if let Some(sender) = sup.deliveries.remove(id) {
                                    let result = if v.get("ok").and_then(|ok| ok.as_bool())
                                        == Some(true)
                                    {
                                        if v.get("skipped").and_then(|value| value.as_bool()) == Some(true) { Ok(String::new()) } else { v.get("messageId").and_then(|id| id.as_str()).filter(|id| !id.is_empty()).map(String::from).ok_or_else(|| "WhatsApp acceptance had no message ID. Check the conversation before retrying.".to_string()) }
                                    } else {
                                        Err(v.get("error").and_then(|e| e.as_str()).unwrap_or("WhatsApp did not confirm delivery. Check the conversation before retrying.").to_string())
                                    };
                                    let _ = sender.send(result);
                                }
                            }
                        }
                    }
                    Some("message") => {
                        // Route to the local agent in the frontend.
                        if BRIDGE
                            .lock()
                            .unwrap()
                            .as_ref()
                            .is_some_and(|sup| sup.pid == pid)
                        {
                            let _ = app2.emit_to(tauri::EventTarget::webview("main"), "wa-message", v.clone());
                        }
                    }
                    Some("voice_note") => {
                        // A voice note the owner sent — the app transcribes it
                        // (Whisper via the configured provider) and answers.
                        if BRIDGE
                            .lock()
                            .unwrap()
                            .as_ref()
                            .is_some_and(|sup| sup.pid == pid)
                        {
                            let _ = app2.emit_to(tauri::EventTarget::webview("main"), "wa-voice", v.clone());
                        }
                    }
                    _ => {}
                }
            }
            // stdout closed: the process is gone.
            set_state(&app2, pid, |s| {
                if s.state != "logged_out" && s.state != "error" {
                    s.state = "stopped".into();
                }
                s.qr = None;
                s.me = None;
            });
            let mut guard = BRIDGE.lock().unwrap();
            if let Some(sup) = guard.as_mut().filter(|sup| sup.pid == pid) {
                sup.stdin = None;
                for (_, sender) in sup.deliveries.drain() {
                    let _ = sender.send(Err("WhatsApp bridge stopped before confirming delivery. Check the conversation before retrying.".into()));
                }
            }
        });
    }

    Ok(bridge_snapshot())
}

/// Send the local agent's reply back to the sidecar (and thus to WhatsApp).
///
/// A missing bridge is an ERROR, not a silent Ok: the agent believes it
/// answered, the log records an outgoing message, and the owner waits on a
/// reply that was written nowhere. Failing loudly is what lets the UI say
/// "the bridge dropped" instead of "the agent is broken".
#[tauri::command]
pub async fn wa_bridge_reply(window: Webview, id: String, text: String) -> Result<String, String> {
    super::computer_use::check_window(&window)?;
    send_command(serde_json::json!({ "type": "reply", "id": id, "text": text })).await
}

/// Send a proactive WhatsApp message to a specific JID (owner notifications —
/// daily summary, low-stock and overdue alerts).
#[tauri::command]
pub async fn wa_bridge_send(window: Webview, to: String, text: String) -> Result<String, String> {
    super::computer_use::check_window(&window)?;
    send_command(serde_json::json!({ "type": "send", "to": to, "text": text })).await
}

/// Send a FILE (PDF, photo, document) to a JID. The sidecar reads the file off
/// the same disk and uploads it — a document for most types, a photo for
/// images — so a merged PDF or a payslip lands straight in the owner's chat.
#[tauri::command]
pub async fn wa_bridge_send_file(
    window: Webview,
    to: String,
    path: String,
    filename: String,
    mimetype: String,
    caption: String,
) -> Result<String, String> {
    super::computer_use::check_window(&window)?;
    // The path is the contract: it must exist NOW, before the sidecar races to
    // read it. A missing file is an error here rather than a silent no-send.
    if !std::path::Path::new(&path).exists() {
        return Err(format!("file not found: {path}"));
    }
    send_command(serde_json::json!({
        "type": "send_file",
        "to": to,
        "path": path,
        "filename": filename,
        "mimetype": mimetype,
        "caption": caption,
    }))
    .await
}

/// Wait for provider acceptance, not just a successful write into the pipe.
async fn send_command(mut payload: serde_json::Value) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let id = uuid::Uuid::new_v4().to_string();
        payload["requestId"] = serde_json::Value::String(id.clone());
        let (sender, receiver) = mpsc::channel();
        {
            let mut guard = BRIDGE.lock().unwrap();
            let sup = guard.as_mut().ok_or("WhatsApp bridge is not running")?;
            if sup.state.state != "connected" {
                return Err("WhatsApp is disconnected. Reconnect before sending.".into());
            }
            let stdin = sup.stdin.as_mut().ok_or("WhatsApp bridge is not running")?;
            let line = format!("FILEY {payload}\n");
            stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush())
                .map_err(|e| format!("could not reach the WhatsApp bridge: {e}"))?;
            sup.deliveries.insert(id.clone(), sender);
        }
        let result = receiver.recv_timeout(Duration::from_secs(90))
            .unwrap_or_else(|_| Err("WhatsApp did not confirm delivery in time. Check the chat before retrying; the message may have been accepted.".into()));
        if let Some(sup) = BRIDGE.lock().unwrap().as_mut() {
            sup.deliveries.remove(&id);
        }
        result
    }).await.map_err(|e| e.to_string())?
}

/// Async for the same reason as start: `child.wait()` has no timeout, so a
/// sidecar that ignores the kill would otherwise hang the window for good.
#[tauri::command]
pub async fn wa_bridge_stop(window: Webview, app: AppHandle) -> Result<(), String> {
    super::computer_use::check_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _lifecycle = LIFECYCLE.lock().unwrap();
        wa_bridge_stop_blocking();
        let _ = app.emit_to(tauri::EventTarget::webview("main"), "wa-bridge", bridge_snapshot());
    })
    .await
    .map_err(|e| e.to_string())
}

fn wa_bridge_stop_blocking() {
    let mut guard = BRIDGE.lock().unwrap();
    if let Some(sup) = guard.as_mut() {
        // EOF lets the bridge flush rolling Signal credentials before exit.
        // Force-killing every disconnect could leave a partially saved session.
        sup.stdin.take();
        if let Some(child) = sup.child.as_mut() {
            let deadline = std::time::Instant::now() + Duration::from_secs(3);
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    _ if std::time::Instant::now() >= deadline => {
                        let _ = child.kill();
                        break;
                    }
                    _ => std::thread::sleep(Duration::from_millis(25)),
                }
            }
            let _ = child.wait();
        }
        sup.child = None;
        sup.session_lock = None;
        sup.stdin = None;
        for (_, sender) in sup.deliveries.drain() {
            let _ = sender.send(Err("WhatsApp bridge stopped before confirming delivery. Check the conversation before retrying.".into()));
        }
        sup.state = BridgeState {
            state: "stopped".into(),
            qr: None,
            error: None,
            me: None,
        };
    }
}

/// Forget the pairing and start fresh, so the next start shows a QR.
///
/// A dropped connection used to leave stale sockets writing the same signal
/// state; once that state is torn, the phone cannot decrypt what the session
/// sends and shows "Waiting for this message" forever. Reconnecting is fixed in
/// the sidecar, but a session already corrupted stays corrupted — the keys are
/// on the phone too. This is the only way out, and it needs to be a button
/// rather than "go delete a folder in AppData".
#[tauri::command]
pub async fn wa_bridge_reset(window: Webview, app: AppHandle, owner_number: Option<String>) -> Result<BridgeState, String> {
    super::computer_use::check_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _lifecycle = LIFECYCLE.lock().unwrap();
        wa_bridge_start_blocking(app, owner_number, true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn wa_bridge_state(window: Webview) -> Result<BridgeState, String> {
    super::computer_use::check_window(&window)?;
    Ok(bridge_snapshot())
}

fn bridge_snapshot() -> BridgeState {
    BRIDGE
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.state.clone())
        .unwrap_or_else(|| BridgeState {
            state: "stopped".into(),
            ..BridgeState::default()
        })
}

#[cfg(test)]
mod tests {
    #[test]
    fn pairing_has_one_writer_and_unlocks_without_deleting_credentials() {
        let dir = std::env::temp_dir().join(format!("filey-wa-lock-{}", uuid::Uuid::new_v4()));
        let first = super::lock_session(&dir).unwrap();
        assert!(super::lock_session(&dir).unwrap_err().contains("another Filey window"));
        drop(first);
        let resumed = super::lock_session(&dir).unwrap();
        drop(resumed);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
