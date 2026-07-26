# Token Creation Scripts

## Salvium binary path

Update `salvium-env.bat` if you install a newer Salvium build in a different folder.
All batch launchers now read the wallet and daemon paths from that one file.

## One-command wallet RPC

Run `start-wallet-rpc.bat` to launch `salvium-wallet-rpc.exe` for `salpaytest` on `127.0.0.1:29088`.
That script also closes other wallet processes first so the wallet file is not locked.

## Stable GUI startup (no toolchain surprises)

Use `build-and-start-gui-testnet.ps1` when you want the current source-built GUI (`v1.1.3c` tree).
It permanently avoids the silent `Error 1` compiler issue by prepending:
- `C:\msys64\mingw64\bin`
- `C:\msys64\usr\bin`

It also stops any running GUI process before linking, so you do not hit `Permission denied` on `salvium-wallet-gui.exe`.

Examples:
- Build + start current GUI testnet:
	- `powershell -NoProfile -ExecutionPolicy Bypass -File salpay\scripts\build-and-start-gui-testnet.ps1`
- Start only (skip build):
	- `powershell -NoProfile -ExecutionPolicy Bypass -File salpay\scripts\build-and-start-gui-testnet.ps1 -NoBuild`

If you want the old familiar layout exactly as before, start the classic `v1.1.1` GUI binary:
- `start-gui-classic-testnet.bat`
- or `powershell -NoProfile -ExecutionPolicy Bypass -File salpay\scripts\start-gui-classic-testnet.ps1`

## One-command wallet CLI token test

Run `create-token-cli.bat [TICKER] [SUPPLY] [NAME]` to send a `create_token` command through `salvium-wallet-cli`.
Example:
`create-token-cli.bat ALIC 1 alice.sal`

Verified CLI help from the installed wallet:
- `create_token [index=<N1>[,<N2>,...]] <ticker> <supply> [name=<name>|metadata=<metadata>|file=<metadata_file>]`
- `get_tokens [<asset_type_filter>]`
- `token_info <asset_type>`

## How to create a .sal name

1. Run `start-testnet.bat` to bring up the local testnet daemon on `127.0.0.1:29081`.
2. Run `start-wallet-rpc.bat` to bind wallet RPC on `127.0.0.1:29088`.
3. Use `mint-sal-name.bat` or `mint-name.bat` to issue the `create_token` RPC request.
4. Ticker must be exactly 4 characters.
5. Full name lives in metadata.

For CLI testing instead of wallet-RPC, use `create-token-cli.bat`.

## Verified behavior

Previously tested here: `v1.1.1` and official `v1.1.1b` start daemon and wallet RPC correctly.
However, wallet RPC currently returns `Create_token is not available yet.` for the `create_token` method.

The wallet CLI also exposes token commands in help, but on this tested setup the direct command:
`create_token ALIC 1 name=alice.sal`
returns:
`Error: create_token is not yet available`

Upstream source evidence from `salvium/salvium` shows:
- `wallet_rpc_server.h` maps `create_token` and `get_tokens`
- `wallet_rpc_server.cpp` gates `create_token` behind `m_wallet->get_current_hard_fork() < HF_VERSION_ENABLE_TOKENS`
- `simplewallet.h` declares `create_token`, `get_tokens`, and `token_info` commands for CLI

That means `.sal` minting is not just failing because of local setup. The command surface exists in both RPC and CLI, but this tested environment still reports token creation as unavailable.

## Network update note (2026-07-10)

Latest upstream releases are now `v1.1.3c` for both CLI and GUI, following network spam/hard-fork fallout fixes.

Before assuming mint behavior is unchanged, re-run this flow on `v1.1.3c`:
- start daemon + wallet RPC with `start-testnet.bat` and `start-wallet-rpc.bat`
- run `create-token-cli.bat ALIC 1 alice.sal`
- run `mint-sal-name.bat` and capture wallet RPC response

If `create_token` still reports unavailable on `v1.1.3c`, keep backend mint execute policy as the source of truth and continue using SalPay policy APIs for name lifecycle.

Later we'll connect this to the frontend.

## Policy API smoke test (mint + resolve + send)

Use this to validate the full name lifecycle before wallet integration:

1. Start backend in client wallet mode with Turnstile disabled for local smoke runs.
2. Run `node scripts/smoke-policy-api.js` from the `salpay` folder.

Recommended local env for full happy-path smoke run:
- `PAYMENT_MODE=client_wallet`
- `TURNSTILE_ENFORCE=false`
- `MINT_PAYMENT_VERIFICATION_MODE=client_attested`

Phase-2 chain-proof mode:
- Set `MINT_PAYMENT_VERIFICATION_MODE=chain_proof`.
- Smoke script will verify negative proof paths by default.
- To test positive proof in chain mode, provide a real tx hash:
	- `SALPAY_SMOKE_CHAIN_TX_HASH=<real_tx_hash> node scripts/smoke-policy-api.js`

The smoke script validates:
- reserve/quote/verify-payment/execute/status/audit
- treasury destination validation during verify-payment
- minted name resolves to intended primary address
- send resolves to minted address in client wallet mode
- register endpoint is prepare-only and does not activate names

## One-command backend deploy from Windows

Use this to push the current local `salpay/backend/index.js` to the server and restart the backend without hand-copying long SSH commands:

`powershell -ExecutionPolicy Bypass -File salpay\scripts\deploy-salpay-backend.ps1`

Defaults:
- SSH target: `deploy@YOUR_SERVER`
- Remote repo root: `/home/YOUR_DEPLOY_USER/salpay.org`

Optional examples:
- Skip image rebuild and only copy + restart:
	- `powershell -ExecutionPolicy Bypass -File salpay\scripts\deploy-salpay-backend.ps1 -SkipBuild`
- Use a different SSH target:
	- `powershell -ExecutionPolicy Bypass -File salpay\scripts\deploy-salpay-backend.ps1 -ServerHost deploy@YOUR_SERVER`

## One-command testnet routing fix from Windows

Use this to read the local `SC...` testnet address from `salpaytest.address.txt`, set both the testnet treasury and burn address to that value on the server, and restart the backend:

`powershell -ExecutionPolicy Bypass -File salpay\scripts\set-salpay-testnet-routing.ps1`

Defaults:
- SSH target: `deploy@YOUR_SERVER_IP`
- Remote repo root: `/home/YOUR_DEPLOY_USER/salpay.org`
- Burn percent: `50`

Optional example:
- `powershell -ExecutionPolicy Bypass -File salpay\scripts\set-salpay-testnet-routing.ps1 -BurnPercent 0`
