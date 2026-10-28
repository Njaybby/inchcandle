import { createServer } from "node:http";
import { attester } from "./attester-core";
import { attesterFromEnv } from "./keys";

// One attester as a long-running process, for Fly, Render or a laptop.
// It loops every few seconds and also answers GET /tick, so a host that sleeps when idle wakes on the relay's nudge.

const a = attester(attesterFromEnv(Number(process.argv[2] ?? process.env.IC_ATTESTER ?? 1)), process.env.IC_API ?? "http://127.0.0.1:5242");
let running: Promise<number> | null = null;
const pass = () => (running ??= a.tick().finally(() => (running = null)));

async function loop() {
  await pass().catch((e) => a.log("directory unreachable", e instanceof Error ? e.message : e));
  setTimeout(loop, 4000);
}

const port = Number(process.env.PORT ?? 0);
if (port)
  createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/tick") {
      try {
        const rooms = await pass();
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ attester: a.address, rooms }));
      } catch (e) {
        res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
    } else res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ attester: a.address, name: a.name }));
  }).listen(port, "0.0.0.0", () => a.log(`listening on ${port}`));

a.log(`attesting as ${a.address}`);
loop();
