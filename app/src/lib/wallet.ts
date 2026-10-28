import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { mnemonicToAccount } from "viem/accounts";
import { useSyncExternalStore } from "react";
import { utf8 } from "./bytes";
import { secrets, type WalletSecret } from "./device";
import * as z from "./zcash";

// This visitor's own wallet. One seed, made in this browser or recovered from a wallet signature, gives a Zcash account and an EVM account.
// The seed lives in the device's encrypted bundle and never leaves the browser.

/** The message a browser wallet signs to recover the same seed on any device. Changing a byte of it changes every recovered wallet. */
export const signInMessage = "Inchcandle wallet\n\nSigning this message recovers your Inchcandle wallet on this device. It costs nothing and sends no transaction.";

/** False in the hosted build, which has no light client and so no wallet. */
export const available = import.meta.env.VITE_LIGHT_CLIENT !== "off";

/** The chain this build pays on. Development builds run against the local regtest chain. */
export const zcashNetwork: z.Network = (import.meta.env.VITE_ZCASH_NETWORK as z.Network | undefined) ?? "regtest";

export interface Balances {
  /** Zatoshis that can be spent now. */
  spendable: bigint;
  /** Zatoshis received but not yet confirmed. */
  pending: bigint;
}

interface Live {
  light: z.Light;
  account: number;
}

const opened = new Map<string, Promise<Live>>();
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  version++;
  listeners.forEach((l) => l());
}

export function useWalletVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

export function current(): WalletSecret | undefined {
  return secrets.wallet();
}

async function store(seed: string, source: WalletSecret["source"]): Promise<WalletSecret> {
  const light = await shared();
  const birthday = Math.max(2, (await z.tip(light)) - 2);
  const wallet: WalletSecret = { seed, birthdays: { [zcashNetwork]: birthday }, source, at: Date.now() };
  // The account cache is keyed by seed, so a new seed opens a new account and the same seed never opens twice.
  await secrets.saveWallet(wallet);
  changed();
  return wallet;
}

/** Makes a fresh wallet in this browser. */
export async function create(): Promise<WalletSecret> {
  return store(z.newSeedPhrase(), "fresh");
}

/** Recovers a wallet from a browser wallet's signature over `signInMessage`. The same wallet signs the same bytes, so the same seed comes back. */
export async function signIn(): Promise<WalletSecret> {
  const injected = (window as unknown as { ethereum?: { request(a: { method: string; params?: unknown[] }): Promise<unknown> } }).ethereum;
  if (!injected) throw new Error("No browser wallet found. Make a new wallet here instead, or install MetaMask or Rabby.");
  const [address] = (await injected.request({ method: "eth_requestAccounts" })) as string[];
  const hex = "0x" + Array.from(utf8.encode(signInMessage), (b) => b.toString(16).padStart(2, "0")).join("");
  const signature = (await injected.request({ method: "personal_sign", params: [hex, address] })) as string;
  const entropy = sha256(utf8.encode(`inchcandle/wallet/v1\n${signature.toLowerCase()}`));
  return store(entropyToMnemonic(entropy, wordlist), "signed");
}

export async function forget(): Promise<void> {
  await secrets.saveWallet(undefined);
  changed();
}

let page: Promise<z.Light> | null = null;

/** One light client per page: the visitor's account, room accounts and the faucet all live in it. */
export function shared(): Promise<z.Light> {
  page ??= z.openWallet(zcashNetwork);
  return page;
}

async function open(): Promise<Live> {
  const wallet = current();
  if (!wallet) throw new Error("Make a wallet first.");
  let live = opened.get(wallet.seed);
  if (!live) {
    live = (async () => {
      const light = await shared();
      const account = await light.wallet.create_account("me", wallet.seed, 0, wallet.birthdays[zcashNetwork] ?? 2);
      return { light, account };
    })();
    opened.set(wallet.seed, live);
  }
  return live;
}

/** The visitor's shielded address: the account's Sapling address at index 0, which the room light client can see. */
export async function address(): Promise<string> {
  const { light, account } = await open();
  return z.paddleAddress(light, account, 0);
}

/** The EVM account derived from the same seed, for sellers who deposit lots and for gas on test networks. */
export function evmAccount() {
  const wallet = current();
  if (!wallet) return null;
  return mnemonicToAccount(wallet.seed);
}

let syncing: Promise<void> | null = null;

/** Scans new blocks for every account in this page. Concurrent callers share one scan; `fresh` waits for a running scan and then starts another, for an account added during it. */
export async function sync(fresh = false): Promise<void> {
  if (fresh && syncing) await syncing.catch(() => {});
  syncing ??= (async () => {
    try {
      await (await shared()).wallet.sync();
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

export async function balances(): Promise<Balances> {
  const { light, account } = await open();
  await sync();
  const summary = (await light.wallet.get_wallet_summary()) as { account_balances?: [number, Summary][] } | undefined;
  const b = summary?.account_balances?.find(([id]) => id === account)?.[1];
  return {
    spendable: BigInt((b?.sapling_balance ?? 0) + (b?.orchard_balance ?? 0)),
    pending: BigInt((b?.pending_change ?? 0) + (b?.pending_spendable ?? 0)),
  };
}

/** One account's line in the light client's wallet summary, in zatoshis. */
interface Summary {
  sapling_balance?: number;
  orchard_balance?: number;
  pending_change?: number;
  pending_spendable?: number;
}

/** Pays a ZIP 321 request from the visitor's account and returns the transaction id. */
export async function pay(uri: string): Promise<string> {
  const wallet = current();
  const { light, account } = await open();
  await sync(true);
  const proposal = await light.wallet.propose_request(account, uri);
  const txids = await light.wallet.create_proposed_transactions(proposal, wallet!.seed, 0);
  await light.wallet.send_authorized_transactions(txids);
  changed();
  return hexTxid(txids.slice(0, 32));
}

function hexTxid(bytes: Uint8Array): string {
  return Array.from(bytes)
    .reverse()
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Mines one block on the local chain, through the dev server. Regtest only. */
export async function mine(blocks = 1): Promise<void> {
  if (zcashNetwork !== "regtest") return;
  await fetch("/rpc/regtest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "generate", params: [blocks] }) });
}

export const faucetAmount = 2_000_000_000n;

let funder: Promise<number> | null = null;

/**
 * Development only: sends 20 ZEC of regtest coin to this visitor from the local chain's funder, then mines it in.
 * The funder's seed comes from the dev server, which only serves it in development.
 */
export async function faucet(): Promise<string> {
  if (zcashNetwork !== "regtest" || !import.meta.env.DEV) throw new Error("The faucet runs only on the local chain.");
  const light = await shared();
  const res = await fetch("/dev/funder");
  if (!res.ok) throw new Error("The dev server has no funder for the local chain.");
  const { seed } = (await res.json()) as { seed: string };
  funder ??= light.wallet.create_account("funder", seed, 0, 2);
  const id = await funder;
  const to = await address();
  await sync(true);
  const proposal = await light.wallet.propose_request(id, `zcash:${to}?amount=${Number(faucetAmount) / 1e8}`);
  const txids = await light.wallet.create_proposed_transactions(proposal, seed, 0);
  await light.wallet.send_authorized_transactions(txids);
  // The light client spends a note only after a few confirmations, so the local chain mines them at once.
  await mine(10);
  changed();
  return hexTxid(txids.slice(0, 32));
}

