import type { RoomTerms } from "./types";

// The shapes the directory sends and receives. Shared by the app and the directory server.

export type Network = "preview" | "regtest" | "test" | "main";

/** Public rooms show everything, private rooms only their name, hidden rooms nothing. */
export type Listing = "public" | "private" | "hidden";

export interface DirectoryRoom {
  id: string;
  network: Network;
  listing: Listing;
  /** Null for a hidden room seen by someone outside it. */
  name: string | null;
  fingerprint: string;
  createdAt: number;
  /** Public rooms only. */
  terms?: RoomTerms;
  /** How many sealed bids the room holds, on the preview network. Public rooms only. */
  bids?: number;
  members?: number;
}

export interface RoomRecord extends DirectoryRoom {
  /** The terms under the room key, for the host and members of a private or hidden room. */
  sealed?: string;
  host: string;
  paddleCap: number;
  /** What the asking device is in this room, when it signed the request. */
  you?: { role: "host" | "member" | "attester"; paddle?: number };
}

export interface CodeIn {
  /** The code's lookup id, never the code. */
  id: string;
  paddle: number;
  /** The room key and paddle, sealed under a key only the code can derive. */
  admission: string;
}

export interface CodeRow {
  id: string;
  paddle: number;
  createdAt: number;
  usedAt: number | null;
  revokedAt: number | null;
}

export interface MemberRow {
  device: string;
  paddle: number;
  joinedAt: number;
  removedAt: number | null;
  viaCode: boolean;
}

export interface NewRoomBody {
  id: string;
  network: Network;
  listing: Listing;
  name: string | null;
  fingerprint: string;
  paddleCap: number;
  terms?: RoomTerms;
  sealed?: string;
  codes?: CodeIn[];
  /** The room key sealed to each attester in the vault's committee. */
  grants?: { attester: string; sealed: string }[];
}

export interface RedeemResult {
  room: RoomRecord;
  admission: string;
  paddle: number;
  /** True when this device had already redeemed the code. */
  again: boolean;
}

export interface WireBid {
  id: string;
  paddle: number;
  envelope: string;
  deposit: string;
  at: number;
  seq: number;
}

export interface Attester {
  /** The attester's device id, which signs its requests to the directory. */
  id: string;
  name: string;
  /** The EVM address that signs settlements. */
  address: string;
  /** A P-256 public key the host seals the room key to. */
  boxKey: string;
}

export interface Settlement {
  kind: "settle" | "nosale";
  vault: string;
  chainId: number;
  roomId: string;
  /** The winning bid's claim key, an EVM address. Zero for no sale. */
  claimKey: string;
  /** What the winner pays, in zatoshi. */
  price: string;
  /** SHA-256 over the judged bids, so every attester can be checked against the same result. */
  resultHash: string;
}

export interface AttestationRow {
  attester: string;
  body: Settlement;
  signature: string;
  at: number;
}

export interface Stats {
  rooms: number;
  open: number;
  sealedBids: number;
  codesIssued: number;
  codesUsed: number;
  vaults: number;
}

export interface VaultStatus {
  roomId: string;
  settlement: { kind: string; status: string; tx: string | null; error: string | null } | null;
  claim: { destination: string; status: string; tx: string | null; error: string | null } | null;
  attestations: AttestationRow[];
}
