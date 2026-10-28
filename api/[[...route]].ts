import { handle } from "hono/vercel";
import { createApp } from "../server/src/app";
import { openLibsql } from "../server/src/libsql";
import type { Attester } from "../app/src/lib/api-types";

// The directory as one Vercel function, on Turso. The committee and the relay token come from the project's environment.

const committee: Attester[] = JSON.parse(process.env.IC_COMMITTEE ?? "[]");
const relayToken = process.env.IC_RELAY_TOKEN ?? "";
const db = await openLibsql(process.env.TURSO_DATABASE_URL ?? "", process.env.TURSO_AUTH_TOKEN);
const handler = handle(createApp({ db, committee, relayToken }));

export const GET = handler;
export const POST = handler;
