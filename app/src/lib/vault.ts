import { createPublicClient, createWalletClient, custom, http, keccak256, parseAbi, toBytes, type Address, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8 } from "./bytes";
import type { VaultRef } from "./types";
import type { Outcome } from "./rules";

// Vaults: the lot waits on its own chain in a LotVault that InchcandleVaultFactory deployed for this room.
// Every EVM chain runs the same two contracts, so one module serves all of them. The list of chains is in chains.ts.

export interface Chain {
  key: string;
  id: number;
  name: string;
  /** Same-origin path the dev server proxies, or a public RPC. */
  rpc: string;
  explorer?: string;
  native: string;
  factory: Address | null;
  testnet: boolean;
  /** Demo collections anyone can mint, on the local chain and the test networks. */
  demo?: { nft: Address; token: Address; edition: Address };
}


export const factoryAbi = parseAbi([
  "function predict(address seller, bytes32 roomId) view returns (address)",
  "function open(bytes32 roomId, (uint8 standard, address token, uint256 id, uint256 amount) asset, address[] attesters, uint8 threshold, uint64 settleBy) payable returns (address)",
  "event VaultOpened(address indexed vault, address indexed seller, bytes32 indexed roomId, uint8 standard, address token, uint256 id, uint256 amount, address[] attesters, uint8 threshold, uint64 settleBy)",
]);

export const vaultAbi = parseAbi([
  "function state() view returns (uint8)",
  "function seller() view returns (address)",
  "function claimKey() view returns (address)",
  "function recipient() view returns (address)",
  "function price() view returns (uint256)",
  "function resultHash() view returns (bytes32)",
  "function settleBy() view returns (uint64)",
  "function threshold() view returns (uint8)",
  "function attesters() view returns (address[])",
  "function asset() view returns (uint8 standard, address token, uint256 id, uint256 amount)",
  "function settle(address claimKey, uint256 price, bytes32 resultHash, bytes[] signatures)",
  "function settleNoSale(bytes32 resultHash, bytes[] signatures)",
  "function claim(address destination, bytes signature)",
  "function reclaim()",
]);

export const erc721Abi = parseAbi([
  "function approve(address to, uint256 id)",
  "function ownerOf(uint256 id) view returns (address)",
  "function mint(address to, uint256 id)",
  "function balanceOf(address owner) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
]);
export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function mint(address to, uint256 amount)",
]);
export const erc1155Abi = parseAbi(["function setApprovalForAll(address operator, bool approved)", "function balanceOf(address owner, uint256 id) view returns (uint256)"]);

export const standards = { erc721: 0, erc1155: 1, erc20: 2, native: 3 } as const;
export const vaultStates = ["Empty", "Held", "Settled", "Claimed", "Returned"] as const;

/** The 32-byte room id vaults are opened under. */
export function roomIdBytes(roomId: string): Hex {
  return keccak256(toBytes(`inchcandle/room/${roomId}`));
}

export function publicClient(chain: Chain): PublicClient {
  const url = chain.rpc.startsWith("/") ? new URL(chain.rpc, location.origin).toString() : chain.rpc;
  return createPublicClient({ transport: http(url) }) as PublicClient;
}

export function explorerTx(chain: Chain | undefined, tx: string): string | null {
  return chain?.explorer ? `${chain.explorer}/tx/${tx}` : null;
}

export function explorerAddress(chain: Chain | undefined, address: string): string | null {
  return chain?.explorer ? `${chain.explorer}/address/${address}` : null;
}

// Claim keys: every bid in a vault room seals the address of a fresh secp256k1 key, and only that key can say where the lot goes.

export function newClaimKey(): { secret: Hex; address: Address } {
  const secret = generatePrivateKey();
  return { secret, address: privateKeyToAccount(secret).address };
}

/** The 32 bytes a bid carries in its claim field: twelve zero bytes, then the claim key's address. */
export function claimField(address: Address): Uint8Array {
  const out = new Uint8Array(32);
  out.set(hexToBytes(address.slice(2)), 12);
  return out;
}

/** Reads a claim key back out of an opened bid. Null when the field is a plain claim hash. */
export function claimAddress(field: Uint8Array): Address | null {
  if (field.length !== 32 || field.subarray(0, 12).some((b) => b !== 0)) return null;
  return `0x${bytesToHex(field.subarray(12))}` as Address;
}

