$ErrorActionPreference = "Stop"
$agentRoot = $PSScriptRoot
$dataDirectory = Join-Path $agentRoot "data"
$config = Get-Content -LiteralPath (Join-Path $agentRoot "agent-config.json") -Raw | ConvertFrom-Json
$authPath = Join-Path $dataDirectory "panel-auth.json"
$connectionPath = Join-Path $dataDirectory "panel-connection.json"
$node = Join-Path $agentRoot "node.exe"

foreach ($required in @($node, (Join-Path $agentRoot "web-panel.js"), (Join-Path $agentRoot "public\index.html"))) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Missing server-agent file: $required"
  }
}

$listener = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  throw "Port 8787 is already in use. Stop the existing panel before starting this agent."
}

$env:PANEL_SERVER_ROOT = $config.serverRoot
$env:PANEL_RECLAIMER_EXE = $config.reclaimerExe
$env:PANEL_CONFIG = "dedicated.toml"
$env:PANEL_DATA_DIRECTORY = $dataDirectory
$env:PANEL_PORT = "8787"
Remove-Item Env:\PANEL_REMOTE_HOST -ErrorAction SilentlyContinue

if ((Test-Path -LiteralPath $authPath) -and (Test-Path -LiteralPath $connectionPath)) {
  $connection = Get-Content -LiteralPath $connectionPath -Raw | ConvertFrom-Json
  $passwordPath = Join-Path $dataDirectory "panel-tls-password.dpapi"
  $pfxPath = Join-Path $dataDirectory "panel-tls.pfx"
  if (-not (Test-Path -LiteralPath $passwordPath) -or -not (Test-Path -LiteralPath $pfxPath)) {
    throw "Remote TLS files are missing; run setup-remote.ps1 again after rotating the certificate."
  }
  $securePassword = ConvertTo-SecureString (Get-Content -LiteralPath $passwordPath -Raw)
  $env:PANEL_TLS_PFX_PASSWORD = [System.Net.NetworkCredential]::new("", $securePassword).Password
  $env:PANEL_TLS_PFX = $pfxPath
  $env:PANEL_REMOTE_HOST = $config.bindHost
  $env:PANEL_REMOTE_PORT = [string]$config.port
  $env:PANEL_PUBLIC_HOST = ([Uri]$connection.serverOrigin).Host
} else {
  Write-Output "First run: open http://127.0.0.1:8787 and create the admin password."
  Write-Output "Restart this script after setup to enable the pinned HTTPS listener."
}

$stdout = Join-Path $dataDirectory "panel-output.log"
$stderr = Join-Path $dataDirectory "panel-error.log"
$process = Start-Process `
  -FilePath $node `
  -ArgumentList @("web-panel.js") `
  -WorkingDirectory $agentRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru

Start-Sleep -Seconds 2
if ($process.HasExited) {
  throw "The server agent exited during startup. Inspect data\panel-error.log."
}
Write-Output "Server agent started (PID $($process.Id))."
