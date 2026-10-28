/** How a room sells: the highest bid pays the second-highest, pays its own, several bids win at one price, or a candle sale. */
export type Format = "second" | "first" | "several" | "candle";
export type Access = "link" | "invite";
export type After = "private" | "price";

/** What is for sale. Every kind but a file or a physical item can sit in a vault on its own chain. */
export type LotKind = "nft" | "token" | "name" | "collateral" | "physical" | "file" | "other";

/** Where the lot is held: a vault the room's factory deployed on another chain, released only by a k-of-n settlement. */
export interface VaultRef {
  /** A key into the app's chain list, for example "anvil" or "base-sepolia". */
  chain: string;
  chainId: number;
  factory: string;
  /** The vault's address. It is predictable before the deposit, so it can go into the terms first. */
  address: string;
  asset: {
    standard: "erc721" | "erc1155" | "erc20" | "native";
    token: string;
    /** Token id for NFTs, "0" otherwise. */
    id: string;
    /** Base units, as a decimal string. */
    amount: string;
    symbol?: string;
    decimals?: number;
  };
  attesters: string[];
  threshold: number;
  /** After this moment, in milliseconds, the seller can take the lot back if nobody settled. */
  settleBy: number;
}

/** The terms a room is opened with. They never change once the room is open. */
export interface RoomTerms {
  v: 1;
  id: string;
  name: string;
  line: string;
  about?: string;
  /** Milliseconds since the epoch. In a candle sale, the latest the candle can go out. */
  closesAt: number;
  /** The drand round whose signature opens every sealed bid in the room, and picks a candle sale's end. */
  round: number;
  /** Zatoshi, as a decimal string. */
  deposit: string;
  format: Format;
  /** How many of the item a room with several winners sells. */
  units?: number;
  /** The earliest moment a candle sale's candle can go out. */
  candleFrom?: number;
  access: Access;
  after: After;
  /** The reserve, sealed to the same round, base64url. */
  reserve?: string;
  /** "local" for a photo kept in this browser, or a URL. */
  photo?: string;
  /** Version 2 terms say where the room runs, who can see it, how many paddles exist, what is sold and where it is held. */
  network?: "preview" | "test" | "main";
  listing?: "public" | "private" | "hidden";
  paddles?: number;
  lot?: { kind: LotKind; detail?: string };
  vault?: VaultRef;
  example?: boolean;
  /** The photo credit, for example rooms. */
  credit?: string;
  createdAt: number;
}

/** A bid as the room receives it: an envelope and the deposit that came with it. */
export interface SealedBid {
  id: string;
  envelope: string;
  deposit: string;
  at: number;
  seq: number;
  /** The paddle it arrived at. A bid counts only at a paddle the room issued. */
  paddle?: number;
}

/** A bid this browser placed, kept so the bidder can see their own amount and claim a win. */
export interface MyBid {
  id: string;
  amount: string;
  /** The bidder's room name, as an index into the name list. */
  name: number;
  envelope: string;
  /** The secret whose hash is in the bid. Revealing it proves who won. */
  claim: string;
  /** In a room with a vault: the private key of the claim key sealed in this bid, hex. It signs where the lot goes. */
  claimKey?: string;
  sealedAt: number;
  paid: boolean;
}

export interface Opening {
  round: number;
  signature: string;
}

/** What this browser remembers of a room's result, so the home screen can say what needs doing without reopening it. */
export interface ResultNote {
  winners: string[];
  price: string | null;
}
