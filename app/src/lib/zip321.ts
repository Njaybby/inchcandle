import { toBase64Url, utf8 } from "./bytes";
import { zecDecimal } from "./money";

/** A ZIP 321 payment request for one payment with a memo. */
export function paymentUri(address: string, zat: bigint, memo: string): string {
  return `zcash:${address}?amount=${zecDecimal(zat)}&memo=${toBase64Url(utf8.encode(memo))}`;
}
