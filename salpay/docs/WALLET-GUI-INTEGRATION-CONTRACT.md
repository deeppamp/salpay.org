# Salpay GUI Wallet Integration Contract

Status: private working draft until launch.

## Purpose

This contract keeps the GUI wallet thin and treats Salpay as the policy authority for name resolution and minting.

The wallet should:

- resolve names through Salpay
- display verified status and mint metadata
- submit payment and mint actions through the existing wallet UX
- fall back to raw address entry if Salpay is unavailable

The wallet should not:

- mint names without Salpay policy approval
- bypass verification by using local fallback names
- depend on private server internals

## Trust boundary

- Wallet repo: UI, transport, local signing, user interaction
- Salpay server: resolve policy, mint policy, verification, fee policy, audit trail

## Mint payment asset (testnet vs mainnet)

Mint *policy* lives on the Salpay backend. Mint *payment* is a normal wallet TRANSFER of the quoted fee.

Current private/offline testnet + Salvium GUI (v1.1.x Carrot path):

- Pay mint fees in native asset **`SAL1`**
- Atomic units use **8** display decimals (`CRYPTONOTE_DISPLAY_DECIMAL_POINT = 8`)
- Wallet `createTransaction` path uses `transaction_type::TRANSFER` with `asset_type = SAL1`
- Destination addresses must be Carrot `SC...` (not legacy `SaLv...`) while Carrot is active

GUI source of truth for the forced mint payment asset:

- `salvium-gui/pages/SalPay.qml` -> `mintPaymentAssetType` (currently `"SAL1"`)

**Mainnet go-live checklist (do not skip):**

1. Confirm native spendable ticker on the live hard-fork (still `SAL1` or successor).
2. Update `mintPaymentAssetType` if the native asset name changes.
3. Re-verify fee amount units against wallet `amountFromString` / `displayAmount`.
4. Re-test Pay From Wallet end-to-end on mainnet with a small name fee.
5. Confirm treasury address network matches wallet nettype (mainnet vs testnet).
6. Mainnet treasury (owner): `SC11aKyafJ116XJ9VG9Xt4C8hjXEpMcivH3TKwnxgkjeFcPJAJtz3v4fXXYVBMRBUX7q4iZVHqjKnML2SszqqMHk99jLdupNNb` (`MINT_TREASURY_ADDRESS_MAINNET`).
7. Burn: protocol burn via GUI/CLI; keep mint fee `MINT_BURN_PERCENT=0` (100% fee to treasury) unless protocol-burn is wired into mint payment.

## Base configuration

Environment / settings needed in the wallet build:

- `SALPAY_API_BASE_URL` - production or staging API base URL
- `SALPAY_ENABLE` - feature flag to enable the integration UI
- `SALPAY_RESOLVE_ONLY` - resolver-only mode for early rollout
- optional `SALPAY_STAGING_LABEL` - label shown in the UI for non-production testing

Recommended behavior:

- default to disabled unless explicitly enabled
- use staging first
- allow a single rollback switch that hides Salpay actions from the UI

## API contract

### 1. Resolve a name

`GET /api/resolve/:name`

Expected success response:

```json
{
  "success": true,
  "name": "alice.sal",
  "source": "minted",
  "ticker": "ALIC",
  "resolved_address": "SC...",
  "records": {}
}
```

Expected not-found response:

```json
{
  "success": false,
  "error": "Name not verified by salpay service"
}
```

Wallet behavior:

- if success, populate destination field and show verified badge
- if 404, show an explicit "not verified" message
- if request fails, let user continue with manual address entry

### 2. Suggest names

`GET /api/suggest?q=ali`

Expected success response:

```json
{
  "success": true,
  "suggestions": [
    { "name": "alice.sal", "ticker": "ALIC", "resolved_address": "SC...", "source": "minted" }
  ]
}
```

Wallet behavior:

- use suggestions only as helper data
- never treat suggestions as authorization

### 3. Reserve a mint

`POST /api/mint/reserve`

Request:

```json
{
  "name": "alice.sal",
  "ticker": "ALIC",
  "primary_address": "SC..."
}
```

Response:

```json
{
  "success": true,
  "reservation_id": "...",
  "name": "alice.sal",
  "ticker": "ALIC",
  "fee": 100,
  "treasury_address": "SC...",
  "expires_at": "...",
  "ttl_seconds": 900
}
```

Wallet behavior:

- show fee, treasury, and expiry time
- surface `reservation_id` to the next step

### 4. Quote a mint

`POST /api/mint/quote`

Request by reservation:

```json
{ "reservation_id": "..." }
```

Wallet behavior:

- use quote only as display and validation data
- do not let the user proceed if the quote no longer matches the reservation

### 5. Verify payment

`POST /api/mint/verify-payment`

Request:

```json
{
  "reservation_id": "...",
  "amount": 100,
  "tx_hash": "...",
  "to_address": "SC..."
}
```

Expected responses:

- `200` with `success: true` when verification passes
- `409` when chain-proof verification fails
- `400` for malformed input
- `404` for expired or missing reservation

Wallet behavior:

- display exact failure reason from the server
- show chain-proof details if returned
- allow retry when the user changes the tx or waits for confirmations

### 6. Execute mint

`POST /api/mint/execute`

Request:

```json
{
  "reservation_id": "...",
  "idempotency_key": "..."
}
```

Expected responses:

- `200` when the mint job is accepted or reused
- `409` when payment is not verified or name already minted
- `404` when reservation is missing or expired
- `503` if the authoritative uniqueness check is unavailable and fail-closed is enabled

Wallet behavior:

- block execute until payment verification succeeded
- retry idempotently using the same key if the app reconnects

### 7. Mint status

`GET /api/mint/status/:id`

Wallet behavior:

- poll while the job is pending or until the tx hash is available
- display the final tx hash and minted name record

## Suggested UI flow

1. User types a name or address.
2. Wallet calls Salpay resolve and suggest endpoints.
3. If a name is verified, wallet fills destination and shows the verified badge.
4. If the user is minting, the wallet shows the reservation fee and treasury address.
5. User pays from their own wallet.
6. Wallet verifies payment with Salpay.
7. Wallet executes mint and polls status.

## Error handling rules

- `404` from resolve means the name is not verified by Salpay
- `503` from authoritative uniqueness checks means the wallet should retry later, not bypass
- `409` from verify/execute means the workflow is valid but blocked by policy or state
- any network failure should degrade to manual address entry rather than breaking sending entirely

## Privacy and launch rule

Keep this integration private until launch by following this rule:

- work on a private fork or private branch
- do not publish the branch until the integration is ready
- do not merge server policy changes that are still experimental into the public release branch until the wallet contract is stable

## Minimal implementation order

1. Resolve-only integration
2. Verified badge and fallback handling
3. Reserve/quote UI
4. Verify-payment polling
5. Execute/status polling
6. Final error and rollback cleanup
