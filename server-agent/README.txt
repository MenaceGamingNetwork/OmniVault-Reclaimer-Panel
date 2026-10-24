OmniVault Reclaimer Control - self-hosted server agent

Install-Agent.ps1 installs the agent next to a Reclaimer server:

  .\Install-Agent.ps1 -ReclaimerRoot "C:\path\to\Halo Server"

For remote access, use a DNS hostname or public IP that points to this host:

  .\Install-Agent.ps1 -ReclaimerRoot "C:\path\to\Halo Server" -PublicHost "halo.example.com"

The first run listens only on localhost. Open http://127.0.0.1:8787 on the server host and create the admin password. Then rerun Start-Agent.ps1 to enable HTTPS.

Add the HTTPS address and SHA-256 fingerprint printed during setup to the desktop app. For access from another network, configure the host/provider firewall to allow TCP 8788. The agent does not open firewall ports automatically.

Each owner runs their own agent and keeps their own password. Never share an agent password or certificate private key.
