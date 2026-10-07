$ErrorActionPreference = "Stop"
$taskProjectDir = $PSScriptRoot
$vcvars = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
$cmd = "`"$vcvars`" && set"
$output = cmd /c $cmd 2>&1
foreach ($line in $output) {
    if ($line -match "^([^=]+)=(.*)$") {
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}
$clPath = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx86\x64"
$env:PATH = "$clPath;$env:PATH"
$env:PATH = ($env:PATH -split ';' | Where-Object {
    $_ -and $_ -notmatch 'usr\\bin' -and $_ -notmatch 'msys' -and $_ -notmatch 'git\\usr' -and $_ -notmatch 'Git\\mingw'
}) -join ';'

# Build native media alongside the sidecar; Bun cannot embed sharp's addon.
Set-Location (Join-Path $taskProjectDir "tools/wa-bridge")
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "WhatsApp dependencies could not be installed." }
$taskSidecar = Join-Path $taskProjectDir "src-tauri/binaries/filey-wa-bridge-x86_64-pc-windows-msvc.exe"
bun build-sidecar.mjs --target bun-windows-x64 --outfile $taskSidecar
if ($LASTEXITCODE -ne 0) { throw "WhatsApp sidecar could not be built." }
& $taskSidecar --check-media --media-dir (Join-Path $taskProjectDir "src-tauri/binaries/wa-media")
if ($LASTEXITCODE -ne 0) { throw "WhatsApp native media check failed." }
Set-Location $taskProjectDir

# Use this checkout's existing signing key; never silently build another repo.
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content (Join-Path $taskProjectDir "src-tauri/filey-key") -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""

npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "Desktop build failed." }
