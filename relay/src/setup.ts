import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { p256 } from "@noble/curves/nist.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toBase64Url } from "../../app/src/lib/bytes";
import type { Attester } from "../../app/src/lib/api-types";
import { deviceIdOf, root, type AttesterKeys } from "./keys";

// Makes the committee for local development: three attesters, the relay's token, and committee.json with their public halves.
// For a real deployment run it on each attester's own machine and collect only the public halves.

const names = ["Attester Larch", "Attester Quill", "Attester Harrow"];
mkdirSync(`${root}keys`, { recursive: true });
const committee: Attester[] = [];
names.forEach((name, i) => {
  const file = `${root}keys/attester-${i + 1}.json`;
  let keys: AttesterKeys;
  if (existsSync(file)) {
    keys = JSON.parse(readFileSync(file, "utf8"));
  } else {
    keys = { name, evmKey: generatePrivateKey(), deviceSecret: toBase64Url(p256.utils.randomSecretKey()), boxSecret: toBase64Url(p256.utils.randomSecretKey()) };
    writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
  }
  const box = p256.getPublicKey(Buffer.from(keys.boxSecret, "base64url"), false);
  committee.push({ id: deviceIdOf(keys.deviceSecret), name, address: privateKeyToAccount(keys.evmKey).address, boxKey: toBase64Url(box) });
});
writeFileSync(`${root}committee.json`, JSON.stringify(committee, null, 2) + "\n");
if (!existsSync(`${root}keys/relay-token`)) writeFileSync(`${root}keys/relay-token`, randomBytes(24).toString("base64url"), { mode: 0o600 });
console.log(committee.map((a) => `${a.name}  ${a.address}`).join("\n"));
