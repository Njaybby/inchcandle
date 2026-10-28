import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { createPublicClient, createWalletClient, http, parseAbi, keccak256, toBytes, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { toBase64Url, randomBytes } from "../../app/src/lib/bytes";
import { codeId, makeBook, newRoomKey, openAdmission, sealTerms, sealToBox } from "../../app/src/lib/codes";
import { encodePayload, openEnvelope } from "../../app/src/lib/envelope";
import { newId, roomTag } from "../../app/src/lib/ids";
import { roundAt } from "../../app/src/lib/rounds";
import { candleWindow } from "../../app/src/lib/rules";
import { seal } from "../../app/src/lib/seal";
import type { Attester } from "../../app/src/lib/api-types";
import type { RoomTerms, VaultRef } from "../../app/src/lib/types";
import { signRequest } from "./keys";

// Example rooms for the preview network, so the floor shows every state a room can be in.
// Every room is marked as an example. Bids are sealed for real to their drand round by bot devices that join like anyone else.

const base = process.env.IC_API ?? "http://127.0.0.1:5242";
const rpc = process.env.IC_RPC ?? "http://127.0.0.1:8545";
const zat = (n: number) => BigInt(Math.round(n * 1e8));
const minute = 60_000;

function bot() {
  return toBase64Url(p256.utils.randomSecretKey());
}

async function call<T>(method: string, path: string, body: unknown, secret: string | null): Promise<T> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const url = `/api${path}`;
  const headers: Record<string, string> = { "content-type": "application/json", ...(secret ? signRequest(secret, method, url, text) : {}) };
  const res = await fetch(base + url, { method, headers, body: method === "GET" ? undefined : text });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data as T;
}

const credit = "Photo: The Metropolitan Museum of Art. Public domain.";

interface Spec {
  name: string;
  line: string;
  about?: string;
  photo?: string;
  format: RoomTerms["format"];
  units?: number;
  closesIn: number;
  deposit: number;
  reserve?: number;
  listing: "public" | "private" | "hidden";
  paddles: number;
  kind: NonNullable<RoomTerms["lot"]>["kind"];
  bids: number[];
  vault?: "nft" | "token";
}

const specs: Spec[] = [
  {
    name: "Rock-crystal watch by Jean Rousseau",
    line: "Geneva, about 1655. Gilded brass and silver.",
    about: "A rock-crystal case mounted in gilded brass, with a silver and black enamel dial. 4.1 cm across. An example room: nothing is for sale.",
    photo: "/example/rousseau-watch-1200.jpg",
    format: "second",
    closesIn: 140 * minute,
    deposit: 2,
    reserve: 15,
    listing: "public",
    paddles: 60,
    kind: "physical",
    bids: [18.65, 16, 21.4, 17.3, 20.1],
  },
  {
    name: "Silver-gilt ship by Salomon Dreyer",
    line: "Augsburg, 1744. A table ornament in the form of a ship.",
    about: "England sold ships by inch of candle in the 1600s, and Samuel Pepys watched it done. An example room: nothing is for sale.",
    photo: "/example/dreyer-ship-1200.jpg",
    format: "candle",
    closesIn: 38 * minute,
    deposit: 1,
    listing: "public",
    paddles: 60,
    kind: "physical",
    bids: [9, 10.5, 11.2, 12],
  },
  {
    name: "Genesis edition",
    line: "A demo NFT on the local devnet, held in its own vault.",
    format: "second",
    closesIn: 3 * minute,
    deposit: 0.5,
    reserve: 1,
    listing: "public",
    paddles: 40,
    kind: "nft",
    bids: [3.2, 4.75, 2.9],
    vault: "nft",
  },
  {
    name: "Hellenistic gold ring",
    line: "Greek, late 4th to 3rd century BCE. Gold, 2.6 cm.",
    photo: "/example/greek-ring-1200.jpg",
    format: "first",
    closesIn: 26 * 60 * minute,
    deposit: 2,
    reserve: 14,
    listing: "private",
    paddles: 10,
    kind: "physical",
    bids: [15.2, 17.8],
  },
  {
    name: "Seed round allocation, 25,000 MOCK",
    line: "Demo tokens on the local devnet, sealed bids for the whole block.",
    format: "second",
    closesIn: 9 * 60 * minute,
    deposit: 1,
    listing: "private",
    paddles: 8,
    kind: "token",
    bids: [40, 52.5],
    vault: "token",
  },
  {
    name: "The Great Wave, three impressions",
    line: "Katsushika Hokusai, about 1831. Woodblock print.",
    about: "Three impressions are offered, and the top three bids each take one. An example room: nothing is for sale.",
    photo: "/example/hokusai-wave-1200.jpg",
    format: "several",
    units: 3,
    closesIn: 3 * 24 * 60 * minute,
    deposit: 1,
    reserve: 6,
    listing: "public",
    paddles: 80,
    kind: "physical",
    bids: [7.5, 9.2, 6.8, 11],
  },
  {
    name: "Studio visit and dinner",
    line: "An evening with the artist. Hidden room, codes only.",
    format: "second",
    closesIn: 5 * 24 * 60 * minute,
    deposit: 0.5,
    listing: "hidden",
    paddles: 6,
    kind: "other",
    bids: [],
  },
];

