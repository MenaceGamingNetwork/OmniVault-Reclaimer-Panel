param(
  [Parameter(Mandatory = $true)]
  [string]$ReclaimerRoot,
  [string]$PublicHost = "localhost",
  [int]$Port = 8788
)

$ErrorActionPreference = "Stop"
$serverRoot = (Resolve-Path -LiteralPath $ReclaimerRoot).Path
$playlistConfig = Join-Path $serverRoot "dedicated.toml"
$reclaimerExe = Get-ChildItem -LiteralPath $serverRoot -File -Filter "project-reclaimer-dedicated-*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not (Test-Path -LiteralPath $playlistConfig)) {
  throw "No dedicated.toml was found under ReclaimerRoot."
}
if (-not $reclaimerExe) {
  throw "No project-reclaimer-dedicated executable was found under ReclaimerRoot."
}

$agentRoot = Join-Path $serverRoot "OmniVaultControlAgent"
$dataDirectory = Join-Path $agentRoot "data"
New-Item -ItemType Directory -Path $agentRoot -Force | Out-Null
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null

foreach ($file in @("node.exe", "web-panel.js", "start-agent.ps1", "setup-remote.ps1", "README.txt")) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $agentRoot $file) -Force
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "public") -Destination $agentRoot -Recurse -Force

$configPath = Join-Path $agentRoot "agent-config.json"
$config = @{
  serverRoot = $serverRoot
  reclaimerExe = $reclaimerExe.FullName
  port = $Port
  publicHost = $PublicHost
  bindHost = if ($PublicHost -eq "localhost") { "127.0.0.1" } else { $PublicHost }
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 4) + "`n", $utf8NoBom)

& (Join-Path $agentRoot "setup-remote.ps1") -PublicHost $PublicHost -Port $Port
& (Join-Path $agentRoot "start-agent.ps1")
