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
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
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
}

struct Supervisor {
    child: Option<Child>,
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
fn sidecar_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let name = if cfg!(windows) {
        "filey-wa-bridge.exe"
    } else {
        "filey-wa-bridge"
    };
    // Packaged builds: next to the executable. Dev builds: the binaries dir.
    if let Ok(dir) = std::env::current_exe() {
        if let Some(dir) = dir.parent() {
            let p = dir.join(name);
            if p.exists() {
                return Ok(p);
            }
        }
    }
    let p = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("binaries")
        .join(name);
    if p.exists() {
        return Ok(p);
    }
    Err("WhatsApp bridge binary is not installed with this build".into())
}

/// Start (or restart) the bridge. `webhook_url` and `secret` are what the
/// sidecar authenticates to channel-webhook with.
#[tauri::command]
pub fn wa_bridge_start(
    app: AppHandle,
    webhook_url: String,
    secret: String,
) -> Result<BridgeState, String> {
    if webhook_url.trim().is_empty() || secret.trim().is_empty() {
        return Err("The bridge needs both a webhook URL and a shared secret".into());
    }
    wa_bridge_stop(app.clone()).ok();

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
    cmd.env("FILEY_WEBHOOK_URL", webhook_url.trim())
        .env("FILEY_BRIDGE_SECRET", secret.trim())
        .env("FILEY_BRIDGE_STATE", &state_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW); // no console window on launch

    let mut child = cmd.spawn().map_err(|e| format!("could not start bridge: {e}"))?;
    let stdout = child.stdout.take();

    {
        let mut guard = BRIDGE.lock().unwrap();
        *guard = Some(Supervisor {
            child: Some(child),
            state: BridgeState {
                state: "starting".into(),
                qr: None,
                error: None,
            },
        });
    }

    if let Some(stdout) = stdout {
        let app2 = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Some(payload) = line.strip_prefix("FILEY ") else {
                    continue; // human-readable noise (the ASCII QR, logs)
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
                        set_state(&app2, |s| {
                            // A scanned code is spent — drop it so the UI stops
                            // showing a QR nobody can use.
                            if st == "connected" || st == "logged_out" {
                                s.qr = None;
                            }
                            s.state = st.clone();
                        });
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

#[tauri::command]
pub fn wa_bridge_stop(_app: AppHandle) -> Result<(), String> {
    let mut guard = BRIDGE.lock().unwrap();
    if let Some(sup) = guard.as_mut() {
        if let Some(child) = sup.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        sup.child = None;
        sup.state = BridgeState {
            state: "stopped".into(),
            qr: None,
            error: None,
        };
    }
    Ok(())
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
