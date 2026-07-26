#!/usr/bin/env bash
# Create a restorable bundle of the salpay.org server state (NO spend keys).
# Run on the VPS as root or your deploy user with sudo.
#
#   sudo bash scripts/server/backup-server-bundle.sh
# Output: /var/backups/salpay/salpay-server-YYYYMMDD-HHMMSS.tgz
set -euo pipefail

STAMP=$(date +%Y%m%d-%H%M%S)
OUT_DIR="${OUT_DIR:-/var/backups/salpay}"
mkdir -p "$OUT_DIR"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

BUNDLE="$WORK/salpay-server-$STAMP"
mkdir -p "$BUNDLE"/{env,deploy,data,treasury-view,systemd,logs}

# Locate stack
STACK=""
for d in /home/YOUR_DEPLOY_USER/salpay.org /root/salpay.org /opt/salpay.org; do
  if [[ -d "$d" ]]; then STACK="$d"; break; fi
done

if [[ -n "$STACK" ]]; then
  cp -a "$STACK/salpay/.env.server" "$BUNDLE/env/" 2>/dev/null || cp -a "$STACK/.env.server" "$BUNDLE/env/" 2>/dev/null || true
  cp -a "$STACK/salpay/deploy" "$BUNDLE/deploy/" 2>/dev/null || cp -a "$STACK/deploy" "$BUNDLE/deploy/" 2>/dev/null || true
fi

# Minted names + images (public registry state)
if [[ -f /var/lib/salpay/minted-names.json ]]; then
  cp -a /var/lib/salpay/minted-names.json "$BUNDLE/data/"
fi
if [[ -d /var/lib/salpay/name-images ]]; then
  cp -a /var/lib/salpay/name-images "$BUNDLE/data/"
fi

# View-only wallet only (never spend wallet)
if [[ -d /var/lib/salpay/treasury-view ]]; then
  cp -a /var/lib/salpay/treasury-view/*.keys "$BUNDLE/treasury-view/" 2>/dev/null || true
  # skip huge cache by default; set INCLUDE_VIEW_CACHE=1 to include
  if [[ "${INCLUDE_VIEW_CACHE:-0}" == "1" ]]; then
    cp -a /var/lib/salpay/treasury-view/treasury-view-mainnet "$BUNDLE/treasury-view/" 2>/dev/null || true
  fi
fi

cp -a /etc/systemd/system/salpay-*.service "$BUNDLE/systemd/" 2>/dev/null || true
cp -a /etc/systemd/system/salpay-*.target "$BUNDLE/systemd/" 2>/dev/null || true
cp -a /var/log/salpay "$BUNDLE/logs/" 2>/dev/null || true

# Docker compose status snapshot
docker ps --format '{{.Names}} {{.Image}} {{.Status}}' > "$BUNDLE/docker-ps.txt" 2>/dev/null || true

cat > "$BUNDLE/README-RESTORE.txt" <<'EOF'
Restore outline (new VPS):
1) Install docker + clone/copy salpay.org tree
2) Restore .env.server into salpay/.env.server
3) Restore deploy/certs if present
4) Restore /var/lib/salpay/minted-names.json + name-images
5) Restore treasury-view keys to /var/lib/salpay/treasury-view/
6) Place salvium-wallet-rpc at /opt/salvium/salvium-wallet-rpc
7) Run: sudo bash salpay/deploy/treasury-view/install-treasury-view-vps.sh
8) Run: bash salpay/scripts/server/start-server-stack.sh
9) Never put treasury SPEND keys on the public server
EOF

TGZ="$OUT_DIR/salpay-server-$STAMP.tgz"
tar -C "$WORK" -czf "$TGZ" "salpay-server-$STAMP"
chmod 600 "$TGZ"
echo "Wrote $TGZ"
ls -lh "$TGZ"
