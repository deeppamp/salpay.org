#!/usr/bin/env bash
# Issue / renew Let's Encrypt cert for sal.cash using Cloudflare DNS-01.
# PRIVATE: needs a Cloudflare API token with Zone:DNS:Edit on sal.cash.
#
# Usage (on VPS as root or sudo):
#   export CF_Token='...'          # or use a credentials file
#   sudo -E bash issue-cert-cloudflare-dns.sh
#
# Credentials file alternative:
#   /etc/letsencrypt/cloudflare.ini
#     dns_cloudflare_api_token = YOUR_TOKEN
#
set -euo pipefail

DOMAIN="${DOMAIN:-sal.cash}"
EMAIL="${LETSENCRYPT_EMAIL:-}"
CRED_FILE="${CLOUDFLARE_CREDENTIALS_FILE:-/etc/letsencrypt/cloudflare.ini}"
WEBROOT_STACK="${SALPAY_DEPLOY_DIR:-/home/linuxuser/salpay.org/salpay/deploy}"
CERT_DIR="$WEBROOT_STACK/certs"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)."
  exit 1
fi

if [[ -z "$EMAIL" ]]; then
  echo "Set LETSENCRYPT_EMAIL=you@example.com"
  exit 1
fi

if [[ -n "${CF_Token:-}" ]]; then
  mkdir -p "$(dirname "$CRED_FILE")"
  umask 077
  cat >"$CRED_FILE" <<EOF
# Cloudflare DNS API token for certbot (chmod 600)
dns_cloudflare_api_token = ${CF_Token}
EOF
  chmod 600 "$CRED_FILE"
  echo "Wrote $CRED_FILE from CF_Token env"
fi

if [[ ! -f "$CRED_FILE" ]]; then
  echo "Missing $CRED_FILE"
  echo "Create a Cloudflare API token: Zone.DNS Edit on zone $DOMAIN"
  echo "Then either export CF_Token=... or write the ini file."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y certbot python3-certbot-dns-cloudflare
fi

# Ensure plugin present
if ! python3 -c "import certbot_dns_cloudflare" 2>/dev/null; then
  apt-get install -y python3-certbot-dns-cloudflare || pip3 install certbot-dns-cloudflare
fi

certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials "$CRED_FILE" \
  --dns-cloudflare-propagation-seconds 30 \
  -d "$DOMAIN" \
  -d "www.$DOMAIN" \
  --email "$EMAIL" \
  --agree-tos \
  --non-interactive \
  --keep-until-expiring

LIVE="/etc/letsencrypt/live/$DOMAIN"
if [[ ! -f "$LIVE/fullchain.pem" || ! -f "$LIVE/privkey.pem" ]]; then
  echo "Certbot finished but live certs not found under $LIVE"
  exit 1
fi

mkdir -p "$CERT_DIR"
# Copy (not symlink) so the nginx container can read without host path remaps
install -m 644 "$LIVE/fullchain.pem" "$CERT_DIR/fullchain.pem"
install -m 600 "$LIVE/privkey.pem" "$CERT_DIR/privkey.pem"
# Prefer the deploy user ownership if present
if id linuxuser >/dev/null 2>&1; then
  chown -R linuxuser:linuxuser "$CERT_DIR"
fi

echo "Installed certs into $CERT_DIR"
echo "Reload stack:"
echo "  cd $WEBROOT_STACK && docker compose --env-file ../.env.server -f docker-compose.server.yml up -d nginx"
