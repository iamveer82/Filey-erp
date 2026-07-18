//! Desktop shortcut creation (Windows).
//!
//! Invoked from the frontend on first run (user consents via a native dialog).
//! Creates "Filey ERP.lnk" on the user's Desktop pointing at the running exe —
//! the exe embeds the Filey mascot icon, so the shortcut gets it for free.

/// Create a Desktop shortcut to the current executable. Returns the .lnk path.
#[tauri::command]
pub fn create_desktop_shortcut() -> Result<String, String> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let desktop = dirs::desktop_dir().ok_or("no desktop dir")?;
        let lnk = desktop.join("Filey ERP.lnk");
        // WScript.Shell COM via PowerShell — no extra crates, always present.
        let script = format!(
            "$ws = New-Object -ComObject WScript.Shell; \
             $sc = $ws.CreateShortcut('{lnk}'); \
             $sc.TargetPath = '{exe}'; \
             $sc.WorkingDirectory = '{dir}'; \
             $sc.IconLocation = '{exe}'; \
             $sc.Description = 'Filey ERP'; \
             $sc.Save()",
            lnk = lnk.display(),
            exe = exe.display(),
            dir = exe.parent().map(|p| p.display().to_string()).unwrap_or_default(),
        );
        let status = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(lnk.display().to_string())
        } else {
            Err(format!("shortcut script exited with {status}"))
        }
    }
    #[cfg(not(windows))]
    {
        Err("desktop shortcuts are only supported on Windows".into())
    }
}
