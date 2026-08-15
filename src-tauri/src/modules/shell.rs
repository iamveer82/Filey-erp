//! Owner-only shell execution. The frontend gates this behind the owner check
//! AND the confirm gate; this module just runs a command and returns its output.
//! Bounded by a timeout so a hung command can't stall the app forever.
use serde::Serialize;
use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

#[derive(Serialize)]
pub struct ShellResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Run a shell command and return stdout/stderr/exit code.
/// ponytail: `output()` runs on a thread with a recv_timeout bound — a command
/// that outlives the timeout leaks its process (the caller must kill it). Add
/// kill-on-timeout (spawn + try_wait) if long-running commands become common.
#[tauri::command]
pub fn shell_exec(cmd: String, timeout: Option<u64>) -> Result<ShellResult, String> {
    let ms = timeout.unwrap_or(60_000).clamp(1_000, 300_000);
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let (shell, flag) = if cfg!(windows) { ("cmd", "/C") } else { ("sh", "-c") };
        let _ = tx.send(Command::new(shell).arg(flag).arg(&cmd).output());
    });
    match rx.recv_timeout(Duration::from_millis(ms)) {
        Ok(Ok(o)) => Ok(ShellResult {
            stdout: String::from_utf8_lossy(&o.stdout).to_string(),
            stderr: String::from_utf8_lossy(&o.stderr).to_string(),
            exit_code: o.status.code().unwrap_or(-1),
        }),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err(format!("timed out after {}s", ms / 1000)),
    }
}
