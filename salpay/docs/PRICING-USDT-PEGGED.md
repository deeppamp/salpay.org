# Mint pricing (USD, paid in SAL1) — locked policy

## USD range (no specialty names)

| Name length (before `.sal`) | USD fee |
|-----------------------------|---------|
| 7+ characters | **$20** (cheapest tier) |
| 5–6 characters | **$35** |
| 1–4 characters | **$50** (top tier) |

No dictionary / specialty multipliers for launch.

## Paid in SAL1

```
fee_sal = ceil_2dp( (fee_usd / sal_usd_rate) * (1 + buffer%) )
```

- `FEE_CURRENCY=usd` on mainnet  
- `SAL_USD_MANUAL_RATE` = USD per 1 SAL1 (ops updates rate; oracle later)  
- `FEE_USD_BUFFER_PERCENT` default `3`  
- Fee is **locked on the reservation** at quote/reserve time  

Testnet keeps fixed SAL tiers (`FEE_CURRENCY=sal`): 100 / 500 / 2000.

## Payment split (mainnet)

| Leg | Share | How |
|-----|-------|-----|
| Treasury | 50% | SAL1 **transfer** to `MINT_TREASURY_ADDRESS_MAINNET` |
| Burn | 50% | SAL1 **protocol BURN** (`transaction_type::BURN`) — verifiable on-chain |

Configured via:

```bash
MINT_BURN_PERCENT=50
MINT_BURN_KIND=protocol
```

Verify requires:

- `tx_hash` / `treasury_tx_hash` — treasury transfer  
- `burn_tx_hash` — protocol burn  

GUI auto-opens treasury transfer then protocol burn when burn half is present. Website accepts both hashes.

## On-chain adherence notes

1. Fee amounts come only from backend policy (quote/reserve), never client-invented.  
2. Treasury address is server-configured SC Carrot address.  
3. Burn is not a fake address — real protocol burn.  
4. Name activation still requires payment verify + execute; execute may still use policy `sim_…` until real `create_token` HF path is live (separate from fee policy).  
5. Salvium may disable BURN until token HF — mainnet must be on a fork where CLI `burn <amount> SAL1` works.

See also: `MAINNET-CONFIG.md`, `deploy/env.mainnet.example`.
