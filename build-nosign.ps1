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

# No signing key on purpose: produces installers without .sig/latest.json (no hang).
Set-Location "C:\Users\iamvi\Documents\GitHub\Filey-erp"
npm run tauri build
