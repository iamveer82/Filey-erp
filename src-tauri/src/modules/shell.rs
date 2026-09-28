//! Owner-only shell execution. The frontend gates this behind the owner check
//! AND the confirm gate; this module just runs a command and returns its output.
//! Bounded by a timeout so a hung command can't stall the app forever.
use serde::Serialize;
use std::path::PathBuf;
use std::process::{Command, Stdio};
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
/// Async so the wait leaves the main thread: `recv_timeout` blocks for up to
/// fifteen minutes, and as a synchronous command that wait ran ON the main
/// thread — one agent shell call could hold the window hostage for the length
/// of an `npm install`.
#[tauri::command]
pub async fn shell_exec(
    window: tauri::Webview,
    cmd: String,
    timeout: Option<u64>,
    cwd: Option<String>,
) -> Result<ShellResult, String> {
    super::computer_use::check_window(&window)?;
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

    let shell = if cfg!(windows) { "cmd" } else { "sh" };
    let mut command = Command::new(shell);
    command
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // This input is already an authorized shell command, not an argv value.
        // cmd.exe does not follow the C-runtime quote escaping used by arg().
        command
            .args(["/D", "/S", "/C"])
            .raw_arg(format!("\"{cmd}\""));
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    command.arg("-c").arg(&cmd);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    match rx.recv_timeout(Duration::from_millis(ms)) {
        Ok(Ok(o)) => Ok(ShellResult {
            stdout: String::from_utf8_lossy(&o.stdout).to_string(),
            stderr: String::from_utf8_lossy(&o.stderr).to_string(),
            exit_code: o.status.code().unwrap_or(-1),
            cwd: here,
        }),
        Ok(Err(e)) => Err(e.to_string()),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err("Could not read command output.".into()),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            // Stop the command's process tree, not just our wait for its output.
            // Otherwise an agent retry can overlap the first command's writes.
            // ponytail: native tree/group kill; detached jobs need OS job handles.
            #[cfg(windows)]
            let stopped = {
                use std::os::windows::process::CommandExt;
                Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .creation_flags(0x08000000)
                    .output()
            };
            #[cfg(not(windows))]
            let stopped = Command::new("kill")
                .args(["-KILL", "--", &format!("-{pid}")])
                .output();
            let exited = rx.recv_timeout(Duration::from_secs(5)).is_ok();
            if !exited || !stopped.map(|o| o.status.success()).unwrap_or(false) {
                return Err(format!("Command timed out after {}s. Could not confirm that every process stopped; check it before retrying.", ms / 1000));
            }
            Err(format!(
                "Command timed out after {}s and was stopped.",
                ms / 1000
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_quotes_inside_commands() {
        let command = if cfg!(windows) {
            "powershell -NoProfile -NonInteractive -Command \"Write-Output 'Filey quoted value'\""
        } else {
            "printf 'Filey quoted value'"
        };
        let result = shell_exec_blocking(command.into(), Some(30_000), None).expect("command ran");
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(result.stdout.trim(), "Filey quoted value");
    }

    #[test]
    fn timed_out_commands_cannot_finish_a_late_write() {
        let dir =
            std::env::temp_dir().join(format!("filey-shell-timeout-{}", uuid::Uuid::new_v4()));
        let command = if cfg!(windows) {
            "powershell -NoProfile -NonInteractive -Command \"Start-Sleep -Seconds 3; Set-Content -LiteralPath 'late.txt' -Value 'late'\""
        } else {
            "sleep 3; printf late > late.txt"
        };
        let result = shell_exec_blocking(
            command.into(),
            Some(1000),
            Some(dir.to_string_lossy().into()),
        );
        let error = result.err().expect("command should time out");
        assert!(error.contains("was stopped"), "{error}");
        std::thread::sleep(Duration::from_secs(3));
        assert!(
            !dir.join("late.txt").exists(),
            "timed-out command continued writing"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

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
