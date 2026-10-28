import { readFileSync, existsSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { vaultAbi, vaultStates } from "../../app/src/lib/vault";
import type { Settlement } from "../../app/src/lib/api-types";
import { root } from "./keys";

// The relay. It carries attester signatures and winners' claims to the vaults and pays the gas.
// It holds no authority: a vault checks every signature itself, so the relay can delay a settlement but never change one,
// and anyone else could submit the same signatures.

const base = process.env.IC_API ?? "http://127.0.0.1:5242";
const token = process.env.IC_RELAY_TOKEN ?? readFileSync(`${root}keys/relay-token`, "utf8").trim();
/** Chain id to RPC and gas key. The local chain uses anvil's first well-known test account. */
const chains: Record<number, { rpc: string; key: Hex }> = {
  31337: { rpc: process.env.IC_RPC_31337 ?? "http://127.0.0.1:8545", key: (process.env.IC_RELAY_KEY_31337 ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex },
};
if (existsSync(`${root}keys/chains.json`)) Object.assign(chains, JSON.parse(readFileSync(`${root}keys/chains.json`, "utf8")));
if (process.env.IC_CHAINS) Object.assign(chains, JSON.parse(process.env.IC_CHAINS));
/** Attesters on hosts that only run when asked. The relay calls each one's tick URL; it can delay a pass but cannot sign one. */
const nudges = (process.env.IC_NUDGE ?? "").split(",").map((u) => u.trim()).filter(Boolean);

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), "[relay]", ...a);

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data.message ?? ""}`);
  return data as T;
}

function clients(chainId: number) {
  const c = chains[chainId];
  if (!c) throw new Error(`No RPC configured for chain ${chainId}`);
  const chain = { id: chainId, name: String(chainId), nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [c.rpc] } } } as const;
  const account = privateKeyToAccount(c.key);
  return { pc: createPublicClient({ chain, transport: http(c.rpc) }), wc: createWalletClient({ chain, account, transport: http(c.rpc) }), account };
}

const sameResult = (a: Settlement, b: Settlement) => a.kind === b.kind && a.claimKey.toLowerCase() === b.claimKey.toLowerCase() && a.price === b.price && a.resultHash === b.resultHash && a.vault.toLowerCase() === b.vault.toLowerCase();

async function settle(roomId: string, rows: { attester: string; body: Settlement; signature: Hex }[]) {
  const body = rows[0].body;
  const { pc, wc } = clients(body.chainId);
  const vault = body.vault as Address;
  const state = vaultStates[Number(await pc.readContract({ address: vault, abi: vaultAbi, functionName: "state" }))];
  if (state !== "Held") {
    await api("POST", "/relay/settlements", { roomId, vault, kind: body.kind, status: "sent", error: `Vault already ${state}` });
    return;
  }
  const threshold = Number(await pc.readContract({ address: vault, abi: vaultAbi, functionName: "threshold" }));
  const members = ((await pc.readContract({ address: vault, abi: vaultAbi, functionName: "attesters" })) as Address[]).map((a) => a.toLowerCase());
  // Only signatures for one identical result count, from the vault's own attesters, ordered by address as the vault requires.
  const groups: (typeof rows)[] = [];
  for (const row of rows.filter((r) => members.includes(r.attester.toLowerCase()))) {
    const group = groups.find((g) => sameResult(g[0].body, row.body));
    if (group) group.push(row);
    else groups.push([row]);
  }
  const quorum = groups.find((g) => g.length >= threshold);
  if (!quorum) return;
  const sigs = [...quorum].sort((a, b) => (BigInt(a.attester) < BigInt(b.attester) ? -1 : 1)).map((r) => r.signature);
  const q = quorum[0].body;
  try {
    const hash =
      q.kind === "settle"
        ? await wc.writeContract({ address: vault, abi: vaultAbi, functionName: "settle", args: [q.claimKey as Address, BigInt(q.price), q.resultHash as Hex, sigs] })
        : await wc.writeContract({ address: vault, abi: vaultAbi, functionName: "settleNoSale", args: [q.resultHash as Hex, sigs] });
    const receipt = await pc.waitForTransactionReceipt({ hash });
    await api("POST", "/relay/settlements", { roomId, vault, kind: q.kind, status: receipt.status === "success" ? "sent" : "failed", tx: hash, error: receipt.status === "success" ? undefined : "Reverted" });
    log(roomId, `${q.kind} with ${sigs.length} signatures, ${threshold} needed, tx ${hash}`);
  } catch (e) {
    const message = e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : String(e);
    await api("POST", "/relay/settlements", { roomId, vault, kind: q.kind, status: "failed", error: message });
    log(roomId, "settle failed:", message);
  }
}

async function claim(c: { vault: string; room_id: string; destination: string; signature: string }) {
  // The chain id isn't in the claim row, so try every configured chain where the vault exists.
  for (const id of Object.keys(chains).map(Number)) {
    const { pc, wc } = clients(id);
    const code = await pc.getCode({ address: c.vault as Address });
    if (!code || code === "0x") continue;
    try {
      const hash = await wc.writeContract({ address: c.vault as Address, abi: vaultAbi, functionName: "claim", args: [c.destination as Address, c.signature as Hex] });
      const receipt = await pc.waitForTransactionReceipt({ hash });
      await api("POST", "/relay/claims", { vault: c.vault, status: receipt.status === "success" ? "sent" : "failed", tx: hash, error: receipt.status === "success" ? undefined : "Reverted" });
      log(c.room_id, `claim to ${c.destination}, tx ${hash}`);
    } catch (e) {
      const message = e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : String(e);
      await api("POST", "/relay/claims", { vault: c.vault, status: "failed", error: message });
      log(c.room_id, "claim failed:", message);
    }
    return;
  }
  await api("POST", "/relay/claims", { vault: c.vault, status: "failed", error: "Vault not found on any configured chain" });
}

async function loop() {
  try {
    const pending = await api<{ attested: { room_id: string; attester: string; body: Settlement; signature: Hex }[]; claims: { vault: string; room_id: string; destination: string; signature: string }[] }>("GET", "/relay/pending");
    const byRoom = new Map<string, { attester: string; body: Settlement; signature: Hex }[]>();
    for (const a of pending.attested) byRoom.set(a.room_id, [...(byRoom.get(a.room_id) ?? []), a]);
    for (const [roomId, rows] of byRoom) await settle(roomId, rows).catch((e) => log(roomId, "error", e instanceof Error ? e.message : e));
    for (const c of pending.claims) await claim(c).catch((e) => log(c.room_id, "error", e instanceof Error ? e.message : e));
  } catch (e) {
    log("directory unreachable", e instanceof Error ? e.message : e);
  }
  setTimeout(loop, 3000);
}

async function nudge() {
  await Promise.all(nudges.map((url) => fetch(url, { signal: AbortSignal.timeout(20_000) }).catch((e) => log("nudge failed", url, e instanceof Error ? e.message : e))));
  setTimeout(nudge, 5000);
}

log(`relaying for chains ${Object.keys(chains).join(", ")}${nudges.length ? `, nudging ${nudges.length} attesters` : ""}`);
loop();
if (nudges.length) nudge();
