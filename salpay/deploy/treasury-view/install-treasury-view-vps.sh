#!/usr/bin/env bash
# Install always-on treasury VIEW-ONLY wallet-rpc on the salpay.org VPS.
# Run as root (hosting provider web console or: ssh root@YOUR_IP 'bash -s' < install-treasury-view-vps.sh)
#
# Prerequisites:
#   - Copy view wallet files to /var/lib/salpay/treasury-view/ before or during this script:
#       treasury-view-mainnet.keys  (+ cache if present)
#   - Optional: set TREASURY_VIEW_PASSWORD (default: treasury-view-local-only)
#   - Optional: set SALVIUM_DAEMON_ADDRESS (default: seed01.salvium.io:19081)
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root"
  exit 1
fi

TREASURY_DIR="${TREASURY_DIR:-/var/lib/salpay/treasury-view}"
WALLET_NAME="${WALLET_NAME:-treasury-view-mainnet}"
WALLET_PASS="${TREASURY_VIEW_PASSWORD:-treasury-view-local-only}"
RPC_PORT="${TREASURY_VIEW_RPC_PORT:-29089}"
DAEMON_ADDRESS="${SALVIUM_DAEMON_ADDRESS:-seed01.salvium.io:19081}"
BIN_DIR="${SALVIUM_BIN_DIR:-/opt/salvium}"
# Official-ish Linux build location — override if you already have binaries on the box
SALVIUM_VERSION="${SALVIUM_VERSION:-v1.1.3c}"

echo "==> Installing packages"
apt-get update -y
apt-get install -y curl ca-certificates jq tar gzip ufw

mkdir -p "$TREASURY_DIR" "$BIN_DIR" /var/log/salpay

# --- salvium-wallet-rpc binary ---
if [[ ! -x "$BIN_DIR/salvium-wallet-rpc" ]]; then
  echo "==> Looking for salvium-wallet-rpc"
  CANDIDATES=(
    "$BIN_DIR/salvium-wallet-rpc"
    /usr/local/bin/salvium-wallet-rpc
    /home/YOUR_DEPLOY_USER/salvium/salvium-wallet-rpc
    /opt/salvium/salvium-wallet-rpc
  )
  FOUND=""
  for c in "${CANDIDATES[@]}"; do
    if [[ -x "$c" ]]; then FOUND="$c"; break; fi
  done
  if [[ -z "$FOUND" ]]; then
    echo "WARNING: salvium-wallet-rpc not found on PATH."
    echo "Place a Linux mainnet salvium-wallet-rpc at $BIN_DIR/salvium-wallet-rpc"
    echo "Download from your Salvium release tarball (linux x64) matching GUI 1.1.3c."
    echo "Continuing to install units; start will fail until binary exists."
  else
    cp -f "$FOUND" "$BIN_DIR/salvium-wallet-rpc"
    chmod +x "$BIN_DIR/salvium-wallet-rpc"
  fi
fi

if [[ ! -f "$TREASURY_DIR/${WALLET_NAME}.keys" ]]; then
  echo "ERROR: Missing $TREASURY_DIR/${WALLET_NAME}.keys"
  echo "From your Windows machine (after SSH works):"
  echo "  scp private/treasury-view/treasury-view-mainnet.keys root@SERVER:$TREASURY_DIR/"
  echo "  # optional: scp the wallet cache file too if present"
  exit 1
fi

chown -R root:root "$TREASURY_DIR"
chmod 700 "$TREASURY_DIR"
chmod 600 "$TREASURY_DIR/${WALLET_NAME}.keys" || true

# --- open-wallet helper (runs after rpc starts) ---
cat > /usr/local/bin/salpay-treasury-view-open.sh <<EOF
#!/usr/bin/env bash
set -euo pipefail
RPC="http://127.0.0.1:${RPC_PORT}/json_rpc"
for i in \$(seq 1 60); do
  if curl -sf -X POST "\$RPC" -H 'Content-Type: application/json' \\
    -d '{"jsonrpc":"2.0","id":"0","method":"get_version","params":{}}' >/dev/null; then
    break
  fi
  sleep 1
done
curl -sf -X POST "\$RPC" -H 'Content-Type: application/json' -d @- <<JSON
{"jsonrpc":"2.0","id":"0","method":"open_wallet","params":{"filename":"${WALLET_NAME}","password":"${WALLET_PASS}"}}
JSON
# kick a refresh (may take a long time first run)
curl -sf -X POST "\$RPC" -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":"0","method":"refresh","params":{}}' >/dev/null || true
echo "treasury-view open+refresh issued"
EOF
chmod +x /usr/local/bin/salpay-treasury-view-open.sh

