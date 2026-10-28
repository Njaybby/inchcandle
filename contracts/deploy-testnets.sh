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
  forge script script/DeployTestnet.s.sol --rpc-url "$url" --private-key "$IC_DEPLOYER_KEY" --broadcast --slow
  cat "deployments/$id.json"
done
