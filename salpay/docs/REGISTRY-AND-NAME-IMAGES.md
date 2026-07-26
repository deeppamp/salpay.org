# Registry uniqueness + name images

## Authoritative uniqueness (local DB + optional chain)

Mint reserve / quote / execute always:

1. Check **local** `minted-names.json` (+ active reservations for tickers).
2. Call **authoritative** hooks (`AUTHORITATIVE_NAME_CHECK_URL`, `AUTHORITATIVE_TICKER_CHECK_URL`).
3. Optionally call **chain** hooks (`CHAIN_NAME_CHECK_URL`, `CHAIN_TICKER_CHECK_URL`).

### Built-in registry (`self`)

Set both authoritative URLs to `self` (recommended for mainnet go-live):

```bash
AUTHORITATIVE_NAME_CHECK_URL=self
AUTHORITATIVE_TICKER_CHECK_URL=self
```

This uses the in-process minted DB + reservations (no HTTP self-call). Same data is also exposed over HTTP:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/registry/check?name=alice.sal` | Name available? |
| `GET /api/registry/check?ticker=ABCD` | Ticker available? |
| `GET /api/registry/name?name=` | Alias for name |
| `GET /api/registry/ticker?ticker=` | Alias for ticker |

JSON contract (for external indexers too):

```json
{ "success": true, "available": true, "exists": false, "taken": false, "source": "local_registry" }
```

Taken: `available: false` and/or `exists` / `minted` / `taken` / `found` / `reserved` true.

### Chain layer (stub for now -> live tickers on mainnet)

```bash
CHAIN_NAME_CHECK_URL=stub
CHAIN_TICKER_CHECK_URL=stub
CHAIN_CHECK_FAIL_CLOSED=false
```

`stub` always reports available and notes that on-chain indexing is not wired. When you have an indexer, point these at real HTTP URLs (same JSON contract). Set `CHAIN_CHECK_FAIL_CLOSED=true` once the indexer is required for launch.

**Mainnet product rule:** ticker availability should be verified against the **live chain** (token/asset index), not only SalPay's DB. The local DB still:

1. Stores SalPay-registered `.sal` names and resolve data  
2. Holds short-lived mint reservations (name + ticker)  
3. Blocks double-mint of the same name through SalPay  

`GET /api/mint/ticker-suggestions` filters every returned chip through local DB **and** (when configured) authoritative + live-chain checks. Wallets must never invent free tickers offline.

See also: `MULTI-WALLET-INTEGRATION.md`.

---

## Name images (NFT-style avatars) -- v1

Optional image attached at **mint reserve**, stored on the minted record, returned on **resolve**.

### Upload

`POST /api/mint/upload-image`

```json
{ "image_base64": "data:image/png;base64,...", "content_type": "image/png" }
```

Limits: PNG / JPEG / WebP, max ~512 KB (`MAX_NAME_IMAGE_BYTES`).

Response:

```json
{
  "success": true,
  "image_url": "/api/name-images/<sha256>.png",
  "image_url_absolute": "https://salpay.org/api/name-images/...",
  "image_hash": "<sha256 hex>"
}
```

Files live under `NAME_IMAGES_DIR` (default beside the names DB).

### Attach on reserve

```json
POST /api/mint/reserve
{
  "name": "alice.sal",
  "primary_address": "SC...",
  "ticker": "ALIC",
  "image_url": "/api/name-images/....png",
  "image_hash": "..."
}
```

Also accepts external `https://...` image URLs.

### Resolve

```json
GET /api/resolve/alice.sal
{
  "success": true,
  "resolved_address": "SC...",
  "image_url": "/api/name-images/...",
  "image_url_absolute": "https://...",
  "image_hash": "..."
}
```

Website mint wizard and GUI SalPay tab support pick/upload + preview on resolve/send.

### Left-panel wallet assets

After a successful mint the GUI:

1. Registers the **4-char ticker** in local settings (`salpayOwnedAssetsJson`) and merges it into the left-panel asset dropdown (with on-chain assets).
2. Syncs tickers for this wallet's primary address via `GET /api/names/by-address?address=...`.
3. Best-effort **create_token** (supply `1`, name = `.sal`, url/hash = avatar) so the ticker becomes a real chain asset with balance when HF supports it.

Until create_token confirms, the ticker still appears in the dropdown from the SalPay-owned list (balance may be 0).

### Not yet (later)

- Image update after mint  
- Transfer-tab avatar (SalPay resolve + website send show avatars in v1)  
- Auto re-create_token if user rejects the first popup
