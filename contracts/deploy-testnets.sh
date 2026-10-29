#!/usr/bin/env bash
# Deploys the factory and the demo collections to each test network that has no deployments/<chain id>.json yet.
# Usage: IC_DEPLOYER_KEY=0x... ./deploy-testnets.sh [chain ...]
# The key should be fresh, so its first transactions give the same addresses on every chain.
set -euo pipefail
cd "$(dirname "$0")"
: "${IC_DEPLOYER_KEY:?set IC_DEPLOYER_KEY}"

declare -A rpc=(
  [base-sepolia]="${RPC_BASE_SEPOLIA:-https://sepolia.base.org}"
  [sepolia]="${RPC_SEPOLIA:-https://ethereum-sepolia-rpc.publicnode.com}"
  [arbitrum-sepolia]="${RPC_ARBITRUM_SEPOLIA:-https://sepolia-rollup.arbitrum.io/rpc}"
  [polygon-amoy]="${RPC_POLYGON_AMOY:-https://polygon-amoy-bor-rpc.publicnode.com}"
)
targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=(base-sepolia sepolia arbitrum-sepolia polygon-amoy)
deployer=$(cast wallet address "$IC_DEPLOYER_KEY")

for name in "${targets[@]}"; do
  url=${rpc[$name]:?unknown chain $name}
  id=$(cast chain-id --rpc-url "$url")
  if [ -f "deployments/$id.json" ]; then echo "$name ($id): already deployed"; continue; fi
  balance=$(cast balance "$deployer" --rpc-url "$url")
  if [ "$balance" = "0" ]; then echo "$name ($id): $deployer has no balance, skipped"; continue; fi
  echo "$name ($id): deploying from $deployer, nonce $(cast nonce "$deployer" --rpc-url "$url")"
  # Each contract goes out with cast so the node prices the gas.
  # Forge simulates locally and underestimates code deposit on chains that charge more per byte, so its transactions run out of gas there.
  create() {
    local out
    out=$(cast send --rpc-url "$url" --private-key "$IC_DEPLOYER_KEY" --json --create "$(forge inspect "$1" bytecode)" "${@:2}")
    [ "$(jq -r .status <<<"$out")" = "0x1" ] || { echo "$name: $1 failed: $(jq -r .transactionHash <<<"$out")" >&2; exit 1; }
    jq -r .contractAddress <<<"$out"
  }
  implementation=$(create LotVault)
  factory=$(create InchcandleVaultFactory "constructor(address)" "$implementation")
  nft=$(create DemoLot)
  token=$(create DemoToken)
  edition=$(create DemoEdition)
  jq -n --argjson chainId "$id" --arg factory "$(cast to-check-sum-address "$factory")" --arg implementation "$(cast to-check-sum-address "$implementation")" \
    --arg nft "$(cast to-check-sum-address "$nft")" --arg token "$(cast to-check-sum-address "$token")" --arg edition "$(cast to-check-sum-address "$edition")" \
    '{chainId: $chainId, edition: $edition, factory: $factory, implementation: $implementation, nft: $nft, token: $token}' > "deployments/$id.json"
  cat "deployments/$id.json"
done
