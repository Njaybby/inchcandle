import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Phones on the local network need HTTPS: WebCrypto, the device key and SharedArrayBuffer exist only in a secure context.
// IC_CERT_DIR points at a key.pem and cert.pem, IC_PORT moves the server so it can run beside the plain one.
const certDir = process.env.IC_CERT_DIR;
const https = certDir ? { key: readFileSync(`${certDir}/key.pem`), cert: readFileSync(`${certDir}/cert.pem`) } : undefined;
const port = Number(process.env.IC_PORT ?? 5240);

// The light client runs WebAssembly threads on SharedArrayBuffer, which browsers allow only on a cross-origin isolated page.
const isolated = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

// The directory and the local chain sit behind the same origin, so the isolated page can reach them and phones on the network need one address.
const proxy = {
  "/api": { target: "http://127.0.0.1:5242", changeOrigin: false },
  "/rpc/anvil": { target: "http://127.0.0.1:8545", changeOrigin: true, rewrite: (p: string) => p.replace(/^\/rpc\/anvil/, "") },
};

export default defineConfig({
  plugins: [react()],
  define: { global: "globalThis" },
  server: {
    host: true,
    port,
    strictPort: true,
    https,
    headers: isolated,
    proxy,
    // The light client package is linked from the WebZjs build beside this repo, and the local chain's addresses come from the contracts' deployment file.
    fs: { allow: [".", "../../webzjs/packages", "../contracts/deployments"] },
  },
  preview: { host: true, port: 5241, strictPort: true, headers: isolated, proxy },
  optimizeDeps: { exclude: ["@zcashcommunitygrants/webzjs-wallet"] },
  worker: { format: "es" },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
