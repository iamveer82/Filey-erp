//! Owner-only shell execution. The frontend gates this behind the owner check
//! AND the confirm gate; this module just runs a command and returns its output.
//! Bounded by a timeout so a hung command can't stall the app forever.
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

#[derive(Serialize)]
pub struct ShellResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    /// Where the command actually ran, so the agent can find what it cloned.
    pub cwd: String,
}

/// Where the agent clones and runs things. An installed app starts in
/// Program Files, so without this every `git clone` either fails on
/// permissions or litters somewhere nobody thinks to look. A visible folder
/// under the user's home on purpose: the owner should be able to open it, read
/// the code the agent fetched, and delete the lot.
fn workspace() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join("Filey").join("workspace")
}

/// Run a shell command and return stdout/stderr/exit code.
/// Runs in the workspace unless `cwd` says otherwise, so a repo the agent
/// clones is somewhere it (and the owner) can find again.
/// ponytail: `output()` runs on a thread with a recv_timeout bound — a command
/// that outlives the timeout leaks its process (the caller must kill it). Add
/// kill-on-timeout (spawn + try_wait) if long-running commands become common.
///
/// Async so the wait leaves the main thread: `recv_timeout` blocks for up to
/// fifteen minutes, and as a synchronous command that wait ran ON the main
/// thread — one agent shell call could hold the window hostage for the length
/// of an `npm install`.
#[tauri::command]
pub async fn shell_exec(
    cmd: String,
    timeout: Option<u64>,
    cwd: Option<String>,
) -> Result<ShellResult, String> {
    tauri::async_runtime::spawn_blocking(move || shell_exec_blocking(cmd, timeout, cwd))
        .await
        .map_err(|e| e.to_string())?
}

pub fn shell_exec_blocking(
    cmd: String,
    timeout: Option<u64>,
    cwd: Option<String>,
) -> Result<ShellResult, String> {
    // 15 minutes, not 5: a cold `npm install` on a real repo outruns the old cap.
    let ms = timeout.unwrap_or(60_000).clamp(1_000, 900_000);
    let dir = cwd
        .filter(|c| !c.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(workspace);
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not use {}: {e}", dir.display()))?;
    let here = dir.to_string_lossy().to_string();

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let (shell, flag) = if cfg!(windows) { ("cmd", "/C") } else { ("sh", "-c") };
        let _ = tx.send(
            Command::new(shell)
                .arg(flag)
                .arg(&cmd)
                .current_dir(&dir)
                .output(),
        );
    });
    match rx.recv_timeout(Duration::from_millis(ms)) {
        Ok(Ok(o)) => Ok(ShellResult {
            stdout: String::from_utf8_lossy(&o.stdout).to_string(),
            stderr: String::from_utf8_lossy(&o.stderr).to_string(),
            exit_code: o.status.code().unwrap_or(-1),
            cwd: here,
        }),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err(format!("timed out after {}s", ms / 1000)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_in_the_workspace_and_reports_where() {
        let echo = if cfg!(windows) { "cd" } else { "pwd" };
        let r = shell_exec_blocking(echo.to_string(), Some(30_000), None).expect("command ran");
        assert_eq!(r.exit_code, 0, "stderr: {}", r.stderr);
        // The shell's own idea of where it is must match what we reported.
        assert_eq!(r.stdout.trim(), r.cwd.trim_end_matches(['/', '\\']));
        assert!(r.cwd.ends_with("workspace"), "cwd was {}", r.cwd);
    }

    #[test]
    fn an_explicit_cwd_wins() {
        let tmp = std::env::temp_dir().join("filey-shell-test");
        let echo = if cfg!(windows) { "cd" } else { "pwd" };
        let r = shell_exec_blocking(
            echo.to_string(),
            Some(30_000),
            Some(tmp.to_string_lossy().to_string()),
        )
        .expect("command ran");
        assert!(r.cwd.contains("filey-shell-test"), "cwd was {}", r.cwd);
    }
}
