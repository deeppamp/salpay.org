#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_EXAMPLE="$PROJECT_DIR/.env.server.example"
ENV_FILE="$PROJECT_DIR/.env.server"
COMPOSE_FILE="$PROJECT_DIR/deploy/docker-compose.server.yml"

DOMAIN_VALUE=""
SITE_KEY_VALUE=""
SECRET_VALUE=""
VERIFICATION_MODE_VALUE="chain_proof"
MIN_CONFIRMATIONS_VALUE="1"
NO_RESTART="false"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/server/configure-cloudflare-hardening.sh [options]

Options:
  --domain <domain>       Domain value for DOMAIN and CORS_ALLOW_ORIGIN
  --site-key <key>        Cloudflare Turnstile site key (public)
  --secret <secret>       Cloudflare Turnstile secret key (server-side)
  --verification-mode <m> Mint payment verification mode: client_attested|chain_proof
  --min-confirmations <n> Minimum confirmations in chain_proof mode
  --no-restart            Update env only, do not restart stack
  --help                  Show this help

Examples:
  bash scripts/server/configure-cloudflare-hardening.sh --domain salpay.org
  bash scripts/server/configure-cloudflare-hardening.sh --domain salpay.org --site-key <SITE_KEY> --secret <SECRET> --verification-mode chain_proof --min-confirmations 1
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN_VALUE="${2:-}"
      shift 2
      ;;
    --site-key)
      SITE_KEY_VALUE="${2:-}"
      shift 2
      ;;
    --secret)
      SECRET_VALUE="${2:-}"
      shift 2
      ;;
    --verification-mode)
      VERIFICATION_MODE_VALUE="${2:-}"
      shift 2
      ;;
    --min-confirmations)
      MIN_CONFIRMATIONS_VALUE="${2:-}"
      shift 2
      ;;
    --no-restart)
      NO_RESTART="true"
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ "$VERIFICATION_MODE_VALUE" != "client_attested" && "$VERIFICATION_MODE_VALUE" != "chain_proof" ]]; then
  echo "--verification-mode must be one of: client_attested, chain_proof"
  exit 1
fi

if ! [[ "$MIN_CONFIRMATIONS_VALUE" =~ ^[0-9]+$ ]]; then
  echo "--min-confirmations must be a non-negative integer"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$ENV_EXAMPLE" ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo "Created $ENV_FILE from .env.server.example"
  else
    echo "Missing $ENV_FILE and $ENV_EXAMPLE"
    exit 1
  fi
fi

cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"

if [[ -z "$DOMAIN_VALUE" ]]; then
  current_domain="$(grep -E '^DOMAIN=' "$ENV_FILE" | head -n1 | cut -d= -f2- || true)"
  read -r -p "Domain [$current_domain]: " input_domain
  DOMAIN_VALUE="${input_domain:-$current_domain}"
fi

if [[ -z "$DOMAIN_VALUE" ]]; then
  echo "Domain is required."
  exit 1
fi

if [[ -z "$SITE_KEY_VALUE" ]]; then
  current_site_key="$(grep -E '^NEXT_PUBLIC_TURNSTILE_SITE_KEY=' "$ENV_FILE" | head -n1 | cut -d= -f2- || true)"
  read -r -p "Turnstile site key [${current_site_key:-unset}]: " input_site_key
  SITE_KEY_VALUE="${input_site_key:-$current_site_key}"
fi

if [[ -z "$SECRET_VALUE" ]]; then
  current_secret="$(grep -E '^TURNSTILE_SECRET=' "$ENV_FILE" | head -n1 | cut -d= -f2- || true)"
  if [[ -n "$current_secret" ]]; then
    read -r -s -p "Turnstile secret [stored value exists, press Enter to keep]: " input_secret
    echo
    SECRET_VALUE="${input_secret:-$current_secret}"
  else
    read -r -s -p "Turnstile secret: " input_secret
    echo
    SECRET_VALUE="$input_secret"
  fi
