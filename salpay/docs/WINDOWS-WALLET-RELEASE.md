# Windows wallet download (users)

## What to download

Official SalPay-enabled Salvium GUI for **mainnet**, built on **Salvium v1.1.3c**.

| Item | Value |
|------|--------|
| Product | SalPay Wallet (Windows x64) |
| Core | Salvium GUI / daemon **v1.1.3c** |
| Latest release | **`wallet-windows-v1.1.3c-r4`** |
| Binary | `salvium-wallet-gui.exe` |
| Optional local node | `salviumd.exe` |

**GitHub Releases (latest):**  
https://github.com/deeppamp/salpay.org/releases/latest  

Asset name pattern: `SalPay-Wallet-Windows-v1.1.3c-r4-*.zip` (+ `.sha256` checksum).

## Install / run

1. Download the zip from **Releases**.  
2. Unzip to a folder you control (not a temp folder).  
3. Run **`salvium-wallet-gui.exe`**.  
4. Create or open a **mainnet** wallet.  
5. Open the **SalPay** tab for mint / send by `name.sal`.

Keep all DLLs next to the exe (do not move the exe alone).

## Syncing (should work for most users)

| Mode | Behavior |
|------|----------|
| **Local node** | Start `salviumd.exe` or use the product launcher; peers use official seeds (`seed01...` etc.). First full sync can take a long time. |
| **Remote node** | Settings -> Remote node -> official seeds (e.g. `seed01.salvium.io:19081`). Faster wallet scan; you trust that node. |

Tips:

- Wait for **unlocked** SAL1 before spending (change unlocks after confirmations).  
- If balance is 0 while "syncing," wait until the wallet finishes scanning.  
- Prefer one official build; don't mix with older Salvium GUI folders.

## Mint / send (short)

See [HOW-IT-WORKS.md](HOW-IT-WORKS.md).

- **Send:** type full `alice.sal` -> resolve -> send SAL1.  
- **Mint (GUI):** Start Mint -> Pay From Wallet -> **Confirm** -> **password** -> wait for verify.  
- **Mint (website):** https://sal.cash -- reserve, pay from **your** wallet, paste tx hash.

## Security

- Never share seed / `.keys`.  
- SalPay servers never receive your password.  
- Website mint never holds your keys.

## Builders / other wallets

[WALLET-INTEGRATION-SIMPLE.md](WALLET-INTEGRATION-SIMPLE.md)
