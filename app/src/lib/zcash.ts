import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { WebWallet } from "@zcashcommunitygrants/webzjs-wallet";

// The Zcash light client: WebZjs compiled to WebAssembly, talking to a gRPC-web proxy in front of lightwalletd.
// It loads on first use, so screens that never touch the chain never download it.

export type Network = "main" | "test" | "regtest";

/** gRPC-web proxies: ChainSafe's for the public networks, and the local chain from `regtest/docker-compose.yml`. They carry public chain data only; keys never leave the browser. */
export const proxies: Record<Network, string> = {
  main: "https://zcash-mainnet.chainsafe.dev",
  test: "https://zcash-testnet.chainsafe.dev",
  regtest: import.meta.env.VITE_REGTEST_PROXY ?? "http://127.0.0.1:18080",
};

/** A note the room account received, as the light client reports it. */
export interface RoomNote {
  txid: string;
  index: number;
  pool: string;
  /** Zatoshis. */
  value: number;
  memo: string | null;
  height: number | null;
  /** The diversifier index it was paid to, as a decimal string, or null for change. */
  address_index: string | null;
  change: boolean;
}

let ready: Promise<typeof import("@zcashcommunitygrants/webzjs-wallet")> | null = null;

/** Loads the module and starts its thread pool, once per page. */
export function loadWasm() {
  ready ??= (async () => {
    if (!crossOriginIsolated) throw new Error("The page is not cross-origin isolated, so the light client cannot start its threads.");
    const mod = await import("@zcashcommunitygrants/webzjs-wallet");
    await mod.default();
    await mod.initThreadPool(Math.min(navigator.hardwareConcurrency || 4, 8));
    return mod;
  })();
  return ready;
}

export function newSeedPhrase(): string {
  return generateMnemonic(wordlist, 256);
}

export interface Light {
  wallet: WebWallet;
  network: Network;
}

export async function openWallet(network: Network): Promise<Light> {
  const mod = await loadWasm();
  return { wallet: new mod.WebWallet(network, proxies[network], 1, 1, undefined), network };
}

export async function tip(light: Light): Promise<number> {
  return Number(await light.wallet.get_latest_block());
}

/** Adds a room account from its seed and returns the account id. The birthday bounds how far back the first scan goes. */
export async function addRoomAccount(light: Light, seed: string, birthday: number): Promise<number> {
  return light.wallet.create_account("room", seed, 0, birthday);
}

/** Paddle n is the room's shielded address at diversifier index n. */
export async function paddleAddress(light: Light, account: number, paddle: number): Promise<string> {
  return light.wallet.address_at(account, BigInt(paddle));
}

export async function roomNotes(light: Light, account: number): Promise<RoomNote[]> {
  return (await light.wallet.room_notes(account)) as RoomNote[];
}

export async function blockTime(light: Light, height: number): Promise<number> {
  return light.wallet.block_time(BigInt(height));
}
