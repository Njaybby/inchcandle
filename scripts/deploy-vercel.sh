#!/usr/bin/env bash
# Builds and deploys the hosted app and directory to Vercel from this machine.
# The app links the WebZjs fork from a sibling checkout, so the build runs here and is uploaded with --prebuilt.
# The Node builder compiles each TypeScript file on its own and leaves extensionless ESM imports that Node cannot load, so the directory function's entry is replaced with an esbuild bundle of our own sources.
# Usage: scripts/deploy-vercel.sh [--prod]
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"
vercel build --yes ${1:+--prod}
fn=".vercel/output/functions/api/[[...route]].func"
npx --yes esbuild@0.25.10 "api/[[...route]].ts" --bundle --platform=node --format=esm --target=node22 --alias:@libsql/client=@libsql/client/web --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" --outfile="$fn/api/[[...route]].js" --log-level=warning --allow-overwrite
rm -f "$fn/api/[[...route]].js.map"
vercel deploy --prebuilt ${1:+--prod}
