# Apply SalPay to a separate Salvium GUI tree (Noodles)

Work only in **your** clone. Do not modify the owner's live tree.

## 1. Separate clone

```powershell
# Example paths -- change to yours
git clone https://github.com/salvium/salvium-gui.git C:\Users\noodles\salvium-gui-salpay
cd C:\Users\noodles\salvium-gui-salpay
git checkout -b feature/salpay-noodles
# Ensure nested salvium submodule/core is set up the same way your builds already work.
```

## 2. Copy sources from this handoff

From the owner's sal.cash repo (or a zip of `NOODLES-HANDOFF`):

```powershell
$handoff = "<YOUR_SALPAY_WORKSPACE>\salpay.org\salpay\wallet-integration\NOODLES-HANDOFF\sources"
$gui = "C:\Users\noodles\salvium-gui-salpay"

Copy-Item "$handoff\pages\SalPay.qml" "$gui\pages\SalPay.qml" -Force
Copy-Item "$handoff\pages\Transfer.qml" "$gui\pages\Transfer.qml" -Force
Copy-Item "$handoff\LeftPanel.qml" "$gui\LeftPanel.qml" -Force
Copy-Item "$handoff\MiddlePanel.qml" "$gui\MiddlePanel.qml" -Force
Copy-Item "$handoff\main.qml" "$gui\main.qml" -Force
Copy-Item "$handoff\src\libwalletqt\WalletManager.cpp" "$gui\src\libwalletqt\WalletManager.cpp" -Force
Copy-Item "$handoff\src\libwalletqt\WalletManager.h" "$gui\src\libwalletqt\WalletManager.h" -Force
Copy-Item "$handoff\src\libwalletqt\Wallet.cpp" "$gui\src\libwalletqt\Wallet.cpp" -Force
Copy-Item "$handoff\src\libwalletqt\Wallet.h" "$gui\src\libwalletqt\Wallet.h" -Force
if (Test-Path "$handoff\components\TxConfirmationDialog.qml") {
  New-Item -ItemType Directory -Force -Path "$gui\components" | Out-Null
  Copy-Item "$handoff\components\TxConfirmationDialog.qml" "$gui\components\TxConfirmationDialog.qml" -Force
}
# MintWizard optional
if (Test-Path "$handoff\pages\MintWizard.qml") {
  Copy-Item "$handoff\pages\MintWizard.qml" "$gui\pages\MintWizard.qml" -Force
}
```

Ensure `qml.qrc` still lists `pages/SalPay.qml` (owner tree already does).

## 3. Build

Use your normal Windows MinGW/MSVC GUI build. Example (matches owner old-layout path pattern):

```powershell
$env:Path = "C:\msys64\mingw64\bin;C:\msys64\usr\bin;" + $env:Path
cd C:\Users\noodles\salvium-gui-salpay\build\release   # or your build dir
mingw32-make -j4 salvium-wallet-gui
```

## 4. Runtime config

| Network | SalPay API base |
|---------|-----------------|
| Offline/private testnet | `http://127.0.0.1:3001` (auto when GUI nettype is testnet) |
| Production | `https://sal.cash` |

Mint fee asset: **`SAL1`**. Atomic units: **8 decimals**.

## 5. Smoke test

1. Open wallet on testnet -> daemon local or public testnet.
2. SalPay tab: mint a unique name, pay fee in SAL1.
3. Resolve name on SalPay + Send tab.
4. Send small SAL1 to that name.

## Owner isolation

| Who | Tree |
|-----|------|
| Owner (live) | `<YOUR_SALPAY_WORKSPACE>\salvium-gui` |
| Noodles | separate clone only |

If both need the same backend, they share **API URL only**, not the GUI working directory.
