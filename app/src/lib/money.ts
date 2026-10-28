export const zatPerZec = 100_000_000n;
const maxSupply = 21_000_000n * zatPerZec;

/** Parses what a person types as an amount of ZEC. Returns zatoshi, or null if it isn't one. */
export function parseZec(input: string): bigint | null {
  const text = input.trim().replace(/\s/g, "").replace(",", ".");
  const match = /^(\d{0,8})(?:\.(\d{0,8}))?$/.exec(text);
  if (!match || (match[1] === "" && !match[2])) return null;
  const whole = BigInt(match[1] || "0");
  const fraction = BigInt((match[2] ?? "").padEnd(8, "0") || "0");
  const zat = whole * zatPerZec + fraction;
  return zat > 0n && zat <= maxSupply ? zat : null;
}

/** Formats zatoshi for reading: grouped, at least two decimals, at most eight. */
export function formatZec(zat: bigint): string {
  const negative = zat < 0n;
  const abs = negative ? -zat : zat;
  const whole = (abs / zatPerZec).toLocaleString("en-US");
  let fraction = (abs % zatPerZec).toString().padStart(8, "0").replace(/0+$/, "");
  if (fraction.length < 2) fraction = fraction.padEnd(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Formats zatoshi the way ZIP 321 wants it: plain decimal, no grouping, no trailing zeros. */
export function zecDecimal(zat: bigint): string {
  const whole = (zat / zatPerZec).toString();
  const fraction = (zat % zatPerZec).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** ZEC as a number, in zatoshi. For fixed amounts in code, never for what a person types. */
export const zec = (n: number) => BigInt(Math.round(n * Number(zatPerZec)));
