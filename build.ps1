# Use vcvarsall with Hostx86 path since Hostx64/cl.exe is missing
$vcvars = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

# Run vcvars64 and capture env
$cmd = "`"$vcvars`" && set"
$output = cmd /c $cmd 2>&1
foreach ($line in $output) {
    if ($line -match "^([^=]+)=(.*)$") {
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
}

# Add the Hostx86/x64 path where cl.exe actually exists
$clPath = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx86\x64"
$env:PATH = "$clPath;$env:PATH"

# Remove MSYS/Git paths
$env:PATH = ($env:PATH -split ';' | Where-Object { 
    $_ -and 
    $_ -notmatch 'usr\\bin' -and 
    $_ -notmatch 'msys' -and 
    $_ -notmatch 'git\\usr' -and
    $_ -notmatch 'Git\\mingw'
}) -join ';'

# Verify cl.exe is accessible
$clTest = Get-Command cl.exe -ErrorAction SilentlyContinue
if ($clTest) {
    Write-Output "cl.exe found at: $($clTest.Source)"
} else {
    Write-Output "WARNING: cl.exe not found in PATH"
}

Set-Location "C:\Users\iamvi\Documents\GitHub\Filey-erp"
npm run tauri build