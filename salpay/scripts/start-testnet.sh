#!/usr/bin/env bash
set -euo pipefail

echo "Starting Salvium Local Testnet..."

salviumd --testnet --offline --fixed-difficulty 500
