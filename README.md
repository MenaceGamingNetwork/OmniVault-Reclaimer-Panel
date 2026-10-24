# OmniVault Reclaimer Panel

Windows desktop control client for self-hosted Project Reclaimer (Halo) servers.

## For server owners (one-time setup)

1. Install the server agent on the Halo server PC:
   ```powershell
   cd "C:\path\to\Halo Server\discord-bot\server-agent"
   .\Install-Agent.ps1 -ReclaimerRoot "C:\path\to\Halo Server"
   ```
   For remote access, add `-PublicHost "your.domain.or.public.ip"`.

2. Start the agent:
   ```powershell
   .\Start-Agent.ps1
   ```

3. On that PC, open `http://127.0.0.1:8787` and create the admin password.

4. Re-run `Start-Agent.ps1` to enable HTTPS. It prints:
   - **HTTPS address** (e.g. `https://server.example:8788`)
   - **SHA-256 certificate fingerprint** (64 hex characters)

5. Open TCP port **8788** in your firewall for remote access.

Share the HTTPS address + fingerprint + admin password with anyone who should manage the server.

## For panel users

1. Download the latest `.exe` from the GitHub Releases page (Assets section).
2. Run the installer — it creates a desktop shortcut.
3. Open the app, click **Add a server**, and paste the HTTPS address + fingerprint.
4. Sign in with the admin password.

## Auto-updates

The app checks for updates on startup and via **Servers → Check for updates**. New versions install automatically when the app closes.