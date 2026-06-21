# Creates "Filey ERP" shortcuts (Desktop + Start Menu) pointing at the built
# desktop app, so it's launchable and pinnable to the taskbar. Run after
# `npm run tauri build` (or via `npm run setup`).

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "src-tauri\target\release\filey-erp.exe"

if (-not (Test-Path $exe)) {
  Write-Error "Built app not found at:`n  $exe`nRun 'npm run tauri build' first (or 'npm run setup')."
  exit 1
}

$ico = Join-Path $root "src-tauri\icons\icon.ico"
$ws = New-Object -ComObject WScript.Shell

function New-FileyShortcut($path) {
  $sc = $ws.CreateShortcut($path)
  $sc.TargetPath = $exe
  $sc.WorkingDirectory = Split-Path $exe
  if (Test-Path $ico) { $sc.IconLocation = $ico }
  $sc.Description = "Filey ERP"
  $sc.Save()
  Write-Host "Shortcut created: $path"
}

# Desktop — quick launch.
New-FileyShortcut (Join-Path ([Environment]::GetFolderPath("Desktop")) "Filey ERP.lnk")

# Start Menu — makes it searchable and pinnable to the taskbar (right-click the
# running app's taskbar button -> Pin, or Start tile -> Pin to taskbar).
$startMenu = Join-Path ([Environment]::GetFolderPath("Programs")) "Filey ERP.lnk"
New-FileyShortcut $startMenu

Write-Host "`nDone. To pin to the taskbar: open Filey ERP, right-click its taskbar icon, choose 'Pin to taskbar'."
