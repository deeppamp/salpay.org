# Multi-wallet integration -- mint + send-by-name

Status: ready for wallet teams once `https://sal.cash` is live with the same API.

This is the **easy path** for any Salvium (or third-party) wallet to support:

1. **Mint a `.sal` name** (policy + payment verification on SalPay; signing in the wallet)
2. **Send SAL1 by name** (resolve `.sal` -> Carrot `SC...` address, then normal transfer)

SalPay is the **policy authority**. Wallets stay thin: UI, signing, and local UX only.

---

## Base URL

| Environment | API base |
|-------------|----------|
| Production | `https://sal.cash` |
| Local testnet | `http://127.0.0.1:3001` |

All routes below are relative to that base. CORS and Turnstile may apply on production; desktop wallets that sign locally typically do not need Turnstile if mint uses `chain_proof` payment verification (see server env).

**TL;DR for Noodles / Whisky / other builders:**  
see **`WALLET-INTEGRATION-SIMPLE.md`** first (send-by-name + mint in one page).

**Recommended wallet settings**

```text
SALPAY_API_BASE_URL=https://sal.cash
SALPAY_ENABLE=true
# optional early rollout:
SALPAY_RESOLVE_ONLY=false
```

**Mainnet payment model (current):** user pays **full fee once** to treasury (`full_treasury`).  
Operator burns ~50% later. Users do **not** need a protocol BURN during mint.

---

## 1) Send by name (minimum integration)

### Resolve

```http
GET /api/resolve/{name}
```

Example: `GET /api/resolve/alice.sal`

**Success**

```json
{
  "success": true,
  "name": "alice.sal",
  "resolved_address": "SC1...",
  "ticker": "ALIC",
  "source": "minted"
}
```

**Failure**

```json
{ "success": false, "error": "Name not found" }
```

### Wallet steps

1. If input ends with `.sal` (case-insensitive), call resolve.
2. On success, put `resolved_address` into the normal transfer destination.
3. Transfer **SAL1** with **8 decimal** atomic units (`1 SAL1 = 1e8`).
4. If resolve fails, show error; do **not** invent an address.

### Optional name autocomplete

```http
GET /suggest?q=ali
```

Returns verified minted names only when `RESOLVE_VERIFIED_ONLY=true` (production default).

### Optional non-custodial helper

```http
POST /send
Content-Type: application/json

{ "name": "alice.sal", "amount": 1.5 }
```

When server `PAYMENT_MODE=client_wallet` (mainnet template), response is **resolve-only**:

```json
{
  "success": true,
  "resolved_address": "SC1...",
  "relay_mode": "client_wallet",
  "tx_hash": null,
  "message": "Resolved alice.sal. Send ... from your wallet to SC1..."
}
```

Wallet still builds and signs the transfer itself. Do not rely on server relay on mainnet.

---

## 2) Mint a name (full integration)

### Flow (happy path)

```text
ticker-suggestions -> quote -> reserve -> (user pays fee from wallet) -> verify-payment -> execute -> resolve
```

### 2a. Free ticker chips (never invent tickers client-side)

```http
GET /api/mint/ticker-suggestions?name=alice.sal&limit=3
```

```json
{
  "success": true,
  "name": "alice.sal",
  "desired_ticker": "ALIC",
  "desired_available": true,
  "desired_owner": null,
  "suggested_ticker": "ALIC",
  "available_ticker_suggestions": ["ALIC", "ALI0", "ALI1"],
  "verified_against": "local_minted_db",
  "note": "All chips verified free against local_minted_db."
}
```

**Rules for wallets**

- Always show chips from this API (or from `quote` / `reserve` error payloads).
- Never invent a 4-char ticker offline.
- Tickers are exactly 4 `[A-Z0-9]`, not `SAL*`, not `BURN`.
- On mainnet, when chain indexer is configured, `verified_against` includes `live_chain`.

### 2b. Quote (fee + free ticker)

```http
POST /api/mint/quote
Content-Type: application/json

{
  "name": "alice.sal",
  "primary_address": "SC1...",
  "ticker": "ALIC"
}
```

Omit `ticker` to let the server pick a free one.

### 2c. Reserve (holds name + ticker briefly)

```http
POST /api/mint/reserve
Content-Type: application/json

{
  "name": "alice.sal",
  "primary_address": "SC1...",
  "ticker": "ALIC"
}
```

Response includes:

- `reservation_id`
- `fee` (SAL1 human units) and/or payment breakdown
- `treasury_address`
- `payment_outputs` (treasury transfer  protocol burn on mainnet)
- `available_ticker_suggestions` if the requested ticker was rejected

### 2d. Pay from the wallet (not from SalPay)

Build normal wallet txs from `payment_outputs`:

| Network | Policy |
|---------|--------|
| Testnet | 100% fee -> treasury (`MINT_BURN_PERCENT=0`) |
| Mainnet | 50% treasury **transfer** + 50% protocol **BURN** |

Fee asset: **SAL1**, atomics **1e8**, destination **Carrot `SC...`**.

