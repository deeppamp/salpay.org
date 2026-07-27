# Domain cutover: salpay.org -> sal.cash

## What Whisky already did (GitHub `main`)

1. **Tamper-evident public audit log** for registry events (`0fb3afe`).
2. **Domain sweep** to `sal.cash` in product URLs/docs/examples (`d971987`).

Intentionally **kept** as `salpay.org`:

- GitHub repo path `github.com/deeppamp/salpay.org`
- Go module paths `github.com/deeppamp/salpay.org/...`
- Local folder names like `salpay.org/` on disk

## What is still operator work (not in git)

| Item | Status (checked 2026-07-27) |
|------|-----------------------------|
| Code/docs on GitHub use `https://sal.cash` | Done (Whisky) |
| Cloudflare DNS for `sal.cash` / `www` | **Not resolving yet** (no A/AAAA from VPS or this PC) |
| VPS `.env.server` `DOMAIN` / CORS / public URLs | Still `salpay.org` |
| Origin TLS cert SAN | Still `salpay.org` / `*.salpay.org` only |
| Certbot on VPS | Not installed |
| Wallet GUI binary hardcodes API host | Still points at salpay.org until rebuild |
| Cloudflare Turnstile hostnames | Must add `sal.cash` in CF dashboard |

## Recommended cert approach (matches your stack)

Your deploy mounts `deploy/certs/*.pem` into nginx. Two good options:

### A) Cloudflare Origin Certificate (fastest; matches CLOUDFLARE-CHECKLIST)

1. Cloudflare -> sal.cash zone -> SSL/TLS -> Origin Server -> Create certificate  
   - Hostnames: `sal.cash`, `*.sal.cash`  
2. Save as `deploy/certs/fullchain.pem` + `privkey.pem` on the VPS  
3. SSL/TLS mode: **Full (strict)**  
4. Restart nginx container  

No Let's Encrypt needed if traffic always goes through Cloudflare proxy (orange cloud).

### B) Let's Encrypt + Cloudflare DNS plugin (public CA)

Script in repo:

`salpay/scripts/server/issue-cert-cloudflare-dns.sh`

Needs:

1. DNS zone for `sal.cash` in Cloudflare with records for `@` and `www` (can be proxied).  
2. Cloudflare API token: **Zone -> DNS -> Edit** on `sal.cash` only.  
3. On VPS:

```bash
export LETSENCRYPT_EMAIL='you@example.com'
export CF_Token='...'   # do not commit
sudo -E bash /home/linuxuser/salpay.org/salpay/scripts/server/issue-cert-cloudflare-dns.sh
cd /home/linuxuser/salpay.org/salpay/deploy
docker compose --env-file ../.env.server -f docker-compose.server.yml up -d nginx
```

## DNS checklist (do this first)

In Cloudflare for zone **sal.cash**:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `@` | VPS public IPv4 | Proxied (orange) |
| AAAA | `@` | VPS public IPv6 (optional) | Proxied |
| A | `www` | same as `@` | Proxied |
| CNAME or A | `www` | `@` or same IP | Proxied |

Verify:

```bash
dig +short sal.cash A
curl -sI https://sal.cash | head
```

## VPS env flip (after DNS works)

Edit `/home/linuxuser/salpay.org/salpay/.env.server` (private):

```bash
DOMAIN=sal.cash
CORS_ALLOW_ORIGIN=https://sal.cash
PUBLIC_API_BASE_URL=https://sal.cash
# keep NEXT_PUBLIC_API_BASE_URL=/api
```

Optional during cutover (both origins):

```bash
CORS_ALLOW_ORIGIN=https://sal.cash,https://salpay.org
```

Then rebuild/restart (frontend may need rebuild if any absolute URLs were baked):

```bash
cd /home/linuxuser/salpay.org/salpay/deploy
docker compose --env-file ../.env.server -f docker-compose.server.yml up -d --build
```

## Wallet GUI

Handoff sources on GitHub now say `sal.cash`. Published Windows **r4** binary still uses the previous default API host until you rebuild/publish **r5**.

## Cloudflare agent setup note

`https://developers.cloudflare.com/agent-setup/prompt.md` installs **Cloudflare Skills/MCP** for AI tools (Claude/Cursor/etc.). That is separate from Let's Encrypt. Useful for managing CF via AI, but certs still need DNS + Origin cert or certbot + API token as above.

## Share links after cutover

- Site: `https://sal.cash`  
- GitHub (repo name stays): `https://github.com/deeppamp/salpay.org`  
- Wallet release: `https://github.com/deeppamp/salpay.org/releases/latest`  
