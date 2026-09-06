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
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

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
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    state: BridgeState,
}

static BRIDGE: Mutex<Option<Supervisor>> = Mutex::new(None);

fn set_state(app: &AppHandle, mutate: impl FnOnce(&mut BridgeState)) {
    let mut guard = BRIDGE.lock().unwrap();
    if let Some(sup) = guard.as_mut() {
        mutate(&mut sup.state);
        let snapshot = sup.state.clone();
        drop(guard);
        // Best-effort: a missing window is not a reason to lose the session.
        let _ = app.emit("wa-bridge", snapshot);
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

/// Kill any sidecar left over from a previous run of the app.
///
/// Windows does not reap orphans: a crash, a force-quit, or a dev-mode rebuild
/// kills the app and leaves the bridge running with a live WhatsApp socket.
/// The next launch then spawns a second one, and two bridges sharing one auth
/// folder both write signal state — which shreds the session and leaves the
/// phone showing "Waiting for this message" until you re-pair. wa_bridge_stop
/// only reaches a child THIS process spawned, so it cannot help here; sweeping
/// by name before spawning is what survives a hard kill.
fn kill_stale_sidecars() {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/F", "/IM", "filey-wa-bridge.exe"]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.output(); // nothing to kill is the normal case
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("pkill").args(["-f", "filey-wa-bridge"]).output();
    }
}

/// Start (or restart) the bridge. No webhook — messages route to the app's own
/// agent over stdin/stdout.
///
/// Async because getting here is not free: stopping the old bridge waits on a
/// child process and `kill_stale_sidecars` shells out to taskkill. On the main
/// thread that is a window that stops painting, and a sidecar that refuses to
/// die is a window that never comes back.
#[tauri::command]
pub async fn wa_bridge_start(app: AppHandle) -> Result<BridgeState, String> {
    tauri::async_runtime::spawn_blocking(move || wa_bridge_start_blocking(app))
        .await
        .map_err(|e| e.to_string())?
}

fn wa_bridge_start_blocking(app: AppHandle) -> Result<BridgeState, String> {
    wa_bridge_stop_blocking();
    kill_stale_sidecars();

    let bin = sidecar_path(&app)?;
    // Session state must outlive updates, so it goes in the per-user app data
    // dir — never beside the binary, which reinstalls replace.
    let state_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("wa-bridge");
    std::fs::create_dir_all(&state_dir).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&bin);
    cmd.env("FILEY_BRIDGE_STATE", &state_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW); // no console window on launch

    let mut child = cmd.spawn().map_err(|e| format!("could not start bridge: {e}"))?;
    let stdout = child.stdout.take();
    let stdin = child.stdin.take();

    {
        let mut guard = BRIDGE.lock().unwrap();
        *guard = Some(Supervisor {
            child: Some(child),
            stdin,
            state: BridgeState {
                state: "starting".into(),
                qr: None,
                error: None,
                me: None,
            },
        });
    }

    if let Some(stdout) = stdout {
        let app2 = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Some(payload) = line.strip_prefix("FILEY ") else {
                    // Not protocol — the sidecar's own logs ("← Name: text",
                    // send failures, the ASCII QR). These used to be dropped on
                    // the floor, which meant a bridge that received a message
                    // and answered nobody left no trace anywhere. Forward them.
                    if !line.trim().is_empty() {
                        println!("[wa-bridge] {line}");
                    }
                    continue;
                };
                let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else {
                    continue;
                };
                match v.get("type").and_then(|t| t.as_str()) {
                    Some("qr") => {
                        let url = v.get("dataUrl").and_then(|d| d.as_str()).unwrap_or("").to_string();
                        set_state(&app2, |s| {
                            s.qr = Some(url);
                            s.state = "connecting".into();
                        });
                    }
                    Some("status") => {
                        let st = v.get("state").and_then(|s| s.as_str()).unwrap_or("").to_string();
                        let me = v.get("me").and_then(|m| m.as_str()).map(String::from);
                        set_state(&app2, |s| {
                            // A scanned code is spent — drop it so the UI stops
                            // showing a QR nobody can use.
                            if st == "connected" || st == "logged_out" {
                                s.qr = None;
                            }
                            s.state = st.clone();
                            if let Some(m) = me {
                                s.me = Some(m);
                            }
                        });
                    }
                    Some("message") => {
                        // Route to the local agent in the frontend.
                        let _ = app2.emit("wa-message", v.clone());
                    }
                    Some("voice_note") => {
                        // A voice note the owner sent — the app transcribes it
                        // (Whisper via the configured provider) and answers.
                        let _ = app2.emit("wa-voice", v.clone());
                    }
                    _ => {}
                }
            }
            // stdout closed: the process is gone.
            set_state(&app2, |s| {
                if s.state != "logged_out" {
                    s.state = "stopped".into();
                }
                s.qr = None;
            });
        });
    }

    Ok(wa_bridge_state())
}

