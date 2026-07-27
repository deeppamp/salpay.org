# SalPay (sal.cash)

**.sal names** for Salvium -- use `alice.sal` instead of a long `SC...` address.

**Live site / API:** [https://sal.cash](https://sal.cash)  
**This repo:** policy server, website, deploy tools, and wallet integration docs.  
**Windows wallet download:** [Latest release (v1.1.3c-r5)](https://github.com/deeppamp/salpay.org/releases/latest) | [how to run / sync](salpay/docs/WINDOWS-WALLET-RELEASE.md)

SalPay **never holds user spend keys**. Users always pay and send from **their own** wallet.

---

> ## WARNING -- Read before using names
>
> ### Pay people with **Send -> `name.sal` -> SAL1**. Do **not** "send the name" as a token/asset.
>
> | Do this | Not this |
> |---------|----------|
> | Type **`alice.sal`** in Send, resolve, send **SAL1** | Pick a ticker (e.g. `DEEP`) in the **asset dropdown** and send that token to "give them the name" |
>
> **Why:** A `.sal` name is a **registry pointer** to the **receiving address set at mint**.  
> Transferring a ticker/token does **not** transfer the name.  
> The person who receives that token **cannot** change where `name.sal` pays.  
> Anyone who later pays **`name.sal`** still sends funds to the **original mint address** (original owner), not to whoever holds the token.
>
> **Only mint a name to a wallet address you control and plan to keep for receiving.**
>
> **Name vs token balance:** Minting a `.sal` name registers the name for **receiving SAL1**.  
> The 4-letter ticker may also appear in the wallet asset list. That list entry is **not** the same as "owning a sendable name."  
> A **sendable** on-chain token needs `create_token` with a real supply (SalPay uses supply **1** whole unit).  
> If the ticker shows **balance 0**, you cannot send that token -- switch the dropdown to **SAL1** to pay people (including by `name.sal`).  
> Paying `alice.sal` always spends **your SAL1**, never a zero ticker balance.

---

## Name mint fees (mainnet)

Fees are priced in **USD** and paid in **SAL1**. **Shorter names cost more.** Length = characters **before** `.sal` (so `alice.sal` is length **5**).

| Name length | Examples | USD fee |
|-------------|----------|---------|
| **1-4** characters | `ab.sal`, `sal.sal`, `deep.sal` | **$50** |
| **5-6** characters | `alice.sal`, `bob123.sal` | **$35** |
| **7+** characters | `deeppamp.sal`, `my-cool-name.sal` | **$20** |

### How payment works

1. **One payment only** -- you send the **full fee once** in **SAL1** to the mint treasury.  
2. No second tx, no burn step for you while minting.  
3. The wallet/website shows the exact **SAL1 amount** at quote/reserve time.  
4. **USD -> SAL1** is computed on the **SalPay server** using the live **CoinGecko** SAL price (with a small buffer), cached a few minutes. If CoinGecko is down, a manual fallback rate is used. Your wallet never talks to CoinGecko.  
5. That SAL1 amount is **locked on your reservation** so it does not change while you pay.  
6. After on-chain verify, the name is registered and anyone can send to `yournname.sal`.

There are **no specialty / dictionary surcharges** at launch -- only the length table above.

**Ticker** (4 characters, e.g. `DEEP`) is chosen at mint and is free; it does not change the fee.

Live rate check: `GET https://sal.cash/api/price/sal` (after deploy).

---

## How it works (users)

More detail: **[`salpay/docs/HOW-IT-WORKS.md`](salpay/docs/HOW-IT-WORKS.md)** | pricing notes: **[`salpay/docs/PRICING-USDT-PEGGED.md`](salpay/docs/PRICING-USDT-PEGGED.md)**

### Send to a name

1. Type the **full** name with **`.sal`** (example: `deeppamp.sal`).  
2. Resolve -> wallet fills the real `SC...` address.  
3. Send **SAL1** as usual.

```http
GET https://sal.cash/api/resolve/deeppamp.sal
```

### Mint a name

1. Pick a free name + 4-character ticker.  
2. Reserve on SalPay (see fee table above).  
3. Pay the **full fee once** in **SAL1** to the mint treasury.  
4. Verify on-chain -> execute -> name is live for everyone to send to.

Mainnet = **one treasury payment** (full fee). No user burn during mint.

### Name vs ticker vs asset

| | Meaning |
|--|---------|
| **`something.sal`** | Name for **receiving payments** |
| **Ticker (e.g. DEEP)** | Short label stored with the name |
| **SAL1 in asset list** | Spendable coin balance |

You do **not** need a separate token balance to receive as `name.sal`.

### Name vs asset (summary)

Same rule as the **warning at the top of this page**: pay with **SAL1** to a resolved `name.sal`. Sending a ticker asset does not reassign the name or the receive address. Details: [`HOW-IT-WORKS.md`](salpay/docs/HOW-IT-WORKS.md).

---

## For wallet developers (Noodles, Whisky, forks)

-> **[`salpay/docs/WALLET-INTEGRATION-SIMPLE.md`](salpay/docs/WALLET-INTEGRATION-SIMPLE.md)** -- resolve + mint in a few API calls  

Also:

| Doc | Topic |
|-----|--------|
| [`salpay/docs/MULTI-WALLET-INTEGRATION.md`](salpay/docs/MULTI-WALLET-INTEGRATION.md) | Full API notes |
| [`salpay/wallet-integration/NOODLES-HANDOFF/`](salpay/wallet-integration/NOODLES-HANDOFF/) | Qt GUI drop-in pack |
| [`salpay/docs/UPGRADE-AND-FORK.md`](salpay/docs/UPGRADE-AND-FORK.md) | Bump Salvium daemon/GUI without losing SalPay |
| [`salpay/docs/PUBLIC-GITHUB-CHECKLIST.md`](salpay/docs/PUBLIC-GITHUB-CHECKLIST.md) | Keeping secrets out of public git |

**Minimum send integration**

```text
GET /api/resolve/{name.sal}  ->  transfer SAL1 to resolved_address
```

**Minimum mint integration**

```text
reserve -> user pays fee to treasury -> verify-payment -> execute
```

---

## What works on mainnet today

| Feature | Status |
|---------|--------|
| Resolve names | Live |
| Mint (full fee -> treasury, chain_proof) | Live |
| Website mint wizard | Live |
| Public treasury balance | Live |
| Example name `deeppamp.sal` | Resolves (ticker DEEP) |

---

## Operators (run the server)

```bash
cd salpay/deploy
cp env.mainnet.example ../.env.server   # fill secrets off-repo only
docker compose --env-file ../.env.server -f docker-compose.server.yml up -d --build
```

Treasury view (required for chain_proof):  
`salpay/docs/TREASURY-VIEW-ALWAYS-ON.md` | scripts in `salpay/deploy/treasury-view/`  
Use CLI **`carrot_keys` -> view-balance secret** (not classic `viewkey`).

Env template: [`salpay/deploy/env.mainnet.example`](salpay/deploy/env.mainnet.example)

---

## Repo layout

```
salpay/
  backend/              Node API (mint, resolve, ops)
  frontend/             Next.js site
  deploy/               Docker, nginx, treasury-view
  docs/                 User + developer + ops docs
  scripts/              Helpers (no secrets)
  wallet-integration/   Third-party GUI handoff
```

---

## Security / privacy

- Do **not** commit `.env.server`, OPS keys, view-balance secrets, wallet `*.keys`, or real VPS IPs/usernames  
- Operator privacy guide: [`salpay/docs/PRIVACY.md`](salpay/docs/PRIVACY.md)  
- Server treasury is **view-only**  
- Ops endpoints require `OPS_API_KEY`  
- Mainnet starts only with chain_proof + Turnstile + treasury view (strict mode)

---

## License / contact

See repository history and Salvium upstream where applicable.  
Product: [sal.cash](https://sal.cash)
