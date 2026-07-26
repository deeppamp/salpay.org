# Wallet GUI Fork Integration Plan

Goal: Improve UX with wallet GUI while keeping mint authorization controlled by salpay backend policy.

## Network Recovery Alignment (2026-07-10)

- Upstream latest releases are now:
  - CLI: `salvium/salvium` `v1.1.3c`
  - GUI: `salvium/salvium-gui` `v1.1.3c`
- The CLI release series around `v1.1.3x` addresses spam-attack fallout and hard-fork/network consistency issues.
- Integration work should be revalidated on `v1.1.3c` before any new feature assumptions.

Recommended fork update order:

1. Rebase or merge your private GUI fork onto upstream `v1.1.3c`.
2. Re-apply SalPay-specific changes (`main.qml`, `pages/Transfer.qml`, `pages/SalPay.qml`, `WalletManager.*`) as a focused patch set.
3. Run smoke tests for:
   - name resolve in Send tab
   - SalPay tab send flow
   - mint reserve/verify/execute/status API flow
4. Only after functional parity, continue with hardening or UI expansion.

## Principle

GUI is a client. Backend is policy authority.

Do not allow GUI-only mint bypass.

## Phase 1: Backend policy API (must exist first)

- `POST /api/mint/reserve` -> reserve normalized name
- `POST /api/mint/quote` -> pricing and expiry
- `POST /api/mint/verify-payment` -> payment status
- `POST /api/mint/execute` -> mint trigger (server-side checks)
- `GET /api/mint/status/:id` -> job status and tx hash

Each endpoint should log:

- requester metadata
- request payload
- decision result
- tx hash / failure reason

## Phase 2: GUI fork integration

Start with a resolver-only slice in the GUI fork.

First files to touch:

- [main.qml](../main.qml)
- [pages/Transfer.qml](../pages/Transfer.qml)
- [src/libwalletqt/WalletManager.h](../src/libwalletqt/WalletManager.h)
- [src/libwalletqt/WalletManager.cpp](../src/libwalletqt/WalletManager.cpp)
- [src/libwalletqt/Wallet.h](../src/libwalletqt/Wallet.h)
- [src/libwalletqt/Wallet.cpp](../src/libwalletqt/Wallet.cpp)

First implementation slice:

- Add `salpay` service config entry points and a single enable/disable flag.
- Add a resolver helper in `WalletManager` that calls Salpay and returns parsed name data.
- Wire Transfer to use that resolver helper for name lookup and verified-badge display.
- Keep direct address entry working when Salpay is unavailable.
- Leave mint reservation and execution for the next slice after resolver-only behavior is stable.

**Status:** Both slices complete and ready for testing on `feature/salpay-resolver-integration` branch (private).

Slice 1 (resolver-only): ✅ COMPLETE
- Salpay name resolution in Transfer page
- Verified badge display
- API configuration
- Fallback to manual address entry

Slice 2 (mint flow): ✅ COMPLETE
- Full MintWizard component with 4 steps
- Quote retrieval from backend
- Payment verification polling
- Mint execution and transaction display
- Wired into Transfer page UI

Implementation details: [salvium-gui/DEVELOPMENT_SUMMARY.md](salvium-gui/DEVELOPMENT_SUMMARY.md)
Testing guide: [salvium-gui/TESTING_GUIDE.md](salvium-gui/TESTING_GUIDE.md)

Then expand into mint flow:

- Add mint wizard:
  - choose name
  - show quote
  - show payment destination
  - poll verification
  - request execute
  - show tx hash
- Add send-by-name support by calling `/api/resolve/:name`
- Integration contract draft: [WALLET-GUI-INTEGRATION-CONTRACT.md](WALLET-GUI-INTEGRATION-CONTRACT.md)

## Phase 3: Hardening

- Require signed challenge from wallet session for mint execute
- Add idempotency keys for mint and send
- Add abuse and replay protections
- Add full audit export endpoint

## Security boundary

Mint is valid only when backend policy checks pass.

Examples:

- reservation exists and not expired
- payment verified to expected destination and amount
- requester identity/session valid
- name not already minted

## Rollout strategy

1. Ship backend policy API
2. Ship web UI against policy API
3. Integrate GUI fork with same API
4. Disable legacy direct mint paths
