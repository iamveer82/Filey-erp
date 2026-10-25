# Build the Filey Agent engine archive that the desktop app downloads on first use
# (src-tauri/src/modules/agent_engine.rs).
#
#   .\scripts\build-engine.ps1 -Version 1
#
# Layout of filey-engine-windows-x64.zip:
#   python\      a standalone CPython (uv-managed, relocatable) with the agent's packages
#   agent\       the agent source (agent/, the Hermes fork), without tests, apps or web UIs
#   engine.json  { "version": "<N>" } - the app runs only the engine version it was built for
#
# Signing: with TAURI_SIGNING_PRIVATE_KEY (and _PASSWORD) set, the archive is signed with the
# same key as app updates and <zip>.sig is written next to it. The app refuses unsigned or
# mismatched archives.
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Python = "3.14",
  [string]$Out = "dist-engine"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$agent = Join-Path $root "agent"
if (-not (Test-Path (Join-Path $agent "tui_gateway"))) { throw "agent/ is missing: the engine is built from the agent checkout." }
$outDir = Join-Path $root $Out
$stage = Join-Path $outDir "stage"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null

Write-Host "== Python $Python (standalone)"
uv python install $Python
$pyExe = (uv python find $Python --managed-python).Trim()
$pyHome = Split-Path -Parent $pyExe
Copy-Item $pyHome (Join-Path $stage "python") -Recurse
$stagePy = Join-Path $stage "python\python.exe"

Write-Host "== Packages"
$req = Join-Path $outDir "requirements.txt"
Push-Location $agent
# The same extras the desktop dev environment uses, without dev tools or the agent itself.
uv export --frozen --no-dev --no-hashes --no-emit-project --all-extras --no-extra kittentts --no-extra daytona -o $req
Pop-Location
uv pip install --python $stagePy --break-system-packages -r $req

Write-Host "== Agent source"
$skip = @(".venv", ".git", "node_modules", "tests", "apps", "web", "ui-tui", "evals", "website", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", "dist", "build")
robocopy $agent (Join-Path $stage "agent") /E /NFL /NDL /NJH /NJS /XD @skip | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copying agent/ failed (robocopy $LASTEXITCODE)" }
$global:LASTEXITCODE = 0

@{ version = $Version; python = $Python; built_at = (Get-Date).ToUniversalTime().ToString("o") } |
  ConvertTo-Json | Out-File (Join-Path $stage "engine.json") -Encoding ascii

Write-Host "== Smoke test: the engine must refuse a launch without the app's secret"
$probe = Start-Process -FilePath (Join-Path $stage "python\python.exe") -ArgumentList "-m", "tui_gateway.entry" `
  -WorkingDirectory (Join-Path $stage "agent") -NoNewWindow -PassThru -Wait `
  -RedirectStandardError (Join-Path $outDir "probe-err.txt") -RedirectStandardOutput (Join-Path $outDir "probe-out.txt")
if ($probe.ExitCode -ne 64) { throw "engine smoke test failed (exit $($probe.ExitCode)); see probe-err.txt" }

Write-Host "== Archive"
$zip = Join-Path $outDir "filey-engine-windows-x64.zip"
Remove-Item $zip, "$zip.sig" -ErrorAction SilentlyContinue
tar -a -c -f $zip -C $stage python agent engine.json
if ($LASTEXITCODE -ne 0) { throw "archiving failed" }

if ($env:TAURI_SIGNING_PRIVATE_KEY) {
  Write-Host "== Sign"
  npx --yes @tauri-apps/cli@2 signer sign $zip
  if (-not (Test-Path "$zip.sig")) { throw "signing did not produce $zip.sig" }
} else {
  Write-Warning "TAURI_SIGNING_PRIVATE_KEY is not set: the archive is unsigned and the app will refuse it."
}
Write-Host "Engine $Version -> $zip"
