# VPS always-on stack (treasury view + Docker + boot)

Goal: after any reboot, mint/chain_proof comes back without manual steps.

**Privacy:** Never commit real SSH users, server IPs, or Windows account paths. Use environment variables and placeholders (`deploy@YOUR_SERVER_IP`, `$HOME/...`).

## Components

| Unit | Purpose |
|------|---------|
| `salpay-treasury-view.service` | View-only `salvium-wallet-rpc` on `127.0.0.1:29089` |
| `salpay-docker-stack.service` | `docker compose up` for backend/frontend/nginx |
| `salpay-all.target` | Boots both (optional) |

Backend reaches the view wallet via:

```bash
TREASURY_VIEW_RPC_URL=http://host.docker.internal:29089/json_rpc
```

(`extra_hosts: host.docker.internal:host-gateway` is in `deploy/docker-compose.server.yml`.)

## One-time install

### A) From an admin Windows machine (SSH)

```powershell
$env:SALPAY_SSH = "deploy@YOUR_SERVER_IP"
$env:SALPAY_SSH_KEY = "$env:USERPROFILE\.ssh\id_ed25519"   # your private key path
$env:SALPAY_LOCAL_TREASURY_DIR = "D:\path\to\private\treasury-view"  # outside git
cd path\to\salpay.org\salpay\deploy\treasury-view
.\install-from-windows.ps1
```

This uploads view-only keys and runs `install-treasury-view-vps.sh`.

### B) Hosting provider web console (no SSH key yet)

1. Upload keys + script (SCP from a machine that has access).
2. As root:

```bash
# After keys are at /var/lib/salpay/treasury-view/treasury-view-mainnet.keys
# and salvium-wallet-rpc is at /opt/salvium/salvium-wallet-rpc
sudo bash /tmp/install-treasury-view-vps.sh
```

### Linux binary

Copy **Linux** `salvium-wallet-rpc` matching mainnet GUI to:

```text
/opt/salvium/salvium-wallet-rpc
```

## Verify

```bash
sudo systemctl status salpay-treasury-view
curl -s http://127.0.0.1:29089/json_rpc -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"get_height"}'
curl -s https://sal.cash/api/treasury-view-status
curl -s https://sal.cash/api/treasury
```

## Reboot test

```bash
sudo reboot
# after boot:
sudo systemctl is-active salpay-treasury-view salpay-docker-stack
curl -s https://sal.cash/healthz
```

## Backup to a private admin machine

On VPS:

```bash
sudo bash /path/to/salpay.org/salpay/scripts/server/backup-server-bundle.sh
```

On admin PC:

```powershell
$env:SALPAY_SSH = "deploy@YOUR_SERVER_IP"
$env:SALPAY_BACKUP_DIR = "D:\backups\salpay-server-mirrors"  # outside git
.\pull-server-backup.ps1
```

Includes: `.env.server`, deploy config, minted-names DB, **view** keys, systemd units.  
**Never** put treasury **spend** keys on the VPS or in a public bundle.

## SSH key setup (generic)

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_ed25519_salpay -N '""'
Get-Content $env:USERPROFILE\.ssh\id_ed25519_salpay.pub
# Add the public line to the server account's ~/.ssh/authorized_keys (hosting console)
```
