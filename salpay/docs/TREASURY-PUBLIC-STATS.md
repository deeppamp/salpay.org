# Public mint treasury balance (website + GUI)

Salvium cannot look up an arbitrary `SC...` balance from the daemon alone.  
To show **mint treasury** funds on sal.cash, the API uses a **view-only** wallet-rpc that watches the treasury.

## Production intent

- Always-on **mainnet** `salviumd`
- Always-on **view-only** treasury wallet-rpc (`TREASURY_VIEW_RPC_URL`)
- Website `GET /api/treasury` -> mint card "Mint treasury"
- Same RPC also powers **chain_proof** payment verification

**Never** put the full-spend treasury keys on the public API server.

## Env

```bash
TREASURY_VIEW_RPC_URL=http://127.0.0.1:29089/json_rpc
TREASURY_PUBLIC_STATS=true
TREASURY_STATS_CACHE_MS=30000
MINT_TREASURY_ADDRESS_MAINNET=SC11aKyaf...   # public label + recognition check
```

## Local / host scripts (outside git)

```text
<PRIVATE_TREASURY_VIEW_DIR>\
  start-mainnet-daemon.bat
  start-treasury-view-rpc.bat
  ensure-treasury-stack.ps1   # re-check / restart both
```

On the sal.cash VPS, mirror that pattern under `/var/lib/salpay/treasury-view/` and run `ensure-treasury-stack` from cron or systemd.

## Endpoints

| Path | Purpose |
|------|---------|
| `GET /api/treasury` | Public balance (cached) |
| `GET /api/treasury-view-status` | Ops: recognized address, height |

## Windows "always up"

Task Scheduler (recommended on a Windows host):

1. Trigger: **At log on** and/or every 5 minutes  
2. Action:  
   `powershell -NoProfile -ExecutionPolicy Bypass -File <PRIVATE_TREASURY_VIEW_DIR>\ensure-treasury-stack.ps1`

## Linux VPS (sketch)

```ini
# /etc/systemd/system/salpay-treasury-view.service
[Service]
ExecStart=/usr/local/bin/salvium-wallet-rpc --wallet-dir /var/lib/salpay/treasury-view \
  --rpc-bind-ip 127.0.0.1 --rpc-bind-port 29089 \
  --daemon-address 127.0.0.1:18081 --trusted-daemon --disable-rpc-login
Restart=always
```

Open the wallet once after start (`open_wallet`), or use a wrapper script like `start-treasury-view-rpc.bat`.

## Security

| Do | Don't |
|----|--------|
| View-only keys only | Spend key on the web server |
| Localhost RPC bind | Expose wallet-rpc to the internet |
| Cache `/api/treasury` | Hit RPC on every uncached page view without limit |
