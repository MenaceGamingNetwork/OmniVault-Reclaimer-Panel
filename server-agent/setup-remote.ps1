param(
  [string]$PublicHost = "localhost",
  [int]$Port = 8788
)

$ErrorActionPreference = "Stop"
$agentRoot = $PSScriptRoot
$dataDirectory = Join-Path $agentRoot "data"
$configPath = Join-Path $agentRoot "agent-config.json"
$pfxPath = Join-Path $dataDirectory "panel-tls.pfx"
$passwordPath = Join-Path $dataDirectory "panel-tls-password.dpapi"
$connectionInfoPath = Join-Path $dataDirectory "panel-connection.json"

if (Test-Path -LiteralPath $pfxPath) {
  throw "A server certificate already exists; refusing to replace it automatically."
}
if ($Port -lt 1024 -or $Port -gt 65535) {
  throw "Port must be between 1024 and 65535."
}

$hostType = [Uri]::CheckHostName($PublicHost)
if ($hostType -notin @([UriHostNameType]::IPv4, [UriHostNameType]::Dns)) {
  throw "PublicHost must be a DNS hostname or IPv4 address."
}

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$config.publicHost = $PublicHost
$config.bindHost = if ($PublicHost -eq "localhost") { "127.0.0.1" } else { $PublicHost }
$config.port = $Port

$certificateOptions = @{
  Subject = "CN=$PublicHost"
  CertStoreLocation = "Cert:\CurrentUser\My"
  KeyAlgorithm = "RSA"
  KeyLength = 3072
  HashAlgorithm = "SHA256"
  KeyExportPolicy = "Exportable"
  KeyUsage = @("DigitalSignature", "KeyEncipherment")
  NotAfter = (Get-Date).AddYears(3)
}
if ($hostType -eq [UriHostNameType]::IPv4) {
  $certificateOptions.TextExtension = @("2.5.29.17={text}IPAddress=$PublicHost")
} else {
  $certificateOptions.DnsName = $PublicHost
}
$cert = New-SelfSignedCertificate @certificateOptions

$random = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($random)
$pfxPasswordText = [Convert]::ToBase64String($random)
$pfxPassword = ConvertTo-SecureString -String $pfxPasswordText -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pfxPassword | Out-Null
ConvertFrom-SecureString -SecureString $pfxPassword | Set-Content -LiteralPath $passwordPath -NoNewline

$sha256 = [Security.Cryptography.SHA256]::Create()
$fingerprint = [BitConverter]::ToString($sha256.ComputeHash($cert.RawData)).Replace("-", "").ToLowerInvariant()
$connectionInfo = @{
  serverOrigin = "https://${PublicHost}:${Port}"
  certificateFingerprint = $fingerprint
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 4) + "`n", $utf8NoBom)
[IO.File]::WriteAllText($connectionInfoPath, ($connectionInfo | ConvertTo-Json -Depth 4) + "`n", $utf8NoBom)

Write-Output "HTTPS pairing address: $($connectionInfo.serverOrigin)"
Write-Output "SHA-256 certificate fingerprint: $fingerprint"
