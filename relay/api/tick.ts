import { attester } from "../src/attester-core";
import { attesterFromEnv } from "../src/keys";

// One attester as a Vercel function. Each request runs one pass; the relay calls it every few seconds.

const a = attester(attesterFromEnv(0), process.env.IC_API ?? "");

export async function GET() {
  try {
    return Response.json({ attester: a.address, rooms: await a.tick() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
