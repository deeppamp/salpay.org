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

## Payment model (mainnet — what users do)

| Who | What |
|-----|------|
| **You (minter)** | Pay **100% of the fee** in **one** SAL1 transfer to the mint treasury |
| **Operator (later)** | May burn ~50% of fees from treasury ops — **not** part of your mint flow |

Default env: `MINT_USER_SPLIT_PAYMENT=false` (full treasury).  
`MINT_BURN_PERCENT=50` + `MINT_BURN_KIND=protocol` is operator-side policy, not a second user payment.

Verify requires the **treasury** payment tx hash only (chain_proof).

## On-chain adherence notes

1. Fee amounts come only from backend policy (quote/reserve), never client-invented.  
2. Treasury address is server-configured SC Carrot address.  
3. Burn is not a fake address — real protocol burn.  
4. Name activation still requires payment verify + execute; execute may still use policy `sim_…` until real `create_token` HF path is live (separate from fee policy).  
5. Salvium may disable BURN until token HF — mainnet must be on a fork where CLI `burn <amount> SAL1` works.

See also: `MAINNET-CONFIG.md`, `deploy/env.mainnet.example`.
