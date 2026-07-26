# Mainnet go-live checklist (thorough audit)

Last audit: **2026-07-25**  
Source of truth for ops: this file + `env.mainnet.example` + `MAINNET-CONFIG.md`.

---

## Executive summary

| Area | Code ready? | Ops ready? | Notes |
|------|-------------|------------|--------|
| Treasury address | Yes | **Confirm yours** | Default in template is the SC11... address you provided earlier |
| 50% protocol BURN + 50% treasury | Yes | Needs mainnet GUI/CLI test | `payment_outputs` + GUI `createBurnTransactionAsync` + website dual-hash fields |
| Name uniqueness (SalPay DB) | Yes | Durable volume | `AUTHORITATIVE_*_URL=self` + `NAMES_DB_PATH` |
| Ticker uniqueness (local) | Yes | Yes | Suggestions never return taken chips (fixed 2026-07-25) |
| Ticker uniqueness (live chain) | **Partial** | **Needs indexer or `wallet_rpc`** | `CHAIN_TICKER_CHECK_URL` = `stub` \| `wallet_rpc` \| HTTP |
| Payment verify `chain_proof` | Yes | **Needs treasury view-wallet RPC** | Server must *see* incoming treasury txs |
| Turnstile | Yes | Need real site/secret keys | Hostnames include salpay.org |
| Non-custodial send | Yes | `PAYMENT_MODE=client_wallet` | Website must not relay funds |
| Real `create_token` on execute | **No** | HF / wallet support | Names still `sim_...` job ids until wired |
| DB cleanup | -- | **Do before empty mainnet DB** | Local testnet junk only; mainnet starts empty |
| Doc / AI-slop cleanup | -- | Before public push | See cleanup section |

---

## 1. Treasury (you)

**Configured product address (template):**

```text
SC11aKyafJ116XJ9VG9Xt4C8hjXEpMcivH3TKwnxgkjeFcPJAJtz3v4fXXYVBMRBUX7q4iZVHqjKnML2SszqqMHk99jLdupNNb
```

```bash
SALPAY_NETWORK=mainnet
MINT_TREASURY_ADDRESS_MAINNET=<your SC... treasury>
```

**You must confirm:**

- [ ] This is still the correct mainnet Carrot treasury
- [ ] You control the spend keys offline (cold preferred)
- [ ] A **view-only** copy of this wallet can run as `SALVIUM_RPC_URL` on the server for `chain_proof`

---

## 2. Mint fee: 50% transfer + 50% protocol BURN

### Backend (done)

With mainnet defaults / env:

```bash
MINT_BURN_PERCENT=50
MINT_BURN_KIND=protocol
```

`buildPaymentOutputs(fee)` returns:

1. `{ role: "treasury", kind: "transfer", address: <treasury>, amount: fee/2 }`
2. `{ role: "burn", kind: "protocol_burn", asset_type: "SAL1", amount: fee/2 }`

`verify-payment` requires:

- `tx_hash` / `treasury_tx_hash` for treasury half  
- `burn_tx_hash` for protocol burn half  

In `chain_proof` mode:

