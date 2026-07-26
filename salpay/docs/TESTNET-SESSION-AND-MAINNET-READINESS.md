# Testnet Session Notes & Mainnet Readiness

Last updated: 2026-07-19 (night stop — see SESSION-PICKUP.md)

This is the handoff for private offline testnet work and the checklist before public mainnet.

**Resume file:** `salpay/docs/SESSION-PICKUP.md`

---

## What works on testnet (verified)

### Runtime stack
| Piece | Path / endpoint | Notes |
|--------|------------------|--------|
| Daemon | offline testnet `:29081` fixed difficulty 500 | `salvium-gui-clean-v113c` `salviumd` v1.1.3c |
| GUI | old-layout `salvium-gui/build/release/bin/salvium-wallet-gui.exe` | SalPay tab + Send tab |
| Backend | `http://127.0.0.1:3001` | `SALPAY_NETWORK=testnet`, `client_attested` |
| Frontend | `http://127.0.0.1:3000` | website |
| Wallet | `salpaytest` | password in `scripts/salvium-env.bat` (local only) |

### Proven end-to-end flows
1. **Mint** via GUI: quote → reserve → Pay From Wallet (SAL1) → verify → execute → resolve.
2. **Resolve** `.sal` names on SalPay tab and Transfer/Send tab (local API).
3. **Send** SAL1 to a resolved name (after wallet `rescanSpent`).
4. **Ticker suggestions**: always aim for 3 free 4-char tickers; natural stem skipped if taken (e.g. PAMP → PAM0/PAM1/PAM2).

### Successful test names (examples on this machine)
| Name | Ticker | Notes |
|------|--------|--------|
| `debugmint142409.sal` | UZKY | RPC mint proof earlier same day |
| `pamps2.sal` | PAM0 | GUI mint; send target |
| `testing.sal` | TES1 | GUI mint (TEST stem taken by testname123) |
| `pamps.sal` | PAMP | older mint |

---

## What we fixed this session

### Backend (`salpay/backend/index.js`)
- `/api/resolve/:name` alias (GUI was calling `/api/resolve`, only `/resolve` existed).
- `GET /api/mint/ticker-suggestions?name=&limit=3` — free tickers from local minted/reserved set; mainnet can also filter via `AUTHORITATIVE_TICKER_CHECK_URL`.
- Quote/reserve auto-pick free ticker when client does not force one.
- Always return up to N free ticker suggestions.
- **Atomic units corrected to Salvium `1e8`** (was Monero-style `1e12` in balance/send/relay paths) — critical for mainnet math.

### GUI (`salvium-gui`, branch `integration/salpay-v2`)
- `pages/SalPay.qml`: mint force **SAL1**, `rescanSpent` before mint pay, PendingTransaction crash hardened, 3 free ticker chips (ListModel), local API base on testnet.
- `pages/Transfer.qml`: testnet pins `http://127.0.0.1:3001`, `rescanSpent` before send.
- `main.qml`: testnet Salpay API default → local backend.
- `WalletManager.cpp`: resolve error handling; pass ticker suggestions through quote/reserve errors.

### Docs / ops
- `WALLET-GUI-INTEGRATION-CONTRACT.md` mint asset section.
- `SESSION-PICKUP.md` resume points.
- Scripts: offline daemon + 1-thread mine, old-layout start, mint debug capture.

---

## Known testnet caveats (not production blockers if handled)

1. **Mint execute still uses simulated on-chain mint job hash** (`sim_…`). Name is registered in Salpay DB and resolves; chain-derived token list in wallet will not show a real create_token asset until real chain mint exists.
2. **Double-spend / daemon reject** after heavy mining or mixed RPC+GUI use: call `rescanSpent` (GUI does this on mint pay and Send). Offline wallet cache can lag.
3. **Do not run wallet-rpc and GUI** on the same wallet file at once.
4. **Local treasury** is the test wallet SC1 address (self-pay fee is OK for testnet).
5. **Payment verification** on local stack is `client_attested` (trusts client-attested tx hash/amount). Mainnet must use `chain_proof`.

---

## Mainnet go-live checklist (do not skip)

### A. Network & assets
- [ ] Confirm native fee asset ticker is still **`SAL1`** (or update GUI `mintPaymentAssetType` + all transfer params).
- [ ] Confirm **8 decimal atomic units** (`SAL_ATOMIC_UNITS = 1e8`) still match live chain.
- [ ] Confirm Carrot **`SC…`** addresses only (reject legacy `SaLv…` for mint treasury / payment).
- [x] Production treasury (owner-provided, mainnet):
  `SC11aKyafJ116XJ9VG9Xt4C8hjXEpMcivH3TKwnxgkjeFcPJAJtz3v4fXXYVBMRBUX7q4iZVHqjKnML2SszqqMHk99jLdupNNb`
  → set as `MINT_TREASURY_ADDRESS_MAINNET` (see `salpay/deploy/env.mainnet.example`).
- [x] **Burn policy (locked):** mint fee is **50% treasury transfer + 50% protocol BURN** (`MINT_BURN_PERCENT=50`, `MINT_BURN_KIND=protocol`).
  - Do **not** invent a burn SC address; burn is protocol `BURN` tx type.
  - Verify requires both `treasury_tx_hash` and `burn_tx_hash`.
- [x] **No public treasury balance** on website or wallet — fee destination address is shown for payment only; balance is not published (privacy + Carrot view-wallet gap).

