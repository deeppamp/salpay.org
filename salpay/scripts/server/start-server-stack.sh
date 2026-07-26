#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.server"
COMPOSE_FILE="$PROJECT_DIR/deploy/docker-compose.server.yml"
CERT_DIR="$PROJECT_DIR/deploy/certs"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  echo "Copy .env.server.example to .env.server and update values first."
  exit 1
fi

mkdir -p "$CERT_DIR"

set -a
source "$ENV_FILE"
set +a

if [[ ! -f "$CERT_DIR/fullchain.pem" || ! -f "$CERT_DIR/privkey.pem" ]]; then
  echo "TLS certs not found in $CERT_DIR. Generating temporary self-signed cert..."
  openssl req -x509 -nodes -newkey rsa:2048 -days 7 \
    -keyout "$CERT_DIR/privkey.pem" \
    -out "$CERT_DIR/fullchain.pem" \
    -subj "/CN=${DOMAIN:-salpay.org}" >/dev/null 2>&1
  echo "Temporary cert created. Replace with Cloudflare Origin Certificate for production."
fi

# Prefer systemd-managed treasury view when present (boot-safe).
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q salpay-treasury-view.service; then
  echo "Ensuring treasury view-rpc is up..."
  systemctl start salpay-treasury-view.service || true
  sleep 2
fi

echo "Starting salpay server stack..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

echo
echo "Stack status:"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
echo
echo "Treasury view status (public):"
curl -fsS https://salpay.org/api/treasury-view-status 2>/dev/null || curl -fsS http://127.0.0.1/api/treasury-view-status 2>/dev/null || true
echo
