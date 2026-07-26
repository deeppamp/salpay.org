# SalPay mainnet VPS — minimal upkeep install

Goal: run salpay.org with the **least** long-term babysitting.

- **No** full local mainnet `salviumd` required  
- **Yes** thin **view-only** treasury wallet-rpc → **remote** mainnet node  
- **Yes** API + website + empty durable names DB  
- Users mint/send from **their** wallets (`client_wallet`)

---

## Architecture

```text
Users / wallets  ──HTTP──►  salpay.org API + website
                              │
                              ├─ minted-names.json (durable volume)
                              ├─ TREASURY_VIEW_RPC_URL ──► view-only wallet-rpc (localhost)
                              │                              │
                              │                              └── remote mainnet node
                              │                                  (e.g. public RPC)
                              └─ Turnstile (Cloudflare)
```

---

## 1. Server pieces to install

| Service | Bind | Notes |
|---------|------|--------|
| Backend (`salpay/backend`) | `:3001` or unix socket behind nginx | `SALPAY_NETWORK=mainnet` |
| Frontend (Next static/SSR) | `:3000` or build → nginx | `NEXT_PUBLIC_API_BASE_URL=https://salpay.org` |
| Treasury view-rpc | `127.0.0.1:29089` only | View-only keys; never public |
| nginx + TLS | `443` | Cloudflare origin cert OK |

Optional later: own `salviumd`. Not required if remote RPC is reliable.

---

## 2. Environment (copy from `deploy/env.mainnet.example`)

```bash
SALPAY_NETWORK=mainnet
MAINNET_STRICT_GUARDS=true

MINT_TREASURY_ADDRESS_MAINNET=SC11aKyaf…   # your treasury
MINT_BURN_PERCENT=50
MINT_BURN_KIND=protocol

FEE_CURRENCY=usd
SAL_USD_MANUAL_RATE=0.05          # update when SAL price moves

MINT_PAYMENT_VERIFICATION_MODE=chain_proof
MINT_CHAIN_PROOF_MIN_CONFIRMATIONS=1
PAYMENT_MODE=client_wallet

TURNSTILE_ENFORCE=true
TURNSTILE_SECRET=…
NEXT_PUBLIC_TURNSTILE_SITE_KEY=…

AUTHORITATIVE_NAME_CHECK_URL=self
AUTHORITATIVE_TICKER_CHECK_URL=self

# On-chain ticker layer — see TICKER-CHAIN-CHECK.md
# Day-1 safe: stub + SalPay DB (blocks only names/tickers YOU issued)
CHAIN_NAME_CHECK_URL=stub
CHAIN_TICKER_CHECK_URL=stub
CHAIN_CHECK_FAIL_CLOSED=false
# When token_info works on a wallet-rpc:
# CHAIN_TICKER_CHECK_URL=wallet_rpc
# CHAIN_TICKER_RPC_URL=http://127.0.0.1:29089/json_rpc
# CHAIN_CHECK_FAIL_CLOSED=true

TREASURY_VIEW_RPC_URL=http://127.0.0.1:29089/json_rpc
TREASURY_PUBLIC_STATS=true

CORS_ALLOW_ORIGIN=https://salpay.org
PUBLIC_API_BASE_URL=https://salpay.org
NEXT_PUBLIC_API_BASE_URL=https://salpay.org

NAMES_DB_PATH=/var/lib/salpay/minted-names.json   # start as []
```

**Empty names DB on first mainnet boot.** Do not upload local testnet junk.

---

## 3. Treasury view-only wallet (once)

On a secure machine (or the VPS):

1. Create view-only wallet from GUI **secret** (view-balance) + treasury `SC…`  
   (scripts under `private/treasury-view/` on your PC — not in git)
2. Copy **only** `*.keys` + wallet cache to VPS: `/var/lib/salpay/treasury-view/`
3. Run wallet-rpc:

```bash
salvium-wallet-rpc \
  --wallet-dir /var/lib/salpay/treasury-view \
  --rpc-bind-ip 127.0.0.1 \
  --rpc-bind-port 29089 \
  --daemon-address cryptosyphon.sytes.net:19081 \
  --trusted-daemon \
  --disable-rpc-login
# then open_wallet once (filename + password)
```

Use a remote mainnet RPC so you are not maintaining a full node.  
Keep 1–2 backup daemon addresses documented if the public one dies.

systemd: `Restart=always` for view-rpc + backend + frontend/nginx.

---

## 4. Smoke checklist (after deploy)

1. `GET https://salpay.org/healthz` → ok  
2. `GET https://salpay.org/api/treasury` → eventually `available: true` (after view wallet sync)  
3. `GET https://salpay.org/api/treasury-view-status` → `expected_address_recognized: true`  
4. Website mint card shows treasury balance  
5. Dust mint: quote → pay treasury half + burn half → verify → execute → resolve  
6. Send dust to the new `.sal` name from a wallet  

---

## 5. Ongoing upkeep (honest)

| Task | Frequency |
|------|-----------|
| Hosting / process alive | Auto-restart + occasional check |
| View-rpc up | systemd/cron ensure |
| Remote node still works | If mint verify or treasury breaks, swap daemon address |
| `SAL_USD_MANUAL_RATE` | When SAL price moves a lot |
| Backup `NAMES_DB_PATH` | Daily automated backup |
| Turnstile / TLS | Rarely |

---

## 6. Explicit non-goals (keeps upkeep low)

- No full mainnet node (unless you want one later)  
- No server-side user fund custody  
- No password accounts / email for name management (v1)  
- No DNS TXT publish required for v1 (optional later)  
- No mandatory chain ticker indexer on day 1 if methods missing  

---

## Related

- `TICKER-CHAIN-CHECK.md` — how taken tickers are blocked  
- `TREASURY-PUBLIC-STATS.md` — public treasury balance  
- `MAINNET-GO-LIVE-CHECKLIST.md` — full audit list  
- `MULTI-WALLET-INTEGRATION.md` — other wallets  
