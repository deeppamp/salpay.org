# Session Pickup -- 2026-07-25 (cleanup + mainnet path)

**Status:** Test junk cleaned. Public treasury + view-only path documented. Minimal VPS install + ticker chain strategy written. Ready for VPS deploy when you are.

**Resume docs (keep these):** `VPS-MINIMAL-INSTALL.md`, `TICKER-CHAIN-CHECK.md`, `MAINNET-GO-LIVE-CHECKLIST.md`, `TREASURY-PUBLIC-STATS.md`, `MULTI-WALLET-INTEGRATION.md`

---

## 2026-07-25 cleanup

- `minted-names.json` wiped to `[]` (backup under `backend/data/backups/`)
- Removed root build junk, debug-captures files, obsolete handoff docs
- Mainnet ticker: layers documented; day-1 = SalPay DB; enable `wallet_rpc`/`indexer` when ready

---

## 2026-07-25 smoke results

| Check | Result |
|-------|--------|
| Ticker suggestions never return taken chips | Pass (TEST/PAMP/ROCK/DEEP/BURN/SAL* blocked) |
| Already-minted name reports `desired_available=false` for its ticker | Pass |
| Full mint (quote->reserve->verify->execute) with `AUTHORITATIVE_*=self` | Pass (was broken: reservation treated as "taken") |
| Remint + explicit taken ticker | Correctly rejected |
| Resolve new names | Pass |
| Send by name via `POST /send` | Pass -- real tx `1b9dba13...` (pending in wallet) |
| Artifacts | `salpay/scripts/debug-captures/last-smoke-mint.json`, `last-smoke-send.json` |

**Example names minted this session:** `e2etest165050.sal` (E2ET), `recv165050.sal` (RECV)

**Bug fixed:** `checkLocalNameRegistry` / `checkAuthoritativeTickerAvailability` did not exclude the in-progress reservation, so `mint/execute` always failed with "Ticker is already taken on authoritative source" when `AUTHORITATIVE_*_URL=self`.

**Mainnet ticker plan:** keep SalPay DB for names + reserves; set `CHAIN_TICKER_CHECK_URL` to a live chain indexer when ready (see `REGISTRY-AND-NAME-IMAGES.md`, `env.mainnet.example`). Suggestions already re-check every chip through authoritative + chain layers.

**Other wallets:** `salpay/docs/MULTI-WALLET-INTEGRATION.md`

---

## What is solid

| Area | State |
|------|--------|
| GUI SalPay mint (quote -> pay -> verify -> execute) | Working on local testnet |
| Free tickers | Only from API; scanned vs **minted-names.json** + reservations (+ chain when configured) |
| Taken stem note | e.g. `TEST is used by testname123.sal -- free: TES2` |
| Testnet fee | Full fee to treasury (`MINT_BURN_PERCENT=0`) -- no protocol burn hang |
| Mainnet burn policy (code) | 50% treasury + 50% protocol BURN when env set |
| Website mint wizard | Same registry API for free tickers + reserve |
| Images / left-panel avatar card | **Removed** (names only) |
| GUI binary | `<YOUR_SALPAY_WORKSPACE>\salvium-gui\build\release\bin\salvium-wallet-gui.exe` |
| GUI branch | `salvium-gui` -> `integration/salpay-v2` (**do not force-push upstream**) |

---

## How public users get verified tickers (wallet + website)

All clients must call **your production API** (not invent tickers locally):

| Client | API base | Endpoints |
|--------|----------|-----------|
| **Downloaded wallet (mainnet)** | `https://sal.cash` (default in GUI) | `GET /api/mint/ticker-suggestions?name=`  |  `POST /api/mint/quote`  |  `reserve`  |  `verify-payment`  |  `execute`  |  `GET /api/resolve/:name` |
| **Website** | `NEXT_PUBLIC_API_BASE_URL` -> same API | Same routes |
| **Testnet local** | `http://127.0.0.1:3001` | Same routes |

**Server truth today:** `minted-names.json` (+ in-memory reservations).  
**Mainnet env:** `AUTHORITATIVE_NAME_CHECK_URL=self` and `AUTHORITATIVE_TICKER_CHECK_URL=self` (built-in DB registry).  
**Later:** set `CHAIN_NAME_CHECK_URL` / `CHAIN_TICKER_CHECK_URL` to a real indexer (replace `stub`).

Reserve always re-checks the ticker is free before accepting payment.

---

## Start next session (Windows)

```powershell
Set-Location '<YOUR_SALPAY_WORKSPACE>\salpay.org\salpay\scripts'
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-old-layout-tonight.ps1
# optional offline fixed-diff:
# $env:SALPAY_DAEMON_OFFLINE='true'
.\start-full-stack.bat
```

GUI:  
`<YOUR_SALPAY_WORKSPACE>\salvium-gui\build\release\bin\salvium-wallet-gui.exe`

- Website: http://127.0.0.1:3000  
- API: http://127.0.0.1:3001  
- Do **not** run wallet-rpc while GUI has `salpaytest` open  

### Clean stop

```powershell
Get-Process salvium-wallet-gui,salvium-wallet-rpc,salviumd,node -ErrorAction SilentlyContinue | Stop-Process -Force
```

---

## First tasks next day (in order)

1. **Commit & push** sal.cash (backend ticker registry, website, docs, burn=0 testnet stack) if not already.  
2. **Smoke:** new name with taken stem (e.g. `test...`) -> field must **not** be `TEST`; mint -> resolve -> send dust.  
3. **Mainnet staging VPS:** copy `salpay/deploy/env.mainnet.example` -> real secrets, Turnstile, `chain_proof`, burn 50%, durable `NAMES_DB_PATH`.  
4. **Dust mint on staging/mainnet:** treasury half + protocol burn half + dual hashes.  
5. Optional: chain indexer URLs; clean test junk in DB (`SMOK` dupes, ticker `BURN`).  
6. Optional: real `create_token` on execute when HF is ready (today mint job may still be `sim_...`).

---

## Key paths

| What | Path |
|------|------|
| Backend | `salpay/backend/index.js` |
| Website | `salpay/frontend/app/page.tsx` |
| Mainnet env template | `salpay/deploy/env.mainnet.example` |
| Registry / uniqueness doc | `salpay/docs/REGISTRY-AND-NAME-IMAGES.md` (images optional/legacy; uniqueness still valid) |
| Full readiness checklist | `salpay/docs/TESTNET-SESSION-AND-MAINNET-READINESS.md` |
| GUI SalPay tab | `salvium-gui/pages/SalPay.qml` |
| GUI main defaults | `salvium-gui/main.qml` |
| Names DB (local) | `salpay/backend/data/minted-names.json` |

---

## Policy snapshot (locked product)

- Fee asset: **SAL1**, atomics **1e8**  
- Testnet fees: 100 / 500 / 2000 SAL by length  
- Mainnet fees: ~$20 / $35 / $50 USD in SAL1 (manual rate for now)  
- Mainnet pay: **50% treasury transfer + 50% protocol BURN**  
- Tickers: 4 `[A-Z0-9]`, **not** `SAL*`, not `BURN`  
- No public treasury balance display  
- No mint avatar UI (names only)

---

## Do not forget

- Private GUI fork stays local / private remote -- not force-push to `salvium/salvium-gui`.  
- Mainnet GUI default API is already `https://sal.cash`.  
- Production uniqueness for downloaders = **whatever the live API enforces**; keep DB durable and authoritative flags on.
