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
- **`sal_usd_rate`** comes from **CoinGecko** by default (`ids=salvium`), cached ~5 minutes  
- Fallback: `SAL_USD_MANUAL_RATE` if the oracle is down  
- `FEE_USD_BUFFER_PERCENT` default `3`  
- Fee is **locked on the reservation** at quote/reserve time (wallet only pays that locked SAL amount)  

### Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `SAL_USD_PRICE_SOURCE` | `auto` | `auto` / `coingecko` / `manual` |
| `COINGECKO_COIN_ID` | `salvium` | CoinGecko coin id |
| `SAL_USD_MANUAL_RATE` | (ops) | Fallback USD per 1 SAL1 |
| `FEE_USD_BUFFER_PERCENT` | `3` | Extra % on SAL amount |
| `SAL_USD_RATE_CACHE_MS` | `300000` | How often to re-fetch |

Public check: `GET /api/price/sal` (examples of $20 / $35 / $50 in SAL1).

**Wallet / website do not call CoinGecko.** They call SalPay quote/reserve and use the returned `fee`.

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
