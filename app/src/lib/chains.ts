import type { Address } from "viem";
import type { Chain } from "./vault";
import local from "../../../contracts/deployments/anvil.json";

// The chains a room can keep its lot on. Kept apart from vault.ts because it reads deployment files through Vite, and the relay loads vault.ts under Node.

interface Deployment {
  chainId: number;
  factory: Address;
  nft: Address;
  token: Address;
  edition: Address;
}

/** Test-network deployments written by contracts/script/DeployTestnet.s.sol, one file per chain id. */
const deployed = Object.values(import.meta.glob<Deployment>("../../../contracts/deployments/[0-9]*.json", { eager: true, import: "default" }));

function testnet(c: Omit<Chain, "factory" | "testnet" | "demo">): Chain {
  const d = deployed.find((x) => x.chainId === c.id);
  return { ...c, factory: d?.factory ?? null, testnet: true, demo: d ? { nft: d.nft, token: d.token, edition: d.edition } : undefined };
}

export const chains: Chain[] = [
  {
    key: "anvil",
    id: 31337,
    name: "Local devnet",
    rpc: "/rpc/anvil",
    native: "ETH",
    factory: local.factory as Address,
    testnet: true,
    demo: { nft: local.nft as Address, token: local.token as Address, edition: local.edition as Address },
  },
  testnet({ key: "base-sepolia", id: 84532, name: "Base Sepolia", rpc: "https://sepolia.base.org", explorer: "https://sepolia.basescan.org", native: "ETH" }),
  testnet({ key: "sepolia", id: 11155111, name: "Ethereum Sepolia", rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io", native: "ETH" }),
  testnet({ key: "arbitrum-sepolia", id: 421614, name: "Arbitrum Sepolia", rpc: "https://sepolia-rollup.arbitrum.io/rpc", explorer: "https://sepolia.arbiscan.io", native: "ETH" }),
  testnet({ key: "polygon-amoy", id: 80002, name: "Polygon Amoy", rpc: "https://polygon-amoy-bor-rpc.publicnode.com", explorer: "https://amoy.polygonscan.com", native: "POL" }),
  { key: "base", id: 8453, name: "Base", rpc: "https://mainnet.base.org", explorer: "https://basescan.org", native: "ETH", factory: null, testnet: false },
  { key: "arbitrum", id: 42161, name: "Arbitrum One", rpc: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io", native: "ETH", factory: null, testnet: false },
  { key: "ethereum", id: 1, name: "Ethereum", rpc: "https://eth.llamarpc.com", explorer: "https://etherscan.io", native: "ETH", factory: null, testnet: false },
  { key: "polygon", id: 137, name: "Polygon", rpc: "https://polygon-rpc.com", explorer: "https://polygonscan.com", native: "POL", factory: null, testnet: false },
  { key: "optimism", id: 10, name: "OP Mainnet", rpc: "https://mainnet.optimism.io", explorer: "https://optimistic.etherscan.io", native: "ETH", factory: null, testnet: false },
  { key: "bnb", id: 56, name: "BNB Chain", rpc: "https://bsc-dataseed.bnbchain.org", explorer: "https://bscscan.com", native: "BNB", factory: null, testnet: false },
];

/** Chains planned beyond EVM: shown so the plan is visible, never selectable. */
export const plannedChains = [
  { key: "solana", name: "Solana", note: "Anchor program with the same four instructions" },
  { key: "zcash-zsa", name: "Zcash shielded assets", note: "After NU7 activates on mainnet" },
];

export const chainByKey = (key: string) => chains.find((c) => c.key === key);
