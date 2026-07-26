# Server Bootstrap Guide (salpay.org)

This guide gets your stack running on a rented Linux VPS with Docker.

## What this includes

- Frontend container (Next.js)
- Backend container (Express API)
- Nginx reverse proxy container
- HTTPS-ready setup (self-signed bootstrap, then replace with Cloudflare Origin Cert)

## 1) Prepare the server

Run on Ubuntu VPS:

```bash
sudo bash scripts/server/bootstrap-vps.sh
```

## 2) Configure environment

Create your runtime env file:

```bash
cp .env.server.example .env.server
```

Update at minimum:

- `DOMAIN=salpay.org`
- `CORS_ALLOW_ORIGIN=https://salpay.org`
- `SALVIUM_RPC_URL=http://host.docker.internal:29088/json_rpc`

If wallet RPC is on another host, set its full URL here.

## 3) Start the stack

```bash
bash scripts/server/start-server-stack.sh
```

This starts:

- `frontend` on internal `3000`
- `backend` on internal `3001`
- `nginx` on public `80/443`

If no certs exist in `deploy/certs/`, the script generates temporary self-signed certs.

## 4) Replace temporary certs (production)

Recommended: Cloudflare Origin Certificate.

- Put certificate at `deploy/certs/fullchain.pem`
- Put private key at `deploy/certs/privkey.pem`
- Restart stack:

```bash
bash scripts/server/stop-server-stack.sh
bash scripts/server/start-server-stack.sh
```

## 5) Verify health

```bash
curl -k https://YOUR_SERVER_IP/healthz
curl -k https://YOUR_SERVER_IP/api/status
```

Expected:

- `/healthz` => `ok`
- `/api/status` => backend status JSON

## 6) Operational commands

Start:

```bash
bash scripts/server/start-server-stack.sh
```

Stop:

```bash
bash scripts/server/stop-server-stack.sh
```

Logs:

```bash
docker compose --env-file .env.server -f deploy/docker-compose.server.yml logs -f
```

## 7) Migration checklist from local

- Keep wallet RPC reachable from backend (`SALVIUM_RPC_URL`)
- Keep testnet/mainnet mode aligned with wallet daemon setup
- Confirm name resolution and send from frontend through `/api`
- Confirm Cloudflare DNS points to VPS and proxy is enabled

