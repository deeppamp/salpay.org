# Noodles handoff — SalPay wallet integration (without touching the owner tree)

This package lets **Noodles** (or any other builder) add SalPay mint/resolve/send to **their own** Salvium GUI tree, without changing files under the owner’s live workspace.

## What’s included

```
NOODLES-HANDOFF/
  README.md                 ← this file
  sources/                  ← drop-in SalPay GUI sources (keep in sync with live mainnet tree)
    pages/SalPay.qml
    pages/Transfer.qml
    main.qml
    LeftPanel.qml
    MiddlePanel.qml
    components/StandardDropdown.qml
    js/TxUtils.js
    src/libwalletqt/WalletManager.* Wallet.*
  APPLY.md                  ← step-by-step apply guide
```

Owner’s **live mainnet** GUI (build machine):

`<YOUR_SALPAY_WORKSPACE>\salvium-gui-salpay-mainnet-v1.1.3c`

Noodles / Whisky should work in a **separate clone**, for example:

`C:\Users\noodles\salvium-gui-salpay\`

Upstream upgrades without losing SalPay: see `salpay/docs/UPGRADE-AND-FORK.md`.

## Quick path for Noodles

1. Clone Salvium GUI (or copy a clean tree) into a folder **that is not** the owner’s path.
2. Create branch `feature/salpay-noodles`.
3. Follow `APPLY.md`.
4. Point API base at owner’s backend:
   - local test: `http://127.0.0.1:3001`
   - production: `https://salpay.org`
5. Build `salvium-wallet-gui` on their machine.

## What not to do

- Do not edit the owner’s `<YOUR_SALPAY_WORKSPACE>\salvium-gui` tree.
- Do not force-push to upstream `salvium/salvium-gui` unless there is an agreed PR.
- Do not commit wallet seeds/keys.

## Mainnet constants (owner policy)

| Setting | Value |
|---------|--------|
| Fee asset | `SAL1` |
| Atomic units | `1e8` (8 decimals) |
| Mainnet treasury | `SC11aKyafJ116XJ9VG9Xt4C8hjXEpMcivH3TKwnxgkjeFcPJAJtz3v4fXXYVBMRBUX7q4iZVHqjKnML2SszqqMHk99jLdupNNb` |
| Burn | User pays **100% fee to treasury** in one SAL1 transfer. Operator burns ~50% later (`MINT_BURN_PERCENT=50`, `MINT_USER_SPLIT_PAYMENT=false`). Users do **not** BURN during mint. |
| Docs | `salpay/docs/WALLET-INTEGRATION-SIMPLE.md` |

Backend template: `salpay/deploy/env.mainnet.example` in the salpay.org repo.

## Noodles webwallet (future)

Noodles also has a **web wallet**. That is a separate integration surface from this Qt GUI pack:

1. **Short term:** this NOODLES-HANDOFF pack is for a **desktop Salvium GUI** build in his own tree.
2. **Later:** webwallet can call the same HTTP policy APIs as the website/GUI:
   - `GET /api/resolve/:name`
   - `GET /api/mint/ticker-suggestions`
   - `POST /api/mint/quote` → `reserve` → user pays treasury in wallet → `verify-payment` → `execute`
3. Owner GUI and Noodles webwallet stay independent; only the SalPay backend URL is shared.

Do not block owner GUI shipping on webwallet work.
