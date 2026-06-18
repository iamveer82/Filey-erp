# Creates a "Filey ERP" shortcut on the user's Desktop pointing at the built
# desktop app. Run after `npm run tauri build` (or via `npm run setup`).

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "src-tauri\target\release\filey-erp.exe"

if (-not (Test-Path $exe)) {
  Write-Error "Built app not found at:`n  $exe`nRun 'npm run tauri build' first (or 'npm run setup')."
  exit 1
}

$desktop = [Environment]::GetFolderPath("Desktop")
$lnk = Join-Path $desktop "Filey ERP.lnk"

$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = $exe
$sc.WorkingDirectory = Split-Path $exe
$ico = Join-Path $root "src-tauri\icons\icon.ico"
if (Test-Path $ico) { $sc.IconLocation = $ico }
$sc.Description = "Filey ERP"
$sc.Save()

Write-Host "Desktop shortcut created: $lnk"
