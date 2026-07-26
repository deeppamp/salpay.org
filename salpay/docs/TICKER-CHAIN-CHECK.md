# Mainnet ticker uniqueness (how we avoid minting a taken ticker)

You need: **if a 4-char ticker is already used on chain, mint must fail** (and suggestions must not offer it).

## Layers (always, in order)

```text
1) Format + reserved
   - Exactly 4 [A-Z0-9]
   - Never SAL*, SAL1, SAL2, BURN, ...

2) SalPay registry (local / AUTHORITATIVE_*=self)
   - minted-names.json + active reservations
   - Blocks every ticker YOU already issued through SalPay
   - Suggestions always re-check this set

3) Chain / indexer (CHAIN_TICKER_CHECK_URL)
   - Blocks tickers that already exist as chain assets (when probe works)
   - Applied on quote, reserve, execute, and ticker-suggestions
```

If any layer says **taken** -> API returns **409** with free alternatives.  
Mint execute never "tries" a taken ticker successfully.

---

## Recommended settings

### Day-1 mainnet (lowest upkeep)

```bash
AUTHORITATIVE_TICKER_CHECK_URL=self
CHAIN_TICKER_CHECK_URL=stub
CHAIN_CHECK_FAIL_CLOSED=false
```

**What you get**

- No two SalPay names share a ticker  
- No reserved chain tickers (`SAL*`, `BURN`)  
- **Gap:** a ticker created on-chain *outside* SalPay (other tokens) is not seen until layer 3 works  

This is acceptable for launch if most tickers will be issued *through you*, and create_token is still rare.

### When wallet-rpc can answer token_info (preferred next step)

```bash
CHAIN_TICKER_CHECK_URL=wallet_rpc
# Optional dedicated RPC (else TREASURY_VIEW_RPC_URL / SALVIUM_RPC_URL):
CHAIN_TICKER_RPC_URL=http://127.0.0.1:29089/json_rpc
CHAIN_CHECK_FAIL_CLOSED=true
```

**Probe logic**

1. `token_info { asset_type: "ABCD" }`  
   - Result with asset data -> **taken**  
   - Clear "not found" -> **free on chain**  
2. Else `get_tokens` and scan list  
3. If methods missing and `CHAIN_CHECK_FAIL_CLOSED=true` -> **refuse mint** (safer than guessing free)

**Caveat:** some wallet builds only know tokens that wallet has seen.  
`token_info` against a well-synced node is better when the node implements a global asset table. Test on mainnet dust before setting fail-closed.

### When a public indexer exists (best long-term)

```bash
CHAIN_TICKER_CHECK_URL=https://indexer.example/ticker
# or https://indexer.example/ticker/{ticker}
CHAIN_CHECK_FAIL_CLOSED=true
```

JSON:

```json
{ "available": false, "taken": true, "exists": true, "source": "chain" }
```

Low upkeep for you: someone else indexes; you only HTTP-check.

---

## What "doesn't let us try to mint" means in code

| Step | Behavior |
|------|----------|
| `GET /api/mint/ticker-suggestions` | Only free chips after local + chain filter |
| `POST /api/mint/quote` | 409 if ticker taken |
| `POST /api/mint/reserve` | 409 if ticker taken (re-check) |
| `POST /api/mint/execute` | 409 if ticker taken (final re-check) |

So even a buggy client cannot complete mint on a taken ticker if the server is configured correctly.

---

## Practical launch plan (your low-upkeep path)

1. **Launch** with `self` + reserved list (+ stub chain).  
2. After first mainnet dust tests, probe `token_info` on your view or a hot wallet-rpc.  
3. If `token_info` is reliable -> set `wallet_rpc` + `CHAIN_CHECK_FAIL_CLOSED=true`.  
4. Later -> swap to HTTP indexer if Salvium ecosystem provides one.

You do **not** need a full mainnet node just for ticker checks if a remote RPC implements `token_info`.

---

## Related

- `REGISTRY-AND-NAME-IMAGES.md`  
- `VPS-MINIMAL-INSTALL.md`  
- `deploy/env.mainnet.example`  
