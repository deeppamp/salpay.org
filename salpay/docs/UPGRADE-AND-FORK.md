# Safe upgrades (daemon / core / GUI) without losing SalPay

When Salvium releases a new **daemon** or **wallet GUI**, follow this so you do **not** wipe SalPay settings, mint UI, or break mainnet.

## Golden rules

1. **One live tree** for mainnet: currently `salvium-gui-salpay-mainnet-v1.1.3c` (or whatever version folder is documented in `WALLET-RELEASE.md` on the build machine).
2. **Never** mix binaries: do not run a new `salviumd` with an old GUI, or a new GUI with an old core library, unless that pair is a known release tag.
3. **Never** hot-swap only a few QML files from an older tree onto a newer binary without a full rebuild.
4. **User wallet files** (`.keys`, wallet cache) live under the user's Documents / wallet directory -- they are **not** in the GUI source tree. Upgrading the app does not delete them if you leave wallet paths alone.
5. **SalPay server** (salpay.org) is separate from the GUI. API URL stays `https://salpay.org`; no need to redeploy the website for a pure client upgrade unless APIs changed.

---

## What must survive an upgrade

| Data | Where it lives | Safe on upgrade? |
|------|----------------|------------------|
| User seed / `.keys` | User wallet folder (not in git) | Yes -- leave folder alone |
| GUI settings (node, salpay URL, theme) | App config under user profile | Yes if you keep the same app id/config path |
| SalPay **minted names** | Server DB on VPS | Yes -- independent of GUI |
| SalPay **source patches** | Your GUI tree (`pages/SalPay.qml`, `WalletManager.*`, ...) | Only if you re-apply them after merging upstream |
| Treasury view wallet on VPS | `/home/.../treasury-view` | Yes -- independent of GUI |

---

## Recommended layout (build machine)

```text
salpay.org/                           this git repo (API, site, docs)  PUBLIC ok
salvium-gui-salpay-mainnet-vX.Y.Z/    ONE live GUI tree per core version
  pages/SalPay.qml                    SalPay UI (keep)
  src/libwalletqt/WalletManager.*     mint/resolve HTTP (keep)
  salvium/                            core submodule (bump tag here)
  build/release/bin/                  ship these binaries
private/                              NEVER public (treasury keys, OPS)
```

When a new Salvium version ships (e.g. `v1.1.4`):

1. **Copy or clone** a clean GUI at the new tag into a **new folder**  
   `salvium-gui-salpay-mainnet-v1.1.4` (do not delete the old folder yet).
2. **Re-apply SalPay** using either:
   - `salpay/wallet-integration/NOODLES-HANDOFF/` copy steps, or  
   - `git` cherry-pick / merge of your SalPay commits if you keep a proper fork with history.
3. Point the submodule/core to the **matching** salvium daemon tag.
4. **Full rebuild** (`mingw32-make salvium-wallet-gui` or Docker recipe in GUI README).
5. Smoke test: open existing wallet file -> SalPay resolve -> mint quote -> send by name.
6. Only then switch the launcher / release zip to the new folder.
7. Archive the old tree (do not leave two "main" exes on the desktop).

---

## Fast path if you only need a new daemon

Sometimes only `salviumd` / CLI tools change and the GUI still works:

1. Download official **matching** CLI/daemon for the same major release as your GUI.
2. Replace `salviumd` next to the GUI **only if** release notes say the RPC/protocol is compatible.
3. Do **not** replace the GUI exe with stock Salvium (stock has **no** SalPay).

If the hard fork requires a new wallet format, follow Salvium release notes; keep a backup of `.keys` first.

---

## Keeping SalPay patches easy to re-apply

Prefer one of these long-term strategies:

### A) Integration pack (simplest for now)

After each upstream bump, re-copy from `NOODLES-HANDOFF/sources/` (or your live tree) into the new GUI.  
Documented in `WALLET-INTEGRATION-SIMPLE.md` and `NOODLES-HANDOFF/APPLY.md`.

### B) Proper git fork (best for many updates)

1. Fork `salvium/salvium-gui` (and track `salvium/salvium` submodule).  
2. Keep **all** SalPay commits on a branch `feature/salpay`.  
3. Upgrade = `git fetch upstream` -> merge/rebase new tag -> resolve conflicts -> rebuild.  
4. Settings and wallets stay on disk; only code moves.

### C) Thin wallet (API only)

Web wallets / custom apps only call `https://salpay.org` (resolve + mint HTTP).  
No GUI merge pain when Salvium desktop updates -- only keep SAL1 transfer + API client working.

---

## Server upgrade (salpay.org API)

Independent of GUI:

```bash
cd salpay/deploy
# pull public repo
git pull
docker compose --env-file ../.env.server -f docker-compose.server.yml up -d --build
# treasury-view systemd unit stays; only restart if binary/wallet changed
sudo systemctl restart salpay-treasury-view.service
```

Preserve:

- `.env.server` (never in git)  
- `minted-names.json` volume/path  
- treasury-view keys under private path  

---

## Checklist before shipping a new public wallet build

- [ ] Core version matches mainnet daemon requirements  
- [ ] SalPay tab opens; resolve `deeppamp.sal` or a test name  
- [ ] Mint quote shows treasury address + fee  
- [ ] Send-by-name works  
- [ ] Settings / node preference still present after first run  
- [ ] No secrets in the zip (no `.env`, no OPS keys, no treasury `.keys`)  
- [ ] Release notes say: "SalPay-enabled build of Salvium vX.Y.Z"  

---

## What not to do

| Bad idea | Why |
|----------|-----|
| Install stock Salvium over SalPay folder | Loses SalPay UI |
| Copy only `SalPay.qml` from old tree onto new binary | ABI/API mismatch, blank tabs |
| Commit wallet seeds or treasury SVB to public git | Catastrophic if repo is public |
| Run two different version folders as "the" wallet | Users open the wrong exe forever |
