import { formatZec } from "./money";
import type { Format, RoomTerms } from "./types";

export const formatOrder: Format[] = ["second", "first", "several", "candle"];

/** What a seller picks from, named by what happens. */
export const formatChoice: Record<Format, { title: string; note: string }> = {
  second: {
    title: "The highest bid wins and pays the runner-up's bid",
    note: "Recommended. Bidders can safely bid what it's really worth to them. Bids stay sealed.",
  },
  first: {
    title: "The highest bid wins and pays what it bid",
    note: "The simplest to explain. Bids stay sealed.",
  },
  several: {
    title: "Several winners, one price",
    note: "For a number of the same thing. The top bids win and all pay the same price. Bids stay sealed.",
  },
  candle: {
    title: "Candle sale",
    note: "Bids are visible and anyone can raise. The candle goes out at a random moment near the end, so nobody can wait to snipe. Bidders stay anonymous, amounts don't.",
  },
};

export const formatName: Record<Format, string> = {
  second: "Second price",
  first: "Pay what you bid",
  several: "Several winners",
  candle: "Candle sale",
};

export const sealed = (terms: RoomTerms) => terms.format !== "candle";

/** The room's rules in one sentence, for the invitation and the details. */
export function formatSentence(terms: RoomTerms): string {
  switch (terms.format) {
    case "second":
      return "Bids are sealed. The highest wins and pays the second-highest bid.";
    case "first":
      return "Bids are sealed. The highest wins and pays what it bid.";
    case "several":
      return `${terms.units ?? 2} to sell. Bids are sealed, the top ${terms.units ?? 2} win, and each pays the same price: the highest bid that missed out.`;
    case "candle":
      return "Bids are visible, bidders are anonymous. The candle goes out at a random moment near the end, and the highest bid before then wins and pays what it bid.";
  }
}

/** The one line of advice under the amount, because one sentence measurably improves how people bid. */
export function bidAdvice(terms: RoomTerms, leading: bigint | null): string {
  switch (terms.format) {
    case "second":
      return "Bid the most it's worth to you. If you win, you pay the second-highest bid.";
    case "first":
      return "If you win, you pay exactly what you bid.";
    case "several":
      return `Bid the most one is worth to you. If you're in the top ${terms.units ?? 2}, you pay the highest bid that missed out.`;
    case "candle":
      return leading === null
        ? "Everyone can see this bid. The candle can go out at any moment near the end, so bid what you'd pay now."
        : `The leading bid is ${formatZec(leading)} ZEC. Everyone can see your bid, and the candle can go out at any moment near the end.`;
  }
}
