# Cloudflare Checklist for sal.cash

## DNS

- `A @ -> <VPS_IP>` proxied (orange cloud)
- `A www -> <VPS_IP>` proxied
- Optional: `A api -> <VPS_IP>` proxied if you later split API domain

## SSL/TLS

- SSL mode: `Full (strict)`
- Minimum TLS: `1.2`
- Always Use HTTPS: `On`
- Automatic HTTPS Rewrites: `On`

## Certificates

- Create Cloudflare Origin Certificate for `sal.cash` and `*.sal.cash`
- Save cert as `deploy/certs/fullchain.pem`
- Save key as `deploy/certs/privkey.pem`
- Restart stack

## Security

- WAF Managed Rules: `On`
- Browser Integrity Check: `On`
- Security level: `Medium` (raise if abuse increases)
- Bot Fight Mode: `On` (or Super Bot if on paid plan)

## Rate Limits (important)

Cloudflare dashboard -> Security -> WAF -> Rate limiting rules.

Create one rule per endpoint:

### Rule 1: Send limit
- Name: `salpay send limit`
- When: `http.request.method eq "POST" and http.request.uri.path eq "/api/send"`
- Action: Block
- Rate: 10 requests per 60 seconds per IP

### Rule 2: Register limit
- Name: `salpay register limit`
- When: `http.request.method eq "POST" and http.request.uri.path eq "/api/register"`
- Action: Block
- Rate: 10 requests per 60 seconds per IP

### Rule 3: Suggest limit
- Name: `salpay suggest limit`
- When: `http.request.method eq "GET" and http.request.uri.path eq "/api/suggest"`
- Action: Block
- Rate: 120 requests per 60 seconds per IP

Note: App-side fallback limits are also active on the backend if Cloudflare rules are bypassed.

## Turnstile

Protect high-risk forms:

- Create name/register action
- Send action

Validate Turnstile token in backend before execution.

Production wiring for this repo:

- Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in `.env.server`
- Set `TURNSTILE_SECRET` in `.env.server`
- Keep `TURNSTILE_ENFORCE=true` in `.env.server`
- Set `MINT_PAYMENT_VERIFICATION_MODE=chain_proof` in `.env.server`
- Set `MINT_CHAIN_PROOF_MIN_CONFIRMATIONS` in `.env.server` (start with `0` for fast testnet UX)
- Rebuild and restart stack so frontend gets site key at build time
- Deploy from `salpay/deploy` so the compose file path is correct:
	- `cd /home/YOUR_DEPLOY_USER/salpay.org/salpay/deploy`
	- `docker compose --env-file ../.env.server -f docker-compose.server.yml up -d --build`

Important:

- The frontend widget will not render unless the image is rebuilt after the site key is added.
- The backend will still reject missing tokens if `TURNSTILE_ENFORCE=true`, which is correct.

Quick verification:

- Open page and confirm Turnstile challenge appears on Create and Send cards
- Submit without challenge: should fail with `Turnstile token is required`
- Submit after challenge: should proceed normally
- Backend runtime check: `GET /api/turnstile-config` should show `enforced_effective: true`

Mint flow requirements in current policy API:

- `/api/mint/reserve` requires `primary_address`
- `/api/mint/verify-payment` requires `reservation_id`, `amount`, `tx_hash`, and `to_address`
- `to_address` must equal the returned `treasury_address`
- In `chain_proof` mode, tx hash must be found via wallet RPC and prove destination + amount (+ confirmations if configured)
- Name becomes resolvable only after `/api/mint/execute` succeeds

## Caching

- Cache static assets aggressively
- Bypass cache for `/api/*`

## Monitoring

- Enable Cloudflare Analytics
- Watch firewall events and top blocked paths
- Alert on spikes in `/api/send` and `/api/register`

## One-command server automation

Once you are SSH'd into the server at the repo root, you can apply app-side hardening in one pass:

```bash
bash scripts/server/configure-cloudflare-hardening.sh --domain sal.cash
```

It will prompt for Turnstile site key/secret, update `.env.server`, restart stack, and show service status/logs.

Non-interactive repair + deploy (recommended when `.env.server` was edited manually and may be corrupted):

```bash
bash scripts/server/configure-cloudflare-hardening.sh --domain sal.cash --site-key <SITE_KEY> --secret <SECRET> --verification-mode chain_proof --min-confirmations 0
```

This command repairs duplicated/corrupted env key lines, applies the new values, rebuilds/restarts, and prints `/turnstile-config` checks.

## App-side fallback limits

Cloudflare edge limits should remain primary, but backend now enforces fallback per-IP limits:

- `RATE_LIMIT_SEND_PER_MINUTE` default `10`
- `RATE_LIMIT_REGISTER_PER_MINUTE` default `10`
- `RATE_LIMIT_SUGGEST_PER_MINUTE` default `120`