fi

if [[ -z "$SITE_KEY_VALUE" || -z "$SECRET_VALUE" ]]; then
  echo "Both Turnstile site key and secret are required."
  exit 1
fi

if [[ "$SITE_KEY_VALUE" =~ PASTE_REAL|YOUR_REAL|YOUR_TURNSTILE|PUT_REAL|REAL_SITE_KEY|SITE_KEY_HERE|CHANGEME|YOUR_ACTUAL_TURNSTILE_SITE_KEY|REAL_CLOUDFLARE_SITE_KEY ]]; then
  echo "Turnstile site key still looks like a placeholder. Provide a real site key."
  exit 1
fi

if [[ "$SECRET_VALUE" =~ PASTE_REAL|YOUR_REAL|YOUR_TURNSTILE|PUT_REAL|REAL_SECRET|SECRET_HERE|CHANGEME|YOUR_ACTUAL_TURNSTILE_SECRET|REAL_CLOUDFLARE_SECRET ]]; then
  echo "Turnstile secret still looks like a placeholder. Provide a real secret."
  exit 1
fi

set_env_value() {
  local key="$1"
  local value="$2"

  # Repair mode: remove all existing key lines (including corrupted previous replacements), then append one clean value.
  sed -i "/^${key}=/d" "$ENV_FILE"
  printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
}

set_env_value "DOMAIN" "$DOMAIN_VALUE"
set_env_value "CORS_ALLOW_ORIGIN" "https://${DOMAIN_VALUE}"
set_env_value "NEXT_PUBLIC_API_BASE_URL" "/api"
set_env_value "NEXT_PUBLIC_TURNSTILE_SITE_KEY" "$SITE_KEY_VALUE"
set_env_value "TURNSTILE_SECRET" "$SECRET_VALUE"
set_env_value "TURNSTILE_ENFORCE" "true"
set_env_value "MINT_PAYMENT_VERIFICATION_MODE" "$VERIFICATION_MODE_VALUE"
set_env_value "MINT_CHAIN_PROOF_MIN_CONFIRMATIONS" "$MIN_CONFIRMATIONS_VALUE"
set_env_value "RATE_LIMIT_SEND_PER_MINUTE" "10"
set_env_value "RATE_LIMIT_REGISTER_PER_MINUTE" "10"
set_env_value "RATE_LIMIT_SUGGEST_PER_MINUTE" "120"

echo
echo "Updated $ENV_FILE with Cloudflare hardening values."
echo

echo "Current security values:"
grep -E '^(DOMAIN|CORS_ALLOW_ORIGIN|NEXT_PUBLIC_API_BASE_URL|NEXT_PUBLIC_TURNSTILE_SITE_KEY|TURNSTILE_ENFORCE|MINT_PAYMENT_VERIFICATION_MODE|MINT_CHAIN_PROOF_MIN_CONFIRMATIONS|RATE_LIMIT_SEND_PER_MINUTE|RATE_LIMIT_REGISTER_PER_MINUTE|RATE_LIMIT_SUGGEST_PER_MINUTE)=' "$ENV_FILE" || true

if [[ "$NO_RESTART" == "true" ]]; then
  echo
  echo "Skipping restart (--no-restart)."
  exit 0
fi

echo
echo "Restarting stack..."
bash "$SCRIPT_DIR/stop-server-stack.sh"
bash "$SCRIPT_DIR/start-server-stack.sh"

echo
echo "Stack status:"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo
echo "Tail backend logs:"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=40 backend

echo
echo "Runtime check (backend direct):"
curl -s "http://127.0.0.1:${BACKEND_PORT:-3001}/turnstile-config" || true

echo
echo "Runtime check (public /api route):"
curl -s "https://${DOMAIN_VALUE}/api/turnstile-config" || true

echo
echo "Done. Next: open https://${DOMAIN_VALUE} and verify Turnstile appears on Create Name and Direct Send."
