#!/usr/bin/env bash
# Stops the local chain. Pass --wipe to delete the chain and start over from block 0.
set -euo pipefail
p=inchcandle-regtest
docker rm -f $p-grpc-web $p-lightwalletd $p-zakura >/dev/null 2>&1 || true
if [ "${1:-}" = "--wipe" ]; then docker volume rm $p-chain $p-lwd >/dev/null 2>&1 || true; fi
