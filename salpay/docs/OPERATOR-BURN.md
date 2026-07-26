# Operator burn after mint (100% user → treasury)

## Policy

1. **User** pays the **full** mint fee in one SAL1 transfer to the mint treasury.  
   Any wallet works (GUI, CLI, webwallet) — no user-side protocol burn.

2. **Operator** (you, on a private machine with treasury **spend** keys) burns  
   `MINT_BURN_PERCENT` (default **50%**) of each mint fee via Salvium protocol burn.

3. **Proof** is stored on the mint record and is public:
   - `GET /api/mint/burn-proof/:name`
   - `GET /api/burns`

## Flow

```text
User:  transfer fee → treasury  →  verify-payment  →  execute (name live)
Ops:   poll burn-queue  →  burn amount SAL1  →  burn-complete (attach tx hash)
Public: burn-proof shows payment_tx + burn_tx
```

## Env

```bash
MINT_BURN_PERCENT=50
MINT_BURN_KIND=protocol
MINT_USER_SPLIT_PAYMENT=false   # default; do not set true on production
OPS_API_KEY=<long random secret>
```

## Ops API (private key)

Header: `X-Ops-Key: <OPS_API_KEY>`  
or `Authorization: Bearer <OPS_API_KEY>`

### List pending burns

```http
GET /api/ops/burn-queue?status=pending
```

Each item includes `operator_burn.amount_sal` and `suggested_cli` like:

```text
burn 10 SAL1
```

### Record burn proof

```http
POST /api/ops/burn-complete
Content-Type: application/json
X-Ops-Key: …

{
  "name": "alice.sal",
  "burn_tx_hash": "<txid from burn command>"
}
```

## Other computer (manual or scripted)

1. Keep a **spend-capable** treasury wallet **offline / private** (not on the public API server).  
2. Periodically (or via script):

```powershell
$base = "https://salpay.org"   # or http://127.0.0.1:3001
$key  = $env:OPS_API_KEY
$q = Invoke-RestMethod "$base/api/ops/burn-queue?status=pending" -Headers @{ "X-Ops-Key" = $key }
foreach ($item in $q.items) {
  Write-Host "Burn $($item.operator_burn.amount_sal) SAL1 for $($item.name)"
  Write-Host "  CLI: $($item.suggested_cli)"
  Write-Host "  After burn, POST burn-complete with the txid"
}
```

3. In Salvium wallet CLI (treasury spend wallet, mainnet):

```text
burn <amount> SAL1
```

4. Submit the burn txid:

```powershell
Invoke-RestMethod "$base/api/ops/burn-complete" -Method Post -Headers @{
  "X-Ops-Key" = $key
  "Content-Type" = "application/json"
} -Body (@{ name = "alice.sal"; burn_tx_hash = "<txid>" } | ConvertTo-Json)
```

Example worker script: `salpay/scripts/ops-burn-queue.ps1`

## Automation sketch

On the private machine (cron / Task Scheduler):

1. `GET burn-queue?status=pending`  
2. For each item, run wallet-rpc / CLI `burn` of `amount_sal`  
3. `POST burn-complete` with the tx hash  
4. Optional: notify yourself if queue age > N hours  

**Never** put the treasury spend key on the public VPS. View-only stays on the server for `chain_proof` + public balance.

## Public transparency

```http
GET /api/mint/burn-proof/alice.sal
GET /api/burns?limit=50
```

Shows fee paid (treasury tx) and operator burn status/hash.

## Legacy

`MINT_USER_SPLIT_PAYMENT=true` restores the old dual-leg user payment (treasury half + user protocol burn). Do not use for production any-wallet minting.
