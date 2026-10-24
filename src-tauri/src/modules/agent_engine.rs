//! Filey Agent engine install: the packaged Python runtime and the agent (agent/, the
//! Hermes fork), downloaded on first use rather than shipped in every installer.
//!
//! The archive is published with the app's releases and signed with the same key as app
//! updates (the updater `pubkey` in tauri.conf.json); an archive that does not verify is
//! never unpacked. It lands in `<app data>/filey-engine`, unpacked beside the old copy and
//! swapped in only when complete, so a failed download never breaks a working engine.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, Webview};

/// The engine build this app runs. Bump it with every engine release (tag `engine-v<N>`).
pub const ENGINE_VERSION: &str = "1";
const RELEASES: &str = "https://github.com/iamveer82/filey-erp/releases/download";
/// Larger than any real engine; stops a wrong URL from filling the disk.
const MAX_BYTES: u64 = 1_500_000_000;

static INSTALLING: AtomicBool = AtomicBool::new(false);

fn asset() -> &'static str {
    if cfg!(target_os = "windows") {
        "filey-engine-windows-x64.zip"
    } else if cfg!(target_os = "macos") {
        "filey-engine-macos-arm64.zip"
    } else {
        "filey-engine-linux-x64.zip"
    }
}

fn engine_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("filey-engine"))
}

/// The installed engine's interpreter and agent folder, when it is this app's version.
pub fn installed(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
    let dir = engine_dir(app).ok()?;
    let version = std::fs::read_to_string(dir.join("engine.json")).ok()?;
    let version: serde_json::Value = serde_json::from_str(&version).ok()?;
    if version.get("version").and_then(|v| v.as_str()) != Some(ENGINE_VERSION) {
        return None;
    }
    let python = if cfg!(windows) {
        dir.join("python").join("pythonw.exe")
    } else {
        dir.join("python").join("bin").join("python3")
    };
    let agent = dir.join("agent");
    (python.exists() && agent.join("tui_gateway").is_dir()).then_some((python, agent))
}

fn verify_signature(app: &AppHandle, data: &[u8], signature: &str) -> Result<(), String> {
    use base64::Engine;
    use minisign_verify::{PublicKey, Signature};
    let decode = |text: &str| -> Result<String, String> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(text.trim())
            .map_err(|_| "The Filey Agent download is not signed correctly.".to_string())?;
        String::from_utf8(bytes).map_err(|_| "The Filey Agent download is not signed correctly.".to_string())
    };
    let pubkey = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|key| key.as_str())
        .ok_or("This build has no signing key to check the Filey Agent download with.")?;
    let key = PublicKey::decode(&decode(pubkey)?).map_err(|e| format!("signing key: {e}"))?;
    let signature = Signature::decode(&decode(signature)?).map_err(|e| format!("signature: {e}"))?;
    key.verify(data, &signature, true)
        .map_err(|_| "The Filey Agent download failed its signature check, so it was not installed.".to_string())
}

fn progress(app: &AppHandle, stage: &str, received: u64, total: Option<u64>) {
    let _ = app.emit_to(
        "main",
        "filey-agent-install",
        serde_json::json!({ "stage": stage, "received": received, "total": total }),
    );
}

fn unpack(data: &[u8], into: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data)).map_err(|e| format!("engine archive: {e}"))?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| format!("engine archive: {e}"))?;
        // enclosed_name refuses absolute paths and `..`: nothing escapes the engine folder.
        let Some(relative) = entry.enclosed_name() else {
            return Err("The Filey Agent archive contains an unsafe path.".into());
        };
        let target = into.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = std::fs::File::create(&target).map_err(|e| format!("{}: {e}", target.display()))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(mode));
        }
    }
    Ok(())
}

fn install_blocking(app: AppHandle) -> Result<(), String> {
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let url = format!("{RELEASES}/engine-v{ENGINE_VERSION}/{}", asset());
    let fetch_error = |e: ureq::Error| match e {
        ureq::Error::Status(404, _) => "The Filey Agent download is not published yet. Try again later.".to_string(),
        other => format!("Could not download Filey Agent: {other}"),
    };
    let signature = ureq::get(&format!("{url}.sig"))
        .call()
        .map_err(fetch_error)?
        .into_string()
        .map_err(|e| e.to_string())?;

    let response = ureq::get(&url).call().map_err(fetch_error)?;
    let total = response.header("Content-Length").and_then(|v| v.parse::<u64>().ok());
    if total.is_some_and(|t| t > MAX_BYTES) {
        return Err("The Filey Agent download is larger than expected; it was not installed.".into());
    }
    let mut reader = response.into_reader().take(MAX_BYTES + 1);
    let mut bytes: Vec<u8> = Vec::with_capacity(total.unwrap_or(0) as usize);
    let mut chunk = vec![0u8; 256 * 1024];
    let mut last = 0u64;
    loop {
        let read = reader.read(&mut chunk).map_err(|e| format!("Could not download Filey Agent: {e}"))?;
        if read == 0 {
            break;
        }
        bytes.write_all(&chunk[..read]).map_err(|e| e.to_string())?;
        let received = bytes.len() as u64;
        if received > MAX_BYTES {
            return Err("The Filey Agent download is larger than expected; it was not installed.".into());
        }
        if received - last >= 2 * 1024 * 1024 {
            last = received;
            progress(&app, "downloading", received, total);
        }
    }

    progress(&app, "verifying", bytes.len() as u64, total);
    verify_signature(&app, &bytes, &signature)?;

    progress(&app, "unpacking", bytes.len() as u64, total);
    let staging = data.join("filey-engine.partial");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    if let Err(error) = unpack(&bytes, &staging) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    drop(bytes);

    // A running engine holds its files open: stop it before the swap.
    super::filey_agent::stop_engine();
    let dir = engine_dir(&app)?;
    let old = data.join("filey-engine.old");
    let _ = std::fs::remove_dir_all(&old);
    if dir.exists() {
        std::fs::rename(&dir, &old).map_err(|e| format!("could not replace the old Filey Agent: {e}"))?;
    }
    std::fs::rename(&staging, &dir).map_err(|e| format!("could not install Filey Agent: {e}"))?;
    let _ = std::fs::remove_dir_all(&old);
    progress(&app, "done", 0, None);
    Ok(())
}

/// Download, verify and install the engine. One install at a time.
#[tauri::command]
pub async fn filey_agent_install(window: Webview, app: AppHandle) -> Result<(), String> {
    super::computer_use::check_window(&window)?;
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err("Filey Agent is already being set up.".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || install_blocking(app))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    INSTALLING.store(false, Ordering::SeqCst);
    result
}
