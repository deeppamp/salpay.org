# Privacy and secrets (public repo)

This repository is **public**. Keep operator-only data **off GitHub**.

## Never commit

| Item | Where it belongs |
|------|------------------|
| VPS IP / SSH username | Private notes / password manager only |
| SSH private keys | `~/.ssh/` on admin machines |
| `.env.server`, Turnstile secrets, `OPS_API_KEY` | Server only |
| Treasury **spend** keys / seed | Offline cold storage |
| Treasury **view-balance secret** | Password manager; env when recreating view wallet |
| Windows paths like `C:\Users\...` | Local scripts only (not in git) |
| Debug captures, wallet `.keys`, backups | Local / private disks |

## Use placeholders in public docs

```text
deploy@YOUR_SERVER_IP
YOUR_SERVER_IP
/home/YOUR_DEPLOY_USER/...
%USERPROFILE%\.ssh\...
<YOUR_SALPAY_WORKSPACE>
<PRIVATE_TREASURY_VIEW_DIR>
```

Set real values via environment variables, e.g.:

```powershell
$env:SALPAY_SSH = "deploy@..."
$env:SALPAY_LOCAL_TREASURY_DIR = "..."
$env:SALPAY_BACKUP_DIR = "..."
```

## What is OK to publish

- Public mint treasury **address** (needed for mint payments)
- Public site URL `https://salpay.org`
- Example resolved names (e.g. documentation of how resolve works)
- Generic install scripts with placeholders

## If something private was pushed

1. Remove it from the tree and push.  
2. **Rotate** any real secrets that were exposed (SSH keys, OPS API key, RPC passwords, tokens).  
3. Prefer a **history rewrite** (orphan clean tip or `git filter-repo`) + force-push when the repo has no forks depending on old SHAs.  
4. Until history is rewritten, treat exposed hostnames/IPs as known and harden the server (key-only SSH, no password login, firewall).

## Local-only private tree (recommended)

Keep operator material **outside** the public clone, for example:

```text
<sibling of repo>/private/
  treasury-view/          # view wallet keys, OPS_API_KEY.txt
  local-credentials/      # wallet-rpc .login files
  git-history-backup/     # pre-scrub git bundles (never upload)
  ssh notes / .env mirrors
```

Do **not** put that folder under the public git root.
