# Add SalPay mint + send to your wallet (simple)

For **Noodles, Whisky, stock Salvium GUI, web wallets**, or any app that can:

1. Call HTTPS JSON APIs  
2. Build a normal **SAL1** transfer to an `SC...` address  

SalPay is the **name registry + fee policy**. Your wallet only **signs** and **broadcasts**.

**Production API:** `https://sal.cash`  
**Asset:** `SAL1`  |  **Decimals:** 8 (`1 SAL1 = 100_000_000` atomic)

---

## A) Send to a name (10 minutes)

**UX rules (avoid user confusion)**

- Only treat input as a SalPay name when it **ends with `.sal`** (or the user clicks Resolve).  
- Do **not** auto-resolve partial typing (`deep` -> `deep.sal`) or spam error popups while typing.  
- On failure, tell the user the name is not registered yet (or mid-mint) -- do not invent an address.

```text
User types:  alice.sal
You call:    GET https://sal.cash/api/resolve/alice.sal
On success:  destination = response.resolved_address
Then:        create SAL1 transfer as usual (asset SAL1)
```

**Success JSON (shape):**

```json
{
  "success": true,
  "name": "alice.sal",
  "resolved_address": "SC1...",
  "ticker": "ALIC",
  "source": "minted"
}
```

**Rules**

- Only use `resolved_address` if `success === true`  
- Do not invent addresses if the API fails  
- Optional autocomplete: `GET /api/suggest?q=ali`

**Optional website-style helper** (still non-custodial on mainnet):

```http
POST /api/send
{ "name": "alice.sal", "amount": 1.5 }
```

Returns the resolved address; **you** still sign the send in the wallet.

---

## B) Mint a name (full flow)

Mainnet policy today:

- User pays **100% of the fee** in **one SAL1 transfer** to the mint treasury  
- Server checks the deposit with a **view-only** treasury wallet (`chain_proof`)  
- Operator may burn 50% later (not the user's job)

```text
1) GET  /api/mint/ticker-suggestions?name=myname.sal&limit=3
2) POST /api/mint/quote          { "name": "myname.sal", "ticker": "MYNA" }
3) POST /api/mint/reserve        { "name", "ticker", "primary_address": "<user SC...>" }
4) User pays reservation.fee SAL1 -> reservation.treasury_address  (from any wallet)
5) POST /api/mint/verify-payment {
     "reservation_id",
     "amount": <fee>,
     "tx_hash": "<64 hex>",
     "to_address": "<treasury_address>"
   }
6) POST /api/mint/execute        { "reservation_id" }
7) GET  /api/resolve/myname.sal  -> should succeed
```

**Website users** do the same steps in the sal.cash mint wizard (Turnstile on the site).  
**Desktop wallets** typically skip Turnstile when the server is in `chain_proof` mint mode (server config).

**Important**

- `primary_address` must be the user's **receive** address (name resolves to this)  
- Payment must be **SAL1** to the exact `treasury_address` and amount  fee  
- After enough confirmations, verify returns `status: "verified"`  
- If verify fails with `tx_not_found`, wait and retry -- funds are on-chain, not "held" by the app  

**List names for a wallet (left panel / "my names"):**

```http
GET /api/names/by-address?address=SC1...
```

---

## C) Drop-in for Salvium-based GUIs (Noodles / Whisky / forks)

If you already build a Salvium Qt GUI:

1. Copy the SalPay UI + C++ helpers from  
   `salpay/wallet-integration/NOODLES-HANDOFF/sources/`  
   (see `APPLY.md` in that folder).  
2. Or re-implement only **resolve + mint HTTP** using this doc -- no need to copy QML.  
3. Defaults:

```text
SALPAY_API_BASE_URL = https://sal.cash
SALPAY_ENABLE = true
```

4. Smoke test:

- Resolve `deeppamp.sal` (or a name you mint)  
- Mint a short test name with a tiny fee tier only if you accept the mainnet fee  
- Send SAL1 to that name  

**Do not** put OPS keys, treasury spend keys, or view-balance secrets in the wallet binary.

---

## D) Web wallet (Whisky / Noodles web)

Same HTTPS APIs. Flow:

1. Resolve / mint via `fetch('https://sal.cash/api/...')`  
2. Build + sign the SAL1 payment in the web wallet's existing transfer path  
3. Paste or auto-detect `tx_hash` for `verify-payment`  

CORS on production is set for the **website origin**. Pure desktop or native apps call the API directly (no browser CORS). Web apps hosted on **other origins** should either:

- proxy mint/resolve through **their own backend**, or  
- ask SalPay ops to allowlist their origin if appropriate  

---

## E) Health checks

```http
GET https://sal.cash/api/healthz
GET https://sal.cash/api/treasury-view-status   # chain_proof ready?
GET https://sal.cash/api/turnstile-config       # network + mint policy summary
```

---

## Support

- Operator burn queue (not for end users): `salpay/docs/OPERATOR-BURN.md`  
- Full multi-wallet notes: `MULTI-WALLET-INTEGRATION.md`  
- Name rules: `NAME-STANDARD.md`
