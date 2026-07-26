# salpay resolver backend

Resolver API for `.sal` names with dynamic RPC lookup, fallback records, and a starter registration endpoint.

## Run locally

```bash
npm install
npm start
```

Server defaults to `http://localhost:3001`.

## Endpoints

- `GET /status`
- `GET /resolve/:name`
- `POST /register`
- `POST /api/mint/reserve`
- `POST /api/mint/quote`
- `POST /api/mint/verify-payment`
- `POST /api/mint/execute`
- `GET /api/mint/status/:id`
- `GET /api/mint/audit`
- `GET /api/name-policy`

## Environment variables

- `PORT` (optional): default `3001`
- `SALVIUM_RPC_URL` (optional): default `http://127.0.0.1:29088/json_rpc`
- `SALPAY_NETWORK` (optional): `testnet`, `mainnet`, or `stagenet` (default `testnet`)
- `MINT_TREASURY_ADDRESS_TESTNET` (recommended): treasury for testnet deploys
- `MINT_TREASURY_ADDRESS_MAINNET` (recommended): treasury for mainnet deploys
- `MINT_TREASURY_ADDRESS_STAGENET` (optional): treasury for stagenet deploys
- `MINT_TREASURY_ADDRESS` (fallback): used when network-specific variable is not set
- `MINT_BURN_PERCENT` (optional): percentage of mint fee to route to a burn payment destination (0-100, default `0`). **Recommended mainnet: `0`** -- use Salvium protocol burn (GUI/CLI) for intentional burns instead of a synthetic burn address.
- `MINT_BURN_ADDRESS` (required only when `MINT_BURN_PERCENT > 0`)
- `MINT_RESERVATION_TTL_SECONDS` (optional): default `900`
- `MINT_PAYMENT_VERIFICATION_MODE` (optional): `client_attested` or `chain_proof` (default `client_attested`)
- `MINT_CHAIN_PROOF_MIN_CONFIRMATIONS` (optional): default `1`
- `AUTHORITATIVE_NAME_CHECK_URL` (optional): authoritative availability API for names (supports `{name}` placeholder)
- `AUTHORITATIVE_NAME_CHECK_FAIL_CLOSED` (optional): default `true`
- `AUTHORITATIVE_NAME_CHECK_TIMEOUT_MS` (optional): default `2500`
- `AUTHORITATIVE_TICKER_CHECK_URL` (optional): authoritative availability API for tickers (supports `{ticker}` placeholder)
- `AUTHORITATIVE_TICKER_CHECK_FAIL_CLOSED` (optional): default `true`
- `AUTHORITATIVE_TICKER_CHECK_TIMEOUT_MS` (optional): default `2500`
- `MAINNET_STRICT_GUARDS` (optional): default `true`; when `SALPAY_NETWORK=mainnet`, backend requires `chain_proof` mode and authoritative name/ticker checks
- `TURNSTILE_ENFORCE` (optional): set `true` to require Turnstile tokens on send/register and mint policy endpoints
- `TURNSTILE_SECRET` (required when `TURNSTILE_ENFORCE=true`)
- `RATE_LIMIT_SEND_PER_MINUTE` (optional): default `10`
- `RATE_LIMIT_REGISTER_PER_MINUTE` (optional): default `10`
- `RATE_LIMIT_SUGGEST_PER_MINUTE` (optional): default `120`

## Register payload

`POST /register` expects:

```json
{
	"name": "myname.sal",
	"ticker": "MYNM"
}
```

`primary_address` is optional. If omitted, backend attempts to read the wallet primary address from `SALVIUM_RPC_URL` via `get_address` and includes it in the response.

With command execution disabled (default), it writes metadata and returns the next mint command.

## Mint policy flow

The backend now supports a policy-authoritative mint flow with an in-memory audit trail:

1. `POST /api/mint/reserve` with `name` and optional `ticker`
2. `POST /api/mint/quote` with either `reservation_id` or `name`
3. `POST /api/mint/verify-payment` with `reservation_id`, `amount`, and optional `tx_hash`
4. `POST /api/mint/execute` with `reservation_id` and optional `idempotency_key`
5. `GET /api/mint/status/:id` to fetch completion state and tx hash

Use `GET /api/mint/audit` to inspect recent decisions and request metadata while developing.

Name validation policy:
- `GET /api/name-policy` returns the canonical `.sal` naming rule and fee tiers used by the backend.
- SalPay policy currently allows `1-63` lowercase letters/digits/hyphens before `.sal`.
- Names must start and end with a letter or digit.

Payment routing behavior:
- The backend returns `payment_outputs` for quote/reserve responses.
- With `MINT_BURN_PERCENT=0`, `payment_outputs` contains one treasury destination.
- With burn enabled (for example `50`), `payment_outputs` contains treasury and burn destinations that sum to the full fee.
- `verify-payment` accepts `outputs` for split payments and validates exact address+amount matches.

## Deploy on Render

1. Create a new Web Service from this repository.
2. Root directory: `salpay/backend`.
3. Build command: `npm install`.
4. Start command: `npm start`.
5. Add env vars as needed (`SALVIUM_RPC_URL`, `MINT_TREASURY_ADDRESS`, optional Turnstile settings).

The included `render.yaml` supports the same setup.

## Deploy on Railway

1. Create a new Railway project from this repository.
2. Set service root to `salpay/backend`.
3. Railway can use `npm start` directly, or the included `Dockerfile`.
4. Add env vars (`SALVIUM_RPC_URL`, `MINT_TREASURY_ADDRESS`, optional Turnstile settings).
5. After deploy, point frontend `NEXT_PUBLIC_RESOLVER_URL` to the Railway URL.
