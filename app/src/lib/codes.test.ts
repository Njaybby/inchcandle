import { describe, expect, it } from "vitest";
import { p256 } from "@noble/curves/nist.js";
import { toBase64Url } from "./bytes";
import { codeId, formatCode, makeBook, newCode, newRoomKey, normalizeCode, openAdmission, openFromBox, openTerms, sealAdmission, sealTerms, sealToBox } from "./codes";

describe("codes", () => {
  it("are 16 characters of Crockford base32 and read back however they are typed", () => {
    const code = newCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(normalizeCode(formatCode(code).toLowerCase())).toBe(code);
    expect(normalizeCode("ilo0-1111-2222-3333")).toBe("1100111122223333");
    expect(normalizeCode("too short")).toBeNull();
    expect(normalizeCode("UUUU-UUUU-UUUU-UUUU")).toBeNull();
  });

  it("give a lookup id that does not contain the code", () => {
    const code = newCode();
    const id = codeId(code);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).toBe(codeId(code));
    expect(id.toUpperCase()).not.toContain(code.slice(0, 6));
  });

  it("open their own admission and nothing opens it without the code", () => {
    const code = newCode();
    const key = newRoomKey();
    const sealed = sealAdmission(code, { v: 1, room: "abcdefghijkm", key: toBase64Url(key), paddle: 7 });
    // Positive control: the right code reads the paddle back.
    expect(openAdmission(code, sealed).paddle).toBe(7);
    // Negative: another code, or one changed character, does not open it.
    expect(() => openAdmission(newCode(), sealed)).toThrow();
    const typo = code.slice(0, 15) + (code[15] === "0" ? "1" : "0");
    expect(() => openAdmission(typo, sealed)).toThrow();
    expect(sealed).not.toContain(toBase64Url(key));
  });

  it("make a book with one distinct code per paddle", () => {
    const book = makeBook("abcdefghijkm", newRoomKey(), [1, 2, 3, 4, 5]);
    expect(new Set(book.map((b) => b.code)).size).toBe(5);
    expect(new Set(book.map((b) => b.entry.id)).size).toBe(5);
    for (const b of book) expect(openAdmission(b.code, b.entry.admission).paddle).toBe(b.paddle);
  });

  it("seal a private room's terms to its key and id", () => {
    const key = newRoomKey();
    const sealed = sealTerms(key, "abcdefghijkm", { name: "A watch" });
    expect(openTerms<{ name: string }>(key, "abcdefghijkm", sealed).name).toBe("A watch");
    expect(() => openTerms(newRoomKey(), "abcdefghijkm", sealed)).toThrow();
    expect(() => openTerms(key, "zzzzzzzzzzzz", sealed)).toThrow();
  });

  it("seal the room key to an attester's box key only", () => {
    const attester = p256.keygen();
    const other = p256.keygen();
    const key = newRoomKey();
    const sealed = sealToBox(attester.publicKey, "abcdefghijkm", key);
    expect(toBase64Url(openFromBox(attester.secretKey, "abcdefghijkm", sealed))).toBe(toBase64Url(key));
    expect(() => openFromBox(other.secretKey, "abcdefghijkm", sealed)).toThrow();
  });
});
