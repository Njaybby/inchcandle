#!/usr/bin/env bash
# Mines blocks on the local chain. Usage: ./mine.sh [count], default 1.
set -euo pipefail
n="${1:-1}"
curl -s -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"generate\",\"params\":[$n]}" http://127.0.0.1:18232/
echo
