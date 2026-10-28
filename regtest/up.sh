#!/usr/bin/env bash
# Starts the local chain with plain docker, for machines without the compose plugin. ./down.sh stops it.
set -euo pipefail
cd "$(dirname "$0")"
p=inchcandle-regtest
docker network inspect $p >/dev/null 2>&1 || docker network create $p >/dev/null
docker run -d --name $p-zakura --network $p --network-alias zakura \
  -p 127.0.0.1:18232:18232 -v $p-chain:/data -v "$PWD/zakurad.toml:/config/zakurad.toml:ro" \
  -e CONFIG_FILE_PATH=/config/zakurad.toml -e ZAKURA_STATE__CACHE_DIR=/data \
  zakuracore/zakura:1.6.0 zakurad start >/dev/null
docker run -d --name $p-lightwalletd --network $p --network-alias lightwalletd --user 0:0 --restart on-failure \
  -v $p-lwd:/var/lib/lightwalletd ghcr.io/zcashlabs/thus-spoke-zakura-lightwalletd:0.3.0 \
  --no-tls-very-insecure --grpc-bind-addr 0.0.0.0:9067 --rpchost zakura --rpcport 18232 \
  --rpcuser unused --rpcpassword unused --data-dir /var/lib/lightwalletd --log-file /dev/stdout >/dev/null
docker run -d --name $p-grpc-web --network $p -p 127.0.0.1:18080:80 \
  -v "$PWD/traefik.yml:/etc/traefik/traefik.yml:ro" -v "$PWD/dynamic.yml:/etc/traefik/dynamic.yml:ro" \
  traefik:v3.1 >/dev/null
echo "node RPC http://127.0.0.1:18232, gRPC-web http://127.0.0.1:18080"