Recommended: call wallet `rescan_spent` / refresh before mint payment if the user has been mining or reusing outputs.

### 2e. Verify payment

```http
POST /api/mint/verify-payment
Content-Type: application/json

{
  "reservation_id": "...",
  "amount": 100,
  "tx_hash": "...",
  "to_address": "SC1...treasury...",
  "treasury_tx_hash": "...",
  "burn_tx_hash": "..."
}
```

- Testnet / `client_attested`: server may accept attested hashes (dev only).
- Mainnet / `chain_proof`: both treasury and burn hashes must verify on-chain.

### 2f. Execute mint (register name)

```http
POST /api/mint/execute
Content-Type: application/json

{
  "reservation_id": "...",
  "idempotency_key": "wallet-unique-id"
}
```

On success, name is in the SalPay registry and **resolves**.  
`tx_hash` may still be `sim_...` until on-chain `create_token` is wired; treat "minted" as **policy-registered + payment verified**.

---

## 3) Uniqueness model (what wallets must know)

| Layer | Purpose |
|-------|---------|
| Local SalPay DB (`minted-names.json` + reservations) | Authoritative for **names** registered through SalPay; holds open reserves |
| `AUTHORITATIVE_*_URL=self` | In-process same DB (no HTTP loop) |
| `CHAIN_TICKER_CHECK_URL` | **Live-chain ticker** check when set to a real indexer (mainnet goal) |
| `CHAIN_NAME_CHECK_URL` | Optional live-chain name index later |

**Mainnet goal:** tickers must be free on the **live chain** (token registry / indexer), not only in SalPay's file. Until the indexer exists, use `CHAIN_TICKER_CHECK_URL=stub` and keep `AUTHORITATIVE_TICKER_CHECK_URL=self`.

Wallets must **not** implement their own uniqueness. Always ask SalPay.

### Registry probe (optional UI)

```http
GET /api/registry/check?name=alice.sal
GET /api/registry/check?ticker=ALIC
```

```json
{ "success": true, "available": true, "exists": false, "taken": false, "source": "local_registry" }
```

---

## 4) Minimal wallet code sketch (pseudocode)

```text
function sendByName(name, amountSal1):
  r = GET /api/resolve/{name}
  if not r.success: show error; return
  transfer(asset=SAL1, to=r.resolved_address, amount=amountSal1)

function mintName(name, primaryAddress):
  chips = GET /api/mint/ticker-suggestions?name={name}&limit=3
  show chips; let user pick ticker (default chips[0])
  q = POST /api/mint/quote { name, primary_address, ticker }
  res = POST /api/mint/reserve { name, primary_address, ticker }
  for each output in res.payment_outputs:
    if output.kind == transfer: wallet.transfer(SAL1, output.address, output.amount)
    if output.kind == burn: wallet.protocolBurn(SAL1, output.amount)
  POST /api/mint/verify-payment { reservation_id, ...tx hashes... }
  POST /api/mint/execute { reservation_id, idempotency_key }
  GET /api/resolve/{name}  // confirm
```

---

## 5) Error handling (do not bypass)

| HTTP | Meaning | Wallet UX |
|------|---------|-----------|
| 400 | Invalid name/ticker/amount | Show server `error` |
| 409 | Name or ticker taken | Show alternatives from `available_ticker_suggestions` |
| 403 | Turnstile / policy blocked | Retry / open website |
| 503 | Uniqueness service down | Retry; do not mint offline |
| 404 resolve | Unknown name | Ask user for raw address |

---

## 6) Security boundaries

**Wallet must**

- Sign only with user approval
- Pay mint fees from the user wallet
- Use production API for uniqueness and resolve

**Wallet must not**

- Skip SalPay and write a local "name -> address" map as truth
- Accept mint without verified payment on mainnet
- Force-push private SalPay GUI patches to upstream Salvium GUI

**Server must**

- Enforce name policy, fees, ticker rules, reserve TTL
- On mainnet: `chain_proof` + durable `NAMES_DB_PATH` + Turnstile
- Prefer live-chain ticker checks when indexer is available

---

## 7) Reference implementations

| Client | Location |
|--------|----------|
| Salvium GUI (private fork) | `salvium-gui` branch `integration/salpay-v2` -- `pages/SalPay.qml`, `pages/Transfer.qml` |
| Website | `salpay/frontend/app/page.tsx` |
| Handoff pack for another GUI | `salpay/wallet-integration/NOODLES-HANDOFF/` |
| Full GUI contract | `salpay/docs/WALLET-GUI-INTEGRATION-CONTRACT.md` |

---

## 8) Quick smoke checklist for wallet QA

1. Resolve a known minted name -> correct `SC...` address  
2. Resolve garbage name -> error  
3. Ticker suggestions for `test....sal` never return taken chips (`TEST`, etc.)  
4. Mint: quote -> pay -> verify -> execute -> resolve  
5. Send dust SAL1 to the new name  
6. Explicit taken ticker on quote/reserve -> 409 + free alternatives  

Local stack: see `salpay/docs/SESSION-PICKUP.md`.
