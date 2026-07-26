#!/usr/bin/env bash
# Open treasury view wallet after wallet-rpc starts; harden host firewall for RPC.
set -euo pipefail

RPC_URL="${TREASURY_VIEW_RPC_URL:-http://127.0.0.1:29089/json_rpc}"
WALLET_NAME="${WALLET_NAME:-treasury-view-mainnet}"
WALLET_PASS="${TREASURY_VIEW_PASSWORD:-treasury-view-local-only}"
RPC_PORT="${TREASURY_VIEW_RPC_PORT:-29089}"

echo "== waiting for wallet-rpc on ${RPC_URL} =="
for i in $(seq 1 90); do
  if curl -sf --max-time 2 -X POST "$RPC_URL" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":"0","method":"get_version","params":{}}' >/dev/null; then
    break
  fi
  sleep 1
done

echo "== open_wallet ${WALLET_NAME} =="
curl -sf --max-time 120 -X POST "$RPC_URL" \
  -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"0\",\"method\":\"open_wallet\",\"params\":{\"filename\":\"${WALLET_NAME}\",\"password\":\"${WALLET_PASS}\"}}" \
  || true

# Kick refresh in background so systemd ExecStartPost is not blocked for hours.
(
  curl -sf --max-time 10 -X POST "$RPC_URL" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":"0","method":"refresh","params":{}}' >/dev/null 2>&1 || true
) &

echo "== firewall: allow lo + docker to ${RPC_PORT}, drop internet =="
# Idempotent-ish rules (ignore failures if already present).
iptables -C INPUT -i lo -p tcp --dport "$RPC_PORT" -j ACCEPT 2>/dev/null \
  || iptables -I INPUT 1 -i lo -p tcp --dport "$RPC_PORT" -j ACCEPT
iptables -C INPUT -p tcp --dport "$RPC_PORT" -s 172.16.0.0/12 -j ACCEPT 2>/dev/null \
  || iptables -I INPUT 2 -p tcp --dport "$RPC_PORT" -s 172.16.0.0/12 -j ACCEPT
# Drop non-docker/non-local to this port (if not already first DROP rule).
iptables -C INPUT -p tcp --dport "$RPC_PORT" ! -s 172.16.0.0/12 -j DROP 2>/dev/null \
  || iptables -I INPUT 3 -p tcp --dport "$RPC_PORT" ! -s 172.16.0.0/12 -j DROP

# Persist if netfilter-persistent / iptables-persistent available.
if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save || true
elif command -v iptables-save >/dev/null 2>&1; then
  mkdir -p /etc/iptables
  iptables-save > /etc/iptables/rules.v4 || true
fi

echo "done"
