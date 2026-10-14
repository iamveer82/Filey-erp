# Filey Agent on this computer: the host (127.0.0.1:8787) plus its Cloudflare tunnel, so the
# Filey web and phone app can chat with it. Closing this window stops both.
#
# One-time setup (writes cloudflared.yml next to owners.txt):
#   cloudflared tunnel login
#   cloudflared tunnel create filey-agent
#   cloudflared tunnel route dns filey-agent agent.gofiley.com
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$hostHome = Join-Path $env:APPDATA "com.iamvi.filey-erp\filey-agent-host"
$python = Join-Path $repo "agent\.venv\Scripts\python.exe"
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
$cloudflared = if ($cloudflared) { $cloudflared.Source } else { "C:\Program Files (x86)\cloudflared\cloudflared.exe" }
$config = Join-Path $hostHome "cloudflared.yml"
if (-not (Test-Path $config)) { throw "Tunnel not set up yet: $config is missing (see the setup steps at the top of this script)." }

$agentHost = Start-Process -FilePath $python -ArgumentList "`"$PSScriptRoot\host.py`"" -NoNewWindow -PassThru
try {
  & $cloudflared tunnel --config $config run
} finally {
  if (-not $agentHost.HasExited) { Stop-Process -Id $agentHost.Id }
}
