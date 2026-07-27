# Domain cutover: sal.cash (complete)

Public product domain is **https://sal.cash**.

## Intentionally still named `salpay.org` (not the website)

These are **repo / path** names, not the live site:

- GitHub repository: `github.com/deeppamp/salpay.org`
- Go module imports: `github.com/deeppamp/salpay.org/...`
- Local / VPS directory names (e.g. `~/salpay.org/`) — renaming folders is optional and breaks scripts until updated

## Live product

| Item | Status |
|------|--------|
| Site + API | `https://sal.cash` |
| Docs / examples / wallet handoff defaults | `https://sal.cash` |
| Turnstile | Keys + enforce on VPS for sal.cash |
| Origin TLS | SAN `sal.cash` / `*.sal.cash` |
| DNS | A records for `@` and `www` → VPS (proxied) |
| Nginx | Serves `sal.cash`; redirects legacy `salpay.org` → `sal.cash` |

## Migration note (legacy hostname)

Visitors and old bookmarks on **salpay.org** should land on **sal.cash** via Cloudflare + nginx redirect. New wallets and docs use **sal.cash only**.

Wallet GUI: default API base is `https://sal.cash`. Builds that still had `https://salpay.org` saved in settings should auto-migrate to `sal.cash` on mainnet.

## Operator paths (disk names unchanged)

```bash
cd /home/linuxuser/salpay.org/salpay/deploy
docker compose --env-file ../.env.server -f docker-compose.server.yml up -d --build
```

## Share links

- Site: https://sal.cash  
- GitHub (repo path stays): https://github.com/deeppamp/salpay.org  
- Wallet release (download name **sal.cash-Wallet-…**): https://github.com/deeppamp/salpay.org/releases/latest  

Public GitHub **description / homepage / release titles / download filenames** use **sal.cash**. The repository slug `salpay.org` is unchanged so history, clones, and Go module paths keep working.