# --- systemd: wallet-rpc ---
cat > /etc/systemd/system/salpay-treasury-view.service <<EOF
[Unit]
Description=SalPay treasury VIEW-ONLY wallet-rpc (chain_proof)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${TREASURY_DIR}
ExecStart=${BIN_DIR}/salvium-wallet-rpc \\
  --wallet-dir ${TREASURY_DIR} \\
  --rpc-bind-ip 127.0.0.1 \\
  --rpc-bind-port ${RPC_PORT} \\
  --daemon-address ${DAEMON_ADDRESS} \\
  --trusted-daemon \\
  --disable-rpc-login \\
  --log-file /var/log/salpay/treasury-view-rpc.log \\
  --log-level 1
ExecStartPost=/bin/bash -c 'sleep 3; /usr/local/bin/salpay-treasury-view-open.sh >> /var/log/salpay/treasury-view-open.log 2>&1 || true'
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

# --- systemd: docker salpay stack (if compose project exists) ---
STACK_DIR=""
for d in /home/YOUR_DEPLOY_USER/salpay.org /root/salpay.org /opt/salpay.org; do
  if [[ -f "$d/salpay/deploy/docker-compose.server.yml" ]] || [[ -f "$d/deploy/docker-compose.server.yml" ]]; then
    STACK_DIR="$d"
    break
  fi
done

if [[ -n "$STACK_DIR" ]]; then
  COMPOSE_FILE=""
  ENV_FILE=""
  if [[ -f "$STACK_DIR/salpay/deploy/docker-compose.server.yml" ]]; then
    COMPOSE_FILE="$STACK_DIR/salpay/deploy/docker-compose.server.yml"
    ENV_FILE="$STACK_DIR/salpay/.env.server"
    WORK="$STACK_DIR"
  else
    COMPOSE_FILE="$STACK_DIR/deploy/docker-compose.server.yml"
    ENV_FILE="$STACK_DIR/.env.server"
    WORK="$STACK_DIR"
  fi

  # Ensure env points at local treasury view
  if [[ -f "$ENV_FILE" ]]; then
    if grep -q '^TREASURY_VIEW_RPC_URL=' "$ENV_FILE"; then
      sed -i 's|^TREASURY_VIEW_RPC_URL=.*|TREASURY_VIEW_RPC_URL=http://host.docker.internal:29089/json_rpc|' "$ENV_FILE"
    else
      echo 'TREASURY_VIEW_RPC_URL=http://host.docker.internal:29089/json_rpc' >> "$ENV_FILE"
    fi
    if grep -q '^TREASURY_PUBLIC_STATS=' "$ENV_FILE"; then
      sed -i 's|^TREASURY_PUBLIC_STATS=.*|TREASURY_PUBLIC_STATS=true|' "$ENV_FILE"
    else
      echo 'TREASURY_PUBLIC_STATS=true' >> "$ENV_FILE"
    fi
    echo "Updated $ENV_FILE treasury view URL"
  fi

  cat > /etc/systemd/system/salpay-docker-stack.service <<EOF
[Unit]
Description=SalPay Docker stack (backend/frontend/nginx)
After=docker.service network-online.target salpay-treasury-view.service
Requires=docker.service
Wants=salpay-treasury-view.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${WORK}
ExecStart=/usr/bin/docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} up -d --remove-orphans
ExecStop=/usr/bin/docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} stop
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF
else
  echo "WARNING: salpay compose project not found under /home/YOUR_DEPLOY_USER or /root — docker unit skipped"
fi

# Boot order helper
cat > /etc/systemd/system/salpay-all.target <<'EOF'
[Unit]
Description=SalPay full stack (treasury view + docker)
Requires=salpay-treasury-view.service
Wants=salpay-docker-stack.service
After=salpay-treasury-view.service

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable salpay-treasury-view.service
if systemctl cat salpay-docker-stack.service >/dev/null 2>&1; then
  systemctl enable salpay-docker-stack.service
fi
systemctl enable salpay-all.target

if [[ -x "$BIN_DIR/salvium-wallet-rpc" ]]; then
  systemctl restart salpay-treasury-view.service
  sleep 5
  systemctl --no-pager --full status salpay-treasury-view.service || true
  if systemctl cat salpay-docker-stack.service >/dev/null 2>&1; then
    systemctl restart salpay-docker-stack.service || true
  fi
else
  echo "Binary missing — start units after placing salvium-wallet-rpc"
fi

echo
echo "=== Done ==="
echo "Treasury view RPC: http://127.0.0.1:${RPC_PORT}/json_rpc"
echo "Logs: /var/log/salpay/treasury-view-rpc.log"
echo "On boot: salpay-treasury-view + docker stack auto-start"
echo "Probe from host:"
echo "  curl -s http://127.0.0.1:${RPC_PORT}/json_rpc -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":\"0\",\"method\":\"get_height\"}'"
echo "Probe public:"
echo "  curl -s https://salpay.org/api/treasury-view-status"
EOF
