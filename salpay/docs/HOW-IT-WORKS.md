# How SalPay works (plain English)

SalPay lets people use short names like **`alice.sal`** instead of long Salvium addresses (`SC...`).

Nothing about SalPay holds your coins. **Your wallet always signs** payments. SalPay only:

1. **Registers** which name points to which address  
2. **Checks** that mint fees were paid on-chain  
3. **Answers** "what address is `alice.sal`?"

---

## Two different things people confuse

| Thing | What it is | Example |
|--------|------------|---------|
| **Name** | Human-readable handle for **sending** | `deeppamp.sal` |
| **Ticker** | 4-character label stored with the name | `DEEP` |

- Sending uses the **name**: type `deeppamp.sal` -> wallet resolves -> sends **SAL1** to that address.  
- The left-panel **asset** list is for **SAL1** (and any on-chain tokens). A ticker like `DEEP` may appear for convenience after mint, but **name send does not require a DEEP balance**.

### Warning: name != transferable asset

| Correct | Wrong |
|---------|--------|
| Pay with **Send** -> full `name.sal` -> resolve -> **SAL1** | "Send" the name/ticker as a **token asset** to give someone the name |

- A `.sal` name is a **registry entry**: name -> receiving `SC...` address (set at **mint**).  
- Sending a ticker/token from the asset list does **not** move the name and does **not** let the recipient change where payments go.  
- Anyone who later pays `name.sal` still pays the **original mint address**, not whoever holds a token.  
- Resolve always returns the **mint-time primary address** until SalPay ships an official owner "update address" flow.  
- Only mint a name to an address **you control**.  
- The SalPay wallet shows this warning on **Send** when a non-SAL1 asset is selected in the left dropdown.

### Name registry vs on-chain token balance

| Concept | What it means |
|---------|----------------|
| **Mint `.sal` name** | Registers name -> your address on sal.cash. People pay you in **SAL1** via resolve. |
| **Ticker in asset dropdown** | Label (and optional on-chain token). May show even when balance is **0**. |
| **Sendable token** | Requires successful **create_token** with a real **supply** (SalPay uses **1** whole unit). |
| **Balance 0 on ticker** | You cannot send that token. Switch to **SAL1** to spend SAL1 / pay by name. |

After mint, the wallet tries to create the ticker token with supply **1**. Confirm + password that popup if you want a sendable unit. The **name still works for receiving** even if you skip or fail create_token.

---

## Sending to a name

1. Open **Send** (or SalPay send).  
2. Type the **full** name including **`.sal`** (example: `deeppamp.sal`).  
3. Wait for resolve, or click **Resolve**.  
4. Enter amount in **SAL1** and send as usual.

**Tips**

- Type the complete name ending in `.sal` before expecting auto-resolve (partial text like `deep` is not a name).  
- If resolve fails, the name is not minted yet (or still mid-mint).  
- **Unlocked balance** is what you can spend now; the rest may be locked for a few minutes after recent receives/change (normal for Salvium).

Live check:

```http
GET https://sal.cash/api/resolve/deeppamp.sal
```

---

## Minting a name

1. Open the **SalPay** tab (wallet) or mint wizard on [sal.cash](https://sal.cash).  
2. Choose a free name + free 4-letter ticker.  
3. **Reserve** the name (locks fee + treasury address).  
4. Pay the **full fee once** in **SAL1** to the **mint treasury** (from any wallet).  
5. **Verify** payment (wallet auto-scan or paste tx hash on the website).  
6. **Execute** mint -> name is registered.  
7. After that, anyone can send to `yournname.sal`.

**Fees by name length** (USD, paid in SAL1 -- shorter costs more):

| Length (before `.sal`) | USD |
|------------------------|-----|
| 1-4 chars | **$50** |
| 5-6 chars | **$35** |
| 7+ chars | **$20** |

Exact SAL1 amount is shown when you quote/reserve (rate can move; reservation locks it).

**Payment model (mainnet today)**

- You pay **100% of the fee** to the treasury in **one** SAL1 transfer.  
- SalPay proves that deposit on-chain (`chain_proof`).  
- Operator may burn part of the fee later -- **you do not** need a burn tx while minting.

**Form fields**

- Name/ticker fields should be **empty** when you open SalPay, unless you are still mid-mint.  
- **Your .sal names** is a list of names already registered to *this* wallet address (not a stuck form field).

---

## Website vs desktop wallet

| | Website | Desktop SalPay wallet |
|--|---------|------------------------|
| Resolve name | Yes | Yes |
| Mint wizard | Yes (Turnstile security check) | Yes (signs pay in-app) |
| Holds your seed | **No** | **No** (your local wallet) |
| Pays fee | You send from *your* wallet | Same -- Confirm dialog + password |

Both use the same API: **`https://sal.cash`**.

### Website mint with your own wallet (no hot wallet on the site)

1. On [sal.cash](https://sal.cash): enter name, free ticker, and **your primary SC... address** (so the name pays *you*).  
2. Complete the security check -> **Reserve**.  
3. Copy **fee** + **treasury address**.  
4. In **your** wallet (any Salvium GUI/CLI): send that fee in **SAL1** to the treasury (Confirm + password in *your* wallet).  
5. Paste the **tx hash** on the website -> **I paid -- verify & mint**.  
6. When done, `yournname.sal` resolves for everyone.

### Desktop mint safety (SalPay GUI)

1. **Start Mint** only reserves -- does not spend.  
2. **Pay From Wallet** opens the normal transfer **Confirm** popup (amount, fee, destination).  
3. After Confirm, the wallet asks for your **password** (default: Settings -> "Ask for password before sending" = on).  
4. Only then is the fee broadcast; SalPay verifies on-chain and finishes registration.

---

## For wallet builders (Noodles, Whisky, others)

See **[WALLET-INTEGRATION-SIMPLE.md](WALLET-INTEGRATION-SIMPLE.md)** -- short API recipe for resolve + mint.

Upgrade Salvium core without losing SalPay: **[UPGRADE-AND-FORK.md](UPGRADE-AND-FORK.md)**.

---

## Status of the first mainnet name

`deeppamp.sal` is a live example:

- Resolves on the public API  
- Ticker `DEEP`  
- Used for smoke tests; it is not a special "system" name  

Anyone can mint their own name the same way.
