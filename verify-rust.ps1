# Compile-verify the Rust side on this machine.
#
#   .\verify-rust.ps1          cargo check
#   .\verify-rust.ps1 all      check + clippy + test
#
# Two things on this box get in the way, and both are silent:
#
#   1. Git's usr/bin sits ahead of MSVC on PATH and its link.exe shadows the
#      real one, so a plain cargo build fails to link.
#   2. "Rust stable MSVC 1.93" is a standalone install carrying rustdoc,
#      rustfmt, clippy-driver and rust-analyzer but NO rustc or cargo. It sits
#      ahead of ~/.cargo/bin, so cargo is 1.96 while rustdoc is 1.93 and every
#      doc-test dies with "found crate X compiled by an incompatible version of
#      rustc". Uninstalling it is the real fix; until then, drop it here.
#
# Host toolchain note: x86_amd64, not amd64. The Hostx64\x64 folder is missing
# cl.exe, lib.exe and link.exe (antivirus took them; the .config files next to
# them survived). Hostx86\x64 is a 32-bit compiler emitting the same x64 code,
# and vcvarsall picks it up under this argument without hardcoding an MSVC
# version number.
param([ValidateSet("check", "all")] [string]$Mode = "check")

# Deliberately NOT ErrorActionPreference=Stop: cargo writes its progress to
# stderr, and PowerShell 5.1 turns a native command's stderr into a terminating
# error even when it exited 0. Failures are caught on $LASTEXITCODE instead.
$vcvarsall = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat"
if (-not (Test-Path $vcvarsall)) {
    throw "vcvarsall.bat not found at $vcvarsall - is VS 2022 Build Tools installed?"
}

# Import the toolchain's environment (INCLUDE, LIB, PATH) into this process.
# vcvarsall's own banner goes to nul: it shells out to vswhere, and PowerShell
# turns a native command's stderr into terminating errors under -ErrorAction
# Stop even when the command succeeded. Only `set` output should come back.
# The 2>&1 belongs to cmd, not PowerShell — it never reaches PowerShell's own
# redirection, which is what turns native stderr into errors. vcvarsall shells
# out to vswhere, which is missing here and complains loudly while vcvarsall
# carries on and succeeds regardless.
foreach ($line in (cmd /c "`"$vcvarsall`" x86_amd64 >nul 2>&1 && set")) {
    if ($line -match "^([^=]+)=(.*)$") {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}

# rustup's shims must win over the standalone 1.93 install, and Git's link.exe
# must not win over MSVC's.
$env:PATH = (@("$env:USERPROFILE\.cargo\bin") + (
    $env:PATH -split ';' | Where-Object {
        $_ -and
        $_ -notmatch 'usr\\bin' -and $_ -notmatch 'msys' -and
        $_ -notmatch 'git\\usr' -and $_ -notmatch 'Git\\mingw' -and
        $_ -notmatch 'Rust stable MSVC'
    }
)) -join ';'

Write-Host "cargo  : $(cargo --version)"
Write-Host "rustc  : $(rustc --version)"
Write-Host "rustdoc: $(rustdoc --version)"
Write-Host ""

Set-Location (Join-Path $PSScriptRoot "src-tauri")

cargo check --message-format=short
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($Mode -eq "all") {
    cargo clippy --all-targets --message-format=short
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    cargo test --message-format=short
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "`nRust OK ($Mode)."
