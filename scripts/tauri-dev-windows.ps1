# Windows desktop dev build.
# A normal shell has no Visual Studio environment, so link.exe cannot see
# kernel32.lib (LNK1181) and cannot run mt.exe (LNK1158). Load the x64
# developer environment first, then start the Tauri dev app.
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
    throw "Visual Studio installer was not found at $vswhere"
}
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) {
    throw 'MSVC x64 build tools are not installed. Install the Desktop development with C++ workload.'
}
$devCmd = Join-Path $vs 'Common7\Tools\VsDevCmd.bat'
if (-not (Test-Path -LiteralPath $devCmd)) {
    throw "VsDevCmd.bat is missing at $devCmd"
}

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $env:ComSpec
$startInfo.Arguments = "/d /s /c `"`"$devCmd`" -no_logo -arch=x64 -host_arch=x64 >nul && set`""
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardOutput = $true
$process = [System.Diagnostics.Process]::Start($startInfo)
try {
    $lines = $process.StandardOutput.ReadToEnd() -split "`r?`n"
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Could not initialize the Visual Studio developer environment (exit $($process.ExitCode))" }
} finally {
    $process.Dispose()
}
foreach ($line in $lines) {
    if ($line -match '^([^=]+)=(.*)$') {
        Set-Item -LiteralPath "env:$($matches[1])" -Value $matches[2]
    }
}

# The MSVC linker is pinned below. Leave Git Bash on PATH: the Filey agent
# uses it to search the owner's Desktop, Documents, and Downloads.

$tools = $env:VCToolsInstallDir.TrimEnd('\')
$linker = @(
    (Join-Path $tools 'bin\Hostx64\x64\link.exe'),
    (Join-Path $tools 'bin\Hostx86\x64\link.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $linker) {
    throw "MSVC link.exe is missing from VCToolsInstallDir '$env:VCToolsInstallDir'"
}

# The installed WebView2 runtime reports a version, but msedgewebview2.exe
# is missing from that folder, so window creation fails with "file not found".
# Rebuild a private runtime folder from the installed files and Edge's browser
# launcher, which is the same stub that loads msedge.dll.
function Ensure-FileyWebView2 {
    $regPath = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    $info = Get-ItemProperty -LiteralPath $regPath -ErrorAction Stop
    $version = $info.pv
    $runtimeRoot = if ($info.location) { $info.location } else { 'C:\Program Files (x86)\Microsoft\EdgeWebView\Application' }
    $src = Join-Path $runtimeRoot $version
    $official = Join-Path $src 'msedgewebview2.exe'
    if (Test-Path -LiteralPath $official) { return $null }
    $fixed = Join-Path $env:LOCALAPPDATA "Filey\WebView2\$version"
    $browser = Join-Path $fixed 'msedgewebview2.exe'
    if (Test-Path -LiteralPath $browser) { return $fixed }
    $edgeExe = "C:\Program Files (x86)\Microsoft\Edge\Application\$version\msedge.exe"
    if (-not (Test-Path -LiteralPath $src)) { throw "WebView2 runtime folder is missing: $src" }
    if (-not (Test-Path -LiteralPath $edgeExe)) { throw "Microsoft Edge launcher is missing: $edgeExe" }
    New-Item -ItemType Directory -Force -Path $fixed | Out-Null
    & robocopy $src $fixed /E /NFL /NDL /NJH /NJS /MT:8 /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Could not copy the WebView2 runtime (robocopy $LASTEXITCODE)" }
    Copy-Item -LiteralPath $edgeExe -Destination $browser -Force
    $edgeCopy = Join-Path $fixed 'msedge.exe'
    if (-not (Test-Path -LiteralPath $edgeCopy)) {
        Copy-Item -LiteralPath $edgeExe -Destination $edgeCopy -Force
    }
    return $fixed
}
$webviewRuntime = Ensure-FileyWebView2
if ($webviewRuntime) { $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = $webviewRuntime }
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = $linker
if (-not (Get-Command mt.exe -ErrorAction SilentlyContinue)) {
    throw 'mt.exe is not on PATH after loading the Windows SDK. The desktop app cannot embed its manifest.'
}
if (-not $env:LIB -or $env:LIB -notmatch 'um\\x64') {
    throw 'LIB does not include the Windows SDK um\x64 directory, so kernel32.lib cannot be linked.'
}

Set-Location -LiteralPath $root

# WhatsApp in dev builds: the bridge sidecar needs its native media folder (wa-media)
# beside it. Release CI builds both; a fresh checkout has neither, and without the
# folder the bridge refuses to start, so dev builds could never connect WhatsApp.
$bridgeDir = Join-Path $root 'src-tauri\binaries'
if (-not (Test-Path -LiteralPath (Join-Path $bridgeDir 'wa-media'))) {
    Write-Host 'Building the WhatsApp bridge for dev builds (first run only)...'
    Push-Location -LiteralPath (Join-Path $root 'tools\wa-bridge')
    try {
        if (-not (Test-Path -LiteralPath 'node_modules\libsignal')) {
            # Baileys pins libsignal to an exact GitHub commit in the lockfile; npm 12
            # refuses git dependencies unless allowed for this install.
            npm ci --no-audit --no-fund --allow-git=all
            if ($LASTEXITCODE -ne 0) { throw 'npm ci failed for the WhatsApp bridge' }
        }
        bun build-sidecar.mjs --outfile (Join-Path $bridgeDir 'filey-wa-bridge-x86_64-pc-windows-msvc.exe')
        if ($LASTEXITCODE -ne 0) { throw 'bun could not build the WhatsApp bridge' }
    } catch {
        Write-Warning "WhatsApp will not connect in this dev build: $($_.Exception.Message)"
    } finally {
        Pop-Location
    }
}

npm run tauri dev
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