/// Send the local agent's reply back to the sidecar (and thus to WhatsApp).
///
/// A missing bridge is an ERROR, not a silent Ok: the agent believes it
/// answered, the log records an outgoing message, and the owner waits on a
/// reply that was written nowhere. Failing loudly is what lets the UI say
/// "the bridge dropped" instead of "the agent is broken".
#[tauri::command]
pub fn wa_bridge_reply(id: String, text: String) -> Result<(), String> {
    let mut guard = BRIDGE.lock().unwrap();
    let stdin = guard
        .as_mut()
        .and_then(|sup| sup.stdin.as_mut())
        .ok_or_else(|| "WhatsApp bridge is not running".to_string())?;
    let line = format!(
        "FILEY {}\n",
        serde_json::json!({ "type": "reply", "id": id, "text": text })
    );
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("could not reach the WhatsApp bridge: {e}"))
}

/// Send a proactive WhatsApp message to a specific JID (owner notifications —
/// daily summary, low-stock and overdue alerts).
#[tauri::command]
pub fn wa_bridge_send(to: String, text: String) -> Result<(), String> {
    let mut guard = BRIDGE.lock().unwrap();
    let stdin = guard
        .as_mut()
        .and_then(|sup| sup.stdin.as_mut())
        .ok_or_else(|| "WhatsApp bridge is not running".to_string())?;
    let line = format!(
        "FILEY {}\n",
        serde_json::json!({ "type": "send", "to": to, "text": text })
    );
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("could not reach the WhatsApp bridge: {e}"))
}

/// Send a FILE (PDF, photo, document) to a JID. The sidecar reads the file off
/// the same disk and uploads it — a document for most types, a photo for
/// images — so a merged PDF or a payslip lands straight in the owner's chat.
#[tauri::command]
pub fn wa_bridge_send_file(
    to: String,
    path: String,
    filename: String,
    mimetype: String,
    caption: String,
) -> Result<(), String> {
    // The path is the contract: it must exist NOW, before the sidecar races to
    // read it. A missing file is an error here rather than a silent no-send.
    if !std::path::Path::new(&path).exists() {
        return Err(format!("file not found: {path}"));
    }
    let mut guard = BRIDGE.lock().unwrap();
    let stdin = guard
        .as_mut()
        .and_then(|sup| sup.stdin.as_mut())
        .ok_or_else(|| "WhatsApp bridge is not running".to_string())?;
    let line = format!(
        "FILEY {}\n",
        serde_json::json!({
            "type": "send_file",
            "to": to,
            "path": path,
            "filename": filename,
            "mimetype": mimetype,
            "caption": caption,
        })
    );
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("could not reach the WhatsApp bridge: {e}"))
}

/// Async for the same reason as start: `child.wait()` has no timeout, so a
/// sidecar that ignores the kill would otherwise hang the window for good.
#[tauri::command]
pub async fn wa_bridge_stop(_app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(wa_bridge_stop_blocking)
        .await
        .map_err(|e| e.to_string())
}

fn wa_bridge_stop_blocking() {
    let mut guard = BRIDGE.lock().unwrap();
    if let Some(sup) = guard.as_mut() {
        if let Some(child) = sup.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        sup.child = None;
        sup.stdin = None;
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
pub async fn wa_bridge_reset(app: AppHandle) -> Result<BridgeState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        wa_bridge_stop_blocking();
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("wa-bridge");
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| format!("could not clear session: {e}"))?;
        }
        wa_bridge_start_blocking(app)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn wa_bridge_state() -> BridgeState {
    BRIDGE
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.state.clone())
        .unwrap_or_default()
}