- Treasury half is proven via wallet-rpc (`get_transfer_by_txid` / history) against treasury destination + amount + confirmations  
- Burn half: hash required; amount checked if the server can observe the burn tx; otherwise hash is audited (payer's burn often invisible to a treasury-only view wallet)

### GUI (private fork -- done)

`salvium-gui/pages/SalPay.qml`:

1. Pay treasury transfer (SAL1)  
2. Auto-opens `createBurnTransactionAsync` for burn half  
3. Sends both hashes to `verify-payment`  

CLI fallback (if GUI burn missing on some build):

```text
burn <amount> SAL1
```

### Website (done)

Mint wizard collects treasury hash + burn hash when `protocol_burn` is in `payment_outputs`.

### Still to do on real mainnet

- [ ] Dust mint: pay treasury half + burn half, confirm verify + execute  
- [ ] Confirm burn appears as BURN type in wallet history  
- [ ] Confirm fee math with `FEE_CURRENCY=usd` and current `SAL_USD_MANUAL_RATE`

---

## 3. Fees (USD -> SAL1)

| Base length | USD |
|-------------|-----|
| 1-4 | $50 |
| 5-6 | $35 |
| 7-63 | $20 |

```bash
FEE_CURRENCY=usd
SAL_USD_MANUAL_RATE=<USD per 1 SAL1>   # update before launch
FEE_USD_BUFFER_PERCENT=3
```

- [ ] Set a real market rate (or accept manual ops updates)  
- [ ] Re-quote in UI after rate change  

---

## 4. Uniqueness model

### Names

| Layer | Role |
|-------|------|
| Local `minted-names.json` + reservations | Authoritative for SalPay resolves today |
| `AUTHORITATIVE_NAME_CHECK_URL=self` | In-process same DB |
| `CHAIN_NAME_CHECK_URL` | Future name index (stub OK for v1) |

### Tickers

| Layer | Role |
|-------|------|
| Local DB + reservations | Always checked; drives suggestions |
| Reserved: `SAL*`, `BURN`, `SAL1`, ... | Always blocked |
| `CHAIN_TICKER_CHECK_URL` | Live chain / wallet_rpc / HTTP indexer |

**Interim chain check (implemented):**

```bash
CHAIN_TICKER_CHECK_URL=wallet_rpc
# uses SALVIUM_RPC_URL -> token_info / get_tokens
CHAIN_CHECK_FAIL_CLOSED=false   # true only when probe is reliable
```

**Target chain check:**

```bash
CHAIN_TICKER_CHECK_URL=https://your-indexer/ticker
CHAIN_CHECK_FAIL_CLOSED=true
```

Indexer JSON contract:

```json
{ "available": true, "taken": false, "exists": false, "source": "chain" }
```

- [ ] Choose interim `wallet_rpc` vs wait for indexer  
- [ ] When create_token is global, prefer real indexer  

---

## 5. Critical: `chain_proof` needs a treasury view wallet

`verifyPaymentByChainProof` looks up the **user's payment tx** via **`TREASURY_VIEW_RPC_URL`** (falls back to `SALVIUM_RPC_URL`).

That only works if the server wallet can see transfers **to the treasury**.

| Setup | Works? |
|-------|--------|
| Server hot wallet = treasury (spend keys on VPS) | Works but **unsafe** |
| Server **view-only** treasury wallet + RPC | **Correct** |
| No wallet-rpc / wrong wallet | `tx_not_found` -- mints stuck |

### Local status (2026-07-25)

- View-only wallet created under `<PRIVATE_TREASURY_VIEW_DIR>\` (**outside git**)
- Method: `generate_from_keys` with Carrot **view-balance secret** (GUI "secret")
- `get_address_index(treasury SC...)` -> `0/0` recognized
- Password (watch file only): see private README -- **cannot spend**
- Start: `private\treasury-view\start-treasury-view-rpc.bat` (needs **mainnet** daemon)
- Probe: `GET /api/treasury-view-status`

```bash
MINT_PAYMENT_VERIFICATION_MODE=chain_proof
MINT_CHAIN_PROOF_MIN_CONFIRMATIONS=1
TREASURY_VIEW_RPC_URL=http://127.0.0.1:29089/json_rpc
PAYMENT_MODE=client_wallet
```

- [x] Create view-only treasury wallet (local private path)  
- [x] Open wallet-rpc against **mainnet** (remote node; local DB was stuck)  
- [x] Public `GET /api/treasury` + website mint card restored (`TREASURY_PUBLIC_STATS=true`)  
- [ ] Wait for first full wallet refresh (source=syncing until then)  
- [ ] Smoke: send dust to treasury, prove via verify path  
- [ ] Deploy same view-only wallet to VPS (no spend key) + always-on service  
- [ ] Optional: repair/resync local mainnet `salviumd` (MDB_KEYEXIST at ~513902)

---

## 6. Security / production env

```bash
SALPAY_NETWORK=mainnet
MAINNET_STRICT_GUARDS=true          # forces chain_proof + AUTHORITATIVE_* set
TURNSTILE_ENFORCE=true
TURNSTILE_SECRET=...
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
CORS_ALLOW_ORIGIN=https://salpay.org
PUBLIC_API_BASE_URL=https://salpay.org
NEXT_PUBLIC_API_BASE_URL=https://salpay.org
NAMES_DB_PATH=/var/lib/salpay/minted-names.json   # durable + backups
```

Strict guards currently require:

- `chain_proof`  
- `AUTHORITATIVE_NAME_CHECK_URL`  
- `AUTHORITATIVE_TICKER_CHECK_URL`  

They do **not** yet refuse start if chain ticker is still `stub` (by design until indexer exists).

- [ ] Cloudflare: origin cert, Turnstile hostnames, optional WAF  
- [ ] Rate limits reviewed  
- [ ] No wallet seeds/passwords in git  
- [ ] Backups of `NAMES_DB_PATH`  

See `CLOUDFLARE-CHECKLIST.md`, `SERVER-BOOTSTRAP.md`.

---

## 7. GUI mainnet defaults

| Item | Expected |
|------|----------|
| `salpayApiBase` mainnet | `https://salpay.org` |
| testnet pin | `http://127.0.0.1:3001` only on testnet nettype |
| Mint asset | `SAL1` |
| Burn helper | `createBurnTransactionAsync` present in fork |
| Branch | `integration/salpay-v2` -- **do not force-push upstream** |

- [ ] Release build of forked GUI for downloaders  
- [ ] Smoke mint + resolve + send on mainnet dust  

---

## 8. On-chain mint gap (`create_token`)

Today `execute` registers the name in SalPay DB and may return `tx_hash: sim_...`.

- [ ] Document clearly for users: "registered + paid," not always a wallet token dropdown entry  
- [ ] When HF enables `create_token`, wire execute path and re-test ticker chain checks  

---

## 9. Multi-wallet integration

Guide: `MULTI-WALLET-INTEGRATION.md`  

- Resolve + send-by-name  
- Mint flow + free ticker chips  
- OpenAPI-style contract for Noodles / others  

- [ ] Share guide with wallet teams after API is on a stable staging host  

---

## 10. Local testnet state (2026-07-25)

Verified this session:

- Stack up (daemon offline, backend, frontend, GUI)  
- Ticker suggestions clean (no taken chips)  
- Mint execute with `AUTHORITATIVE_*=self` fixed  
- Mint `e2etest...` / `recv...` + send-by-name real tx  
- Live config: testnet, burn 0%, client_attested, self registry  

---

## 11. Cleanup plan (do after you approve)

### A. Junk names DB (local testnet only)

**Do not ship this file to mainnet.** Mainnet should start with empty durable DB.

Current local entries (~23) are almost all test:

| Pattern | Examples | Action |
|---------|----------|--------|
| smoke* / SMOK | 4 SMOK | Delete |
| debug / web / e2e / recv / pol / burn* | various | Delete |
| BURN ticker | burn155210.sal | Delete |
| "fun" tests | pamps, rockets, deeppamp1, j12 | Keep only if you want personal test names, else delete |
| All `sim_*` | entire DB | Expected until real create_token |

Safe approach:

1. Backup `minted-names.json`  
2. Replace with `[]` **or** keep a short personal allowlist  
3. Clear `name-images/` if unused  

### B. AI / session slop (repo hygiene)

| Path | Action |
|------|--------|
| `docs/AGENT-START-HERE-20260718.md` | Archive or delete after SESSION-PICKUP is enough |
| `docs/CHECKPOINT-20260718.md` | Same |
| Overlapping readiness docs | Keep **one** checklist (this file) + MAINNET-CONFIG + SESSION-PICKUP; trim duplicates |
| `scripts/debug-captures/*` (50+ files) | Delete or gitignore; keep none in release |
| Root: `aqtinstall.log`, `boost_regex_test.*`, `build-out*.txt` | Delete |
| `.continue/` | Untracked local IDE -- don't commit |
| `salpaytest*` wallet files | Must stay gitignored |

### C. Before public git push

- [ ] No secrets in history  
- [ ] `env.mainnet.example` only (no real Turnstile secrets)  
- [ ] Empty or clean production names DB path  
- [ ] README points to go-live checklist + multi-wallet guide  

---

## 12. Ordered launch sequence

1. Confirm treasury SC address + view-only RPC on VPS  
2. Deploy backend with `env.mainnet.example` filled  
3. Turnstile + Cloudflare  
4. Set `SAL_USD_MANUAL_RATE`  
5. `CHAIN_TICKER_CHECK_URL=wallet_rpc` or real indexer  
6. Staging dust: mint (treasury+burn) -> resolve -> send-by-name  
7. Ship GUI build with salpay.org default  
8. Publish multi-wallet doc  
9. Only then: announce mainnet  

---

## 13. Explicit non-goals for v1

- Public treasury balance display  
- Specialty name pricing  
- Server-custodial send on mainnet  
- Force-push private GUI to upstream Salvium  

---

## Related files

| File | Role |
|------|------|
| `deploy/env.mainnet.example` | Env template |
| `docs/MAINNET-CONFIG.md` | Treasury + burn short form |
| `docs/MULTI-WALLET-INTEGRATION.md` | Other wallets |
| `docs/REGISTRY-AND-NAME-IMAGES.md` | Uniqueness + images |
| `docs/SESSION-PICKUP.md` | Daily resume |
| `docs/CLOUDFLARE-CHECKLIST.md` | Edge hardening |
| `backend/index.js` | Policy authority |
