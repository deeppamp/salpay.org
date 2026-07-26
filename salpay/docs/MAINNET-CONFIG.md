# Mainnet configuration (owner)

## Treasury (mint fee destination)

```
SC11aKyafJ116XJ9VG9Xt4C8hjXEpMcivH3TKwnxgkjeFcPJAJtz3v4fXXYVBMRBUX7q4iZVHqjKnML2SszqqMHk99jLdupNNb
```

Set on server:

```bash
MINT_TREASURY_ADDRESS_MAINNET=SC11aKyafJ116XJ9VG9Xt4C8hjXEpMcivH3TKwnxgkjeFcPJAJtz3v4fXXYVBMRBUX7q4iZVHqjKnML2SszqqMHk99jLdupNNb
SALPAY_NETWORK=mainnet
```

Template file: `salpay/deploy/env.mainnet.example`

## Burn (mainnet mint fee -- operator after full payment)

**User path (any wallet):** pay **100%** of the fee in one SAL1 transfer to the treasury.

**Operator path (your spend wallet, private machine):** burn **50%** of each mint fee via protocol `burn <amount> SAL1`, then attach proof.

| Step | Who | Method | Verifiable |
|------|-----|--------|------------|
| 1 | User | Full fee -> treasury SC | `chain_proof` on payment tx |
| 2 | You (ops) | Protocol BURN of 50% | `burn_tx_hash` on mint record / `/api/burns` |

```bash
MINT_BURN_PERCENT=50
MINT_BURN_KIND=protocol
MINT_USER_SPLIT_PAYMENT=false
OPS_API_KEY=<secret for your burn worker>
```

See `OPERATOR-BURN.md`. Legacy dual-leg user burn: `MINT_USER_SPLIT_PAYMENT=true` (not recommended).

## USD fee schedule (paid in SAL1)

- Cheapest: **$20** (names length  7)  
- Mid: **$35** (length 5-6)  
- Top: **$50** (length 1-4)  
- No specialty names  

See `PRICING-USDT-PEGGED.md`.

## Website (salpay.org)

Users who mint/send from the website:

1. **Register / prepare** -- reserves policy + shows fee, free ticker chips, treasury address.
2. **Pay from their own wallet** -- non-custodial (`PAYMENT_MODE=client_wallet` recommended on mainnet).
3. **Verify + execute** -- must complete via wallet GUI mint wizard or API after payment (website prepare alone does not activate resolve).
4. **Send** -- website resolves `.sal` -> address; with client_wallet it does not relay funds server-side.

Labels use **SAL1** for fee asset clarity.

## Authoritative uniqueness

```bash
AUTHORITATIVE_NAME_CHECK_URL=self
AUTHORITATIVE_TICKER_CHECK_URL=self
CHAIN_NAME_CHECK_URL=stub
CHAIN_TICKER_CHECK_URL=stub
```

`self` = built-in registry over `minted-names.json` (+ reservations).  
HTTP mirror: `/api/registry/check?name=` / `?ticker=`.  
See `REGISTRY-AND-NAME-IMAGES.md`.

## Name avatars (optional)

Mint may attach an image (upload -> `/api/name-images/...`). Resolve returns `image_url` / `image_url_absolute`.

## Related

- Full checklist: `TESTNET-SESSION-AND-MAINNET-READINESS.md`
- Registry + images: `REGISTRY-AND-NAME-IMAGES.md`
- Noodles wallet apply pack: `salpay/wallet-integration/NOODLES-HANDOFF/`
