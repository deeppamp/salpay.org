#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.server"
COMPOSE_FILE="$PROJECT_DIR/deploy/docker-compose.server.yml"

echo "Stopping salpay server stack..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down
