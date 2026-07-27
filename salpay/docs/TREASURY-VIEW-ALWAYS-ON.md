# Always-on treasury view wallet (chain_proof)

Mint verification uses a **view-only** treasury wallet-rpc so SalPay can see user payments without putting a spend key on the public server.

If this process is down or not scanning **SAL1**, users pay successfully but get `tx_not_found` -- name never activates and it looks like "funds are stuck" (they are not: fee is at treasury; leftover balance is **change**).

## Recommended architecture (easiest long-term)

| Component | Where | Always on? |
|-----------|--------|------------|
| `salviumd` (mainnet) | VPS **or** trusted seed | Yes |
| `salvium-wallet-rpc` treasury **view-only** | **Same machine as backend** (VPS) or always-on home PC with stable tunnel | Yes |
| SalPay backend Docker | VPS | Yes |
| Treasury **spend** wallet | Your private PC only | When you burn 50% / refund |

**Do not** rely on a laptop that sleeps. Prefer the **VPS** for view-rpc.

### VPS (best)

1. Create view-only wallet from treasury keys once (see `private/treasury-view/README.txt` / `create-treasury-view-rpc.ps1`).
2. On VPS host (not inside a throwaway container without volume):
   - Run `salvium-wallet-rpc` on `127.0.0.1:29089`
   - Open wallet, `refresh` until height  network tip
3. Backend env:
   ```bash
   TREASURY_VIEW_RPC_URL=http://127.0.0.1:29089/json_rpc
   # or Docker: http://host.docker.internal:29089/json_rpc
   TREASURY_PUBLIC_STATS=true
   MINT_TREASURY_ADDRESS_MAINNET=SC11aKyaf...   # spend/receive address
   ```
4. Process supervisor:
   - **Linux:** systemd unit for wallet-rpc + `Restart=always`
   - **Windows host:** Task Scheduler -> at logon + every 5 min -> `ensure-treasury-stack.ps1`
5. Health checks (cron or uptime monitor):
   - `GET https://sal.cash/api/treasury-view-status` -> `available: true`
   - `GET https://sal.cash/api/treasury` -> balance (not `SAL1 not found`)

### Home PC (temporary / dev)

Only if the VPS can reach it securely (Tailscale/WireGuard), or you run backend on that PC.

```bat
private\treasury-view\start-treasury-view-rpc.bat
powershell -File private\treasury-view\ensure-treasury-stack.ps1
```

Point `TREASURY_VIEW_RPC_URL` at that host. Prefer moving view-rpc to the VPS when stable.

## SAL1 asset requirement

Salvium is multi-asset. The view wallet must understand **SAL1** inflows:

- After open: `refresh`
- Probe: `get_transfers` / `get_transfer_by_txid` for a known payment
- If `/api/treasury` says `Source asset 'SAL1' not found`, recreate or upgrade the view wallet with a **current** `salvium-wallet-rpc` (1.1.3c+) and re-open

## User-facing recovery (idiot-proof)

When pay succeeds but verify fails:

1. Wallet keeps **payment tx hash**
2. User clicks **I already paid -- scan** or **Verify payment** (paste hash) -- **never pay twice**
3. If treasury view still cannot see the tx after sync:
   - Ops: `POST /api/ops/force-mint-complete` with `OPS_API_KEY` + payment_tx_hash  
     Script: `salpay/scripts/ops-force-mint-deeppamp.ps1`
   - Or refund from treasury **spend** wallet to the user

## Checklist after deploy

- [ ] wallet-rpc listening on 29089 after reboot  
- [ ] open_wallet succeeds without password prompt in automation  
- [ ] refresh height  tip  
- [ ] test mint on a throwaway name: pay -> verify  2 minutes  
- [ ] force-mint endpoint deployed for emergencies  
