# SalPay (salpay.org)

**.sal names** for Salvium — use `alice.sal` instead of a long `SC…` address.

**Live site / API:** [https://salpay.org](https://salpay.org)  
**This repo:** policy server, website, deploy tools, and wallet integration docs.  
**Windows wallet download:** [GitHub Releases](https://github.com/deeppamp/salpay.org/releases) · [how to run / sync](salpay/docs/WINDOWS-WALLET-RELEASE.md)

SalPay **never holds user spend keys**. Users always pay and send from **their own** wallet.

---

## How it works (users)

Read the plain-English guide:

→ **[`salpay/docs/HOW-IT-WORKS.md`](salpay/docs/HOW-IT-WORKS.md)**

### Send to a name

1. Type the **full** name with **`.sal`** (example: `deeppamp.sal`).  
2. Resolve → wallet fills the real `SC…` address.  
3. Send **SAL1** as usual.

```http
GET https://salpay.org/api/resolve/deeppamp.sal
```

### Mint a name

1. Pick a free name + 4-character ticker.  
2. Reserve on SalPay.  
3. Pay the **full fee once** in **SAL1** to the mint treasury.  
4. Verify on-chain → execute → name is live for everyone to send to.

Mainnet = **one treasury payment** (full fee). No user burn during mint.

### Name vs ticker vs asset

| | Meaning |
|--|---------|
| **`something.sal`** | Name for **receiving payments** |
| **Ticker (e.g. DEEP)** | Short label stored with the name |
| **SAL1 in asset list** | Spendable coin balance |

You do **not** need a separate token balance to receive as `name.sal`.

---

## For wallet developers (Noodles, Whisky, forks)

→ **[`salpay/docs/WALLET-INTEGRATION-SIMPLE.md`](salpay/docs/WALLET-INTEGRATION-SIMPLE.md)** — resolve + mint in a few API calls  

Also:

| Doc | Topic |
|-----|--------|
| [`salpay/docs/MULTI-WALLET-INTEGRATION.md`](salpay/docs/MULTI-WALLET-INTEGRATION.md) | Full API notes |
| [`salpay/wallet-integration/NOODLES-HANDOFF/`](salpay/wallet-integration/NOODLES-HANDOFF/) | Qt GUI drop-in pack |
| [`salpay/docs/UPGRADE-AND-FORK.md`](salpay/docs/UPGRADE-AND-FORK.md) | Bump Salvium daemon/GUI without losing SalPay |
| [`salpay/docs/PUBLIC-GITHUB-CHECKLIST.md`](salpay/docs/PUBLIC-GITHUB-CHECKLIST.md) | Keeping secrets out of public git |

**Minimum send integration**

```text
GET /api/resolve/{name.sal}  →  transfer SAL1 to resolved_address
```

**Minimum mint integration**

```text
reserve → user pays fee to treasury → verify-payment → execute
```

---

## What works on mainnet today

| Feature | Status |
|---------|--------|
| Resolve names | Live |
| Mint (full fee → treasury, chain_proof) | Live |
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
`salpay/docs/TREASURY-VIEW-ALWAYS-ON.md` · scripts in `salpay/deploy/treasury-view/`  
Use CLI **`carrot_keys` → view-balance secret** (not classic `viewkey`).

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
Product: [salpay.org](https://salpay.org)
