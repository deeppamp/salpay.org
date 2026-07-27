# First live mint: `deeppamp.sal` (private test before public launch)

Do this **after** mainnet API is deployed and **before** making the repo public.

## 0. Deploy gates (must all be true)

On the VPS env:

```bash
SALPAY_NETWORK=mainnet
MAINNET_STRICT_GUARDS=true
MINT_PAYMENT_VERIFICATION_MODE=chain_proof
PAYMENT_MODE=client_wallet
TURNSTILE_ENFORCE=true
TURNSTILE_SECRET=...          # real
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...  # real, frontend build
CORS_ALLOW_ORIGIN=https://sal.cash
MINT_TREASURY_ADDRESS_MAINNET=SC11aKyaf...
MINT_BURN_PERCENT=50
MINT_USER_SPLIT_PAYMENT=false
TREASURY_VIEW_RPC_URL=http://127.0.0.1:29089/json_rpc
OPS_API_KEY=...               # long random; same on your burn PC
NAMES_DB_PATH=/var/lib/salpay/minted-names.json   # start as []
AUTHORITATIVE_NAME_CHECK_URL=self
AUTHORITATIVE_TICKER_CHECK_URL=self
```

Server must **refuse to start** if chain_proof / Turnstile / CORS / view RPC / OPS key missing (strict mode).

## 1. Health checks

```bash
curl -s https://sal.cash/healthz
curl -s https://sal.cash/api/treasury-view-status
curl -s https://sal.cash/turnstile-config
# expect: payment_verification_mode=chain_proof, mint_user_payment_mode=full_treasury
```

## 2. Create a new mainnet wallet (this PC)

- New wallet, mainnet, note primary **SC...** address  
- Fund with enough SAL1 for fee (~$20-$50 in SAL1) + network fee  

## 3. Mint `deeppamp.sal`

### Option A -- Website (recommended first)

1. Open https://sal.cash  
2. Mint wizard: `deeppamp.sal`, pick free ticker chip, paste primary SC...  
3. Complete Turnstile  
4. Reserve -> transfer **full fee** to treasury from your wallet  
5. Paste **one** payment tx hash -> verify -> execute  

### Option B -- Your forked GUI

1. Mainnet wallet, SalPay API base = `https://sal.cash`  
2. SalPay tab -> same name/ticker -> Pay From Wallet (single transfer)  

## 4. Confirm

```bash
curl -s https://sal.cash/api/resolve/deeppamp.sal
curl -s https://sal.cash/api/mint/burn-proof/deeppamp.sal
# operator_burn.status should be "pending" until you burn
```

## 5. Operator burn (treasury spend wallet -- private)

```powershell
$env:SALPAY_API_BASE = 'https://sal.cash'
$env:OPS_API_KEY = '...'
powershell -File salpay/scripts/ops-burn-queue.ps1
# In CLI: burn <amount_sal> SAL1
# Then POST burn-complete with name=deeppamp.sal and burn_tx_hash
```

## 6. Only after this works

- Commit is already on private remote  
- Make git **public** only after scrubbing secrets (no .env, no keys, no OPS key)  
- Then invite others / publish wallet builds  

## Anti-scam reminders

| Attack | Blocked by |
|--------|------------|
| Fake tx hash | `chain_proof` + treasury view-rpc |
| Reuse one payment for two names | payment tx hash uniqueness |
| Remint same name | minted DB + execute gate |
| Taken ticker | registry + execute re-check |
| Skip payment | execute requires verified status |
| Free `/register` mint | register does **not** activate name |
| Fake burn complete | `OPS_API_KEY` |
| Open CORS + browser abuse | mainnet refuses `CORS=*` |
| Spam reserve | Turnstile + rate limits |