const devSeller = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const deployments = JSON.parse(readFileSync(new URL("../../contracts/deployments/anvil.json", import.meta.url), "utf8"));
const pc = createPublicClient({ transport: http(rpc) });
const wc = createWalletClient({ account: devSeller, transport: http(rpc) });
const anvil = { id: 31337, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;

async function openVault(roomId: string, kind: "nft" | "token", committee: Attester[], closesAt: number): Promise<VaultRef> {
  const factory = deployments.factory as Address;
  const rid = keccak256(toBytes(`inchcandle/room/${roomId}`));
  const fabi = parseAbi(["function predict(address,bytes32) view returns (address)", "function open(bytes32,(uint8,address,uint256,uint256),address[],uint8,uint64) payable returns (address)"]);
  const predicted = (await pc.readContract({ address: factory, abi: fabi, functionName: "predict", args: [devSeller.address, rid] })) as Address;
  const attesters = committee.map((a) => a.address as Address);
  const settleBy = BigInt(Math.floor((closesAt + 3 * 24 * 60 * minute) / 1000));
  let asset: [number, Address, bigint, bigint];
  if (kind === "nft") {
    const id = BigInt(1042 + Math.floor(Math.random() * 90000));
    const nabi = parseAbi(["function mint(address,uint256)", "function approve(address,uint256)"]);
    await pc.waitForTransactionReceipt({ hash: await wc.writeContract({ chain: anvil, address: deployments.nft, abi: nabi, functionName: "mint", args: [devSeller.address, id] }) });
    await pc.waitForTransactionReceipt({ hash: await wc.writeContract({ chain: anvil, address: deployments.nft, abi: nabi, functionName: "approve", args: [factory, id] }) });
    asset = [0, deployments.nft, id, 1n];
  } else {
    const amount = 25_000n * 10n ** 18n;
    const tabi = parseAbi(["function approve(address,uint256) returns (bool)"]);
    await pc.waitForTransactionReceipt({ hash: await wc.writeContract({ chain: anvil, address: deployments.token, abi: tabi, functionName: "approve", args: [factory, amount] }) });
    asset = [2, deployments.token, 0n, amount];
  }
  await pc.waitForTransactionReceipt({ hash: await wc.writeContract({ chain: anvil, address: factory, abi: fabi, functionName: "open", args: [rid, asset, attesters, 2, settleBy] }) });
  return {
    chain: "anvil",
    chainId: 31337,
    factory,
    address: predicted,
    asset: { standard: kind === "nft" ? "erc721" : "erc20", token: asset[1], id: asset[2].toString(), amount: asset[3].toString() },
    attesters,
    threshold: 2,
    settleBy: Number(settleBy) * 1000,
  };
}

const { attesters: committee } = await call<{ attesters: Attester[] }>("GET", "/attesters", undefined, null);
const host = bot();
const codesOut: string[] = [];

for (const s of specs) {
  const id = newId();
  const now = Date.now();
  const createdAt = now - Math.min(s.closesIn, 2 * 60 * minute);
  const closesAt = now + s.closesIn;
  const round = roundAt(closesAt + 20_000);
  const vault = s.vault ? await openVault(id, s.vault, committee, closesAt) : undefined;
  if (vault?.asset.standard === "erc721") s.name = `${s.name} #${vault.asset.id}`;
  const reserve = s.reserve ? toBase64Url(await seal(round, roomTag(id), encodePayload({ amount: zat(s.reserve), claim: new Uint8Array(32), name: null }))) : undefined;
  const terms: RoomTerms = {
    v: 1,
    id,
    name: s.name,
    line: s.line,
    about: s.about,
    closesAt,
    round,
    deposit: zat(s.deposit).toString(),
    format: s.format,
    ...(s.units ? { units: s.units } : {}),
    ...(s.format === "candle" ? { candleFrom: closesAt - candleWindow(createdAt, closesAt) } : {}),
    access: s.listing === "public" ? "link" : "invite",
    after: "private",
    reserve,
    photo: s.photo,
    credit: s.photo ? credit : undefined,
    example: true,
    createdAt,
    network: "preview",
    listing: s.listing,
    paddles: s.paddles,
    lot: { kind: s.kind },
    vault,
  };
  const coded = s.listing !== "public";
  const key = coded ? newRoomKey() : null;
  const book = key ? makeBook(id, key, Array.from({ length: s.paddles }, (_, i) => i + 1)) : [];
  const grants = key && vault ? committee.map((a) => ({ attester: a.id, sealed: sealToBox(Buffer.from(a.boxKey, "base64url"), id, key) })) : [];
  await call("POST", "/rooms", {
    id,
    network: "preview",
    listing: s.listing,
    name: s.name,
    fingerprint: Buffer.from(roomTag(id)).toString("hex"),
    paddleCap: s.paddles,
    ...(coded ? { sealed: sealTerms(key!, id, terms) } : { terms }),
    codes: book.map((b) => b.entry),
    grants,
  }, host);

  // In a vault room the top bidder pays the balance like a real winner would, so the attesters settle the vault to its claim key at the opening.
  const ranked = [...s.bids].sort((a, b) => b - a);
  const price = s.format === "first" ? ranked[0] : Math.max(ranked[1] ?? 0, s.reserve ?? 0, s.deposit);
  for (let i = 0; i < s.bids.length; i++) {
    const bidder = bot();
    if (coded) {
      const entry = book[i];
      const result = await call<{ admission: string }>("POST", "/redeem", { code: entry.entry.id }, bidder);
      openAdmission(entry.code, result.admission);
    } else {
      await call("POST", `/rooms/${id}/join`, {}, bidder);
    }
    const claim = vault ? new Uint8Array([...new Uint8Array(12), ...randomBytes(20)]) : sha256(randomBytes(32));
    const payload = encodePayload({ amount: zat(s.bids[i]), claim, name: (i * 97 + 31) % 640 });
    const envelope = s.format === "candle" ? openEnvelope(roomTag(id), payload) : await seal(round, roomTag(id), payload);
    await call("POST", `/rooms/${id}/bids`, { id: newId(16), envelope: toBase64Url(envelope), deposit: zat(s.deposit).toString() }, bidder);
    if (vault && s.bids[i] === ranked[0]) {
      const claimKey = `0x${Buffer.from(claim.subarray(12)).toString("hex")}`;
      await call("POST", `/rooms/${id}/payments`, { claimKey, amount: (zat(price) - zat(s.deposit)).toString() }, bidder);
    }
  }
  if (coded) codesOut.push(`${s.name} (${s.listing}): ${book.slice(s.bids.length, s.bids.length + 3).map((b) => b.code.replace(/(.{4})(?=.)/g, "$1-")).join("  ")}`);
  console.log(`${s.listing.padEnd(8)} ${id}  ${s.name}${vault ? `  vault ${vault.address}` : ""}`);
}
console.log("\nUnused codes to try:");
console.log(codesOut.join("\n"));
void codeId;