### B. Backend production config
```bash
SALPAY_NETWORK=mainnet
MAINNET_STRICT_GUARDS=true
MINT_PAYMENT_VERIFICATION_MODE=chain_proof
MINT_CHAIN_PROOF_MIN_CONFIRMATIONS=<policy>
TURNSTILE_ENFORCE=true
TURNSTILE_SECRET=<real>
# frontend site key must not be placeholder
AUTHORITATIVE_NAME_CHECK_URL=<registry or chain indexer>
AUTHORITATIVE_TICKER_CHECK_URL=<same or token registry>
MINT_TREASURY_ADDRESS_MAINNET=<SC…>
NAMES_DB_PATH=<persistent volume>
```
- [x] Authoritative uniqueness: use built-in registry (`AUTHORITATIVE_*_URL=self`) or HTTP `/api/registry/check`; optional chain layer via `CHAIN_*_URL` (stub until indexer exists). See `REGISTRY-AND-NAME-IMAGES.md`.
- [x] Optional name avatar images on mint/resolve (upload + show in website + SalPay tab).
- [ ] Strict guards already refuse start if chain_proof or authoritative URLs missing (`self` is valid).
- [ ] Turnstile hostnames include `salpay.org` / `www.salpay.org`.
- [ ] CORS locked down (not `*`) for production.
- [ ] Rate limits reviewed for register/send/mint.
- [ ] Persist `minted-names.json` (or replace with real DB) on durable storage + backups.

### C. Real on-chain mint (gap)
- [ ] Replace `sim_` execute path with real token/name mint when HF enables `create_token` (or chosen registry design).
- [ ] Until then, document that “minted” means **Salpay-policy registered + payment verified**, not necessarily a wallet token asset dropdown entry.

### D. GUI production build
- [ ] Default `salpayApiBase` = `https://salpay.org` on mainnet nettype.
- [ ] Keep testnet pin to `http://127.0.0.1:3001` only for `NetworkType.TESTNET`.
- [ ] Ship SalPay tab in release build; re-test mint + resolve + send on public testnet then mainnet dust amounts.
- [ ] Do **not** push private fork changes to upstream `salvium/salvium-gui` unless intentional PR; keep private remote or patch set.

### E. Security / abuse
- [ ] `client_attested` disabled on mainnet (strict mode forces chain_proof).
- [ ] Reservation TTL, fee tiers, and burn split re-validated.
- [ ] Audit export / ops metrics monitored.
- [ ] No wallet seed/password in repo (keep `salpaytest*` gitignored).

### F. Functional acceptance tests (mainnet or public testnet)
1. Quote name with free + taken ticker stems (3 free chips).
2. Mint pay from wallet → chain_proof verify → execute.
3. Resolve name on SalPay + Send tab.
4. Send small SAL1 to name; confirm receipt.
5. Fail closed: wrong treasury, wrong amount, double-spend attempt, expired reservation.
6. Turnstile challenge succeeds on production hostnames.

---

## Daily testnet workflow

```powershell
# Start daemon (offline) + GUI
Set-Location '<YOUR_SALPAY_WORKSPACE>\salpay.org\salpay\scripts'
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-old-layout-tonight.ps1
# if needed: $env:SALPAY_DAEMON_OFFLINE='true'

# Backend + frontend (skips wallet-rpc if GUI owns wallet)
.\start-full-stack.bat

# Optional: 1-thread mine for SAL
# scripts\start-mining.bat  OR start_mining API threads_count=1 to SC1 address

# Capture after a failed mint
powershell -NoProfile -ExecutionPolicy Bypass -File .\capture-mint-debug.ps1 -MinutesBack 15
```

Stop:
```powershell
Get-Process salvium-wallet-gui,salvium-wallet-rpc,salviumd,node -ErrorAction SilentlyContinue | Stop-Process -Force
```

---

## Repo map

| Tree | Remote | Notes |
|------|--------|--------|
| `salpay.org` | `github.com/deeppamp/salpay.org` | Website + backend + scripts + docs |
| `salvium-gui` | currently points at upstream `salvium/salvium-gui` | Local branch `integration/salpay-v2` — **do not force-push private work to upstream** without a PR plan |

GUI source files that matter for SalPay:
- `pages/SalPay.qml`
- `pages/Transfer.qml`
- `main.qml`, `LeftPanel.qml`, `MiddlePanel.qml`
- `src/libwalletqt/WalletManager.cpp` / `.h`

---

## Open work while still on testnet

1. **Owner priority:** ship and polish **your forked Salvium GUI** as the smooth SalPay mint/send path (old-layout `integration/salpay-v2` + rebuild).
2. **Website + any external wallet** (including Noodles webwallet later): mint is still multi-step (prepare → pay treasury → verify → execute). Not as smooth as in-GUI yet; improve website flow so non-GUI users can finish mint without tribal knowledge.
3. **Noodles webwallet (note for later):** Noodles has a web wallet — good future client for the same SalPay policy API (`/api/mint/*`, `/api/resolve/*`) without touching owner GUI tree. Handoff pack: `salpay/wallet-integration/NOODLES-HANDOFF/`. When ready, map webwallet send → treasury payment + tx hash back into verify/execute.
4. Optional: real `create_token` / on-chain name asset when available on v1.1.3c+ HF.
5. Optional: durable DB instead of JSON file for minted names.
6. Public testnet run (not only offline fixed-diff) before mainnet.
7. Production Turnstile + Cloudflare checklist (`CLOUDFLARE-CHECKLIST.md`).
8. Private GUI remote (not upstream salvium-gui) so fork builds are easy to share/rebuild.
9. Rehearse full mainnet config on staging VPS with chain_proof (`salpay/deploy/env.mainnet.example` + owner treasury).

---

## Backup note

Local full project backups should live under something like:

`<YOUR_SALPAY_WORKSPACE>\backups\salpay-full-YYYYMMDD-HHMM\`

Include: `salpay.org` sources (no `node_modules`), GUI SalPay-related sources, this doc, minted-names snapshot if desired. Exclude wallet `.keys` from cloud sync if the folder is synced.
