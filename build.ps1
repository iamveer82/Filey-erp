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

# Set signing key for auto-updater
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "C:\Users\iamvi\Documents\GitHub\Filey-erp\src-tauri\filey-key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY = $env:TAURI_SIGNING_PRIVATE_KEY.Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""

Set-Location "C:\Users\iamvi\Documents\GitHub\Filey-erp"

# Build the WhatsApp sidecar into the externalBin slot (bun -> single exe).
# The sidecar lives OUTSIDE the app bundle's node deps; rebuild it here so a
# fresh clone can produce the binary Tauri's externalBin expects.
Set-Location "C:\Users\iamvi\Documents\GitHub\Filey-erp\tools\wa-bridge"
if (-not (Test-Path node_modules)) { npm install }
bun build --compile --target=bun-windows-x64 index.mjs --outfile "C:\Users\iamvi\Documents\GitHub\Filey-erp\src-tauri\binaries\filey-wa-bridge-x86_64-pc-windows-msvc.exe"
Set-Location "C:\Users\iamvi\Documents\GitHub\Filey-erp"

npm run tauri build