export function domain(vault: VaultRef) {
  return { name: "Inchcandle Vault", version: "1", chainId: vault.chainId, verifyingContract: vault.address as Address } as const;
}

export const claimTypes = { Claim: [{ name: "destination", type: "address" }] } as const;
export const settlementTypes = {
  Settlement: [
    { name: "roomId", type: "bytes32" },
    { name: "claimKey", type: "address" },
    { name: "price", type: "uint256" },
    { name: "resultHash", type: "bytes32" },
  ],
} as const;
export const noSaleTypes = {
  NoSale: [
    { name: "roomId", type: "bytes32" },
    { name: "resultHash", type: "bytes32" },
  ],
} as const;

/** The winner signs where the lot should go. Anyone can carry the signature to the vault; it only ever sends the lot there. */
export async function signClaim(secret: Hex, vault: VaultRef, destination: Address): Promise<Hex> {
  return privateKeyToAccount(secret).signTypedData({ domain: domain(vault), types: claimTypes, primaryType: "Claim", message: { destination } });
}

/** A hash over the judged bids that every attester computes the same way, so their signatures can be compared. */
export function resultHash(roomId: string, outcome: Outcome): Hex {
  const lines = outcome.bids.map((b) => `${b.id}:${b.amount ?? "-"}:${b.void ?? "ok"}`);
  const text = `inchcandle/result/${roomId}\n${lines.join("\n")}\nwinners:${outcome.winners.map((w) => w.id).join(",")}\nprice:${outcome.price ?? "-"}`;
  return `0x${bytesToHex(sha256(utf8.encode(text)))}` as Hex;
}

// Wallets: an injected wallet on public chains, and in development a dev account on the local chain.

/** Anvil's well-known second test account. Development builds only, local chain only. */
const devSellerKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;

export interface Wallet {
  address: Address;
  label: string;
  write(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint }): Promise<Hex>;
}

export async function connectWallet(chain: Chain): Promise<Wallet> {
  const pc = publicClient(chain);
  if (chain.key === "anvil" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    const account = privateKeyToAccount(devSellerKey);
    const client = createWalletClient({ account, transport: http(new URL(chain.rpc, location.origin).toString()) });
    return {
      address: account.address,
      label: "Dev wallet",
      async write(args) {
        const hash = await client.writeContract({ ...(args as Record<string, unknown>), chain: { id: chain.id }, account } as never);
        await pc.waitForTransactionReceipt({ hash });
        return hash;
      },
    };
  }
  const injected = (window as unknown as { ethereum?: { request(a: { method: string; params?: unknown[] }): Promise<unknown> } }).ethereum;
  if (!injected) throw new Error("No browser wallet found. Install one, such as MetaMask or Rabby, to deposit a lot.");
  const [address] = (await injected.request({ method: "eth_requestAccounts" })) as Address[];
  const current = Number(await injected.request({ method: "eth_chainId" }));
  if (current !== chain.id) await injected.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chain.id.toString(16)}` }] });
  const client = createWalletClient({ account: address, transport: custom(injected) });
  return {
    address,
    label: "Browser wallet",
    async write(args) {
      const hash = await client.writeContract({ ...(args as Record<string, unknown>), chain: { id: chain.id }, account: address } as never);
      await pc.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
}

export interface VaultReading {
  state: (typeof vaultStates)[number];
  claimKey: Address;
  recipient: Address;
  seller: Address;
  settleBy: number;
  threshold: number;
  attesters: Address[];
}

export async function readVault(chain: Chain, address: Address): Promise<VaultReading | null> {
  const pc = publicClient(chain);
  const code = await pc.getCode({ address });
  if (!code || code === "0x") return null;
  const read = <T>(functionName: string) => pc.readContract({ address, abi: vaultAbi, functionName: functionName as never }) as Promise<T>;
  const [state, claimKey, recipient, seller, settleBy, threshold, attesters] = await Promise.all([
    read<number>("state"),
    read<Address>("claimKey"),
    read<Address>("recipient"),
    read<Address>("seller"),
    read<bigint>("settleBy"),
    read<number>("threshold"),
    read<Address[]>("attesters"),
  ]);
  return { state: vaultStates[state], claimKey, recipient, seller, settleBy: Number(settleBy) * 1000, threshold, attesters };
}
