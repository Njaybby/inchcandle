import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { openSqlite } from "./db";
import { openLibsql } from "./libsql";
import { createApp } from "./app";
import type { Attester } from "../../app/src/lib/api-types";

// Runs the directory locally on Node with a SQLite file, or on libSQL when TURSO_DATABASE_URL is set. Hosted, the same app runs as a Vercel function on Turso.

const root = new URL("../", import.meta.url).pathname;
const dataDir = process.env.IC_DATA ?? `${root}data`;
mkdirSync(dataDir, { recursive: true });
const committeeFile = process.env.IC_COMMITTEE ?? `${root}../relay/committee.json`;
const committee: Attester[] = existsSync(committeeFile) ? JSON.parse(readFileSync(committeeFile, "utf8")) : [];
const relayToken = process.env.IC_RELAY_TOKEN ?? (existsSync(`${root}../relay/keys/relay-token`) ? readFileSync(`${root}../relay/keys/relay-token`, "utf8").trim() : "");
const port = Number(process.env.PORT ?? 5242);

const db = process.env.TURSO_DATABASE_URL ? await openLibsql(process.env.TURSO_DATABASE_URL, process.env.TURSO_AUTH_TOKEN) : await openSqlite(`${dataDir}/inchcandle.db`);
const app = createApp({ db, committee, relayToken });
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`directory on http://127.0.0.1:${port}/api with ${committee.length} attesters${relayToken ? " and a relay token" : ""}`);
});
