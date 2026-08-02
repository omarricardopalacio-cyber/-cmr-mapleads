import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { PilotDatabase } from "../src/database.js";
import { startPilotServer } from "../src/server.js";

test("local API exposes health but protects messages and ingest", async () => {
  const directory = mkdtempSync(join(tmpdir(), "maple-pilot-server-"));
  const database = new PilotDatabase(join(directory, "pilot.sqlite"));
  const token = database.getOrCreateToken();
  const server = await startPilotServer(database, join(directory, "media"), 0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);

    const unauthorized = await fetch(`${base}/api/local/messages`);
    assert.equal(unauthorized.status, 401);

    const ingest = await fetch(`${base}/api/public/engine/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Token": token,
      },
      body: JSON.stringify({
        events: [{
          id: "server-event-1",
          type: "NEW_MESSAGE",
          payload: {
            messageId: "server-wa-1",
            chatId: "573001234567@c.us",
            from: "573001234567@c.us",
            body: "Local API",
          },
        }],
      }),
    });
    assert.equal(ingest.status, 200);
    assert.equal((await ingest.json() as { inserted: number }).inserted, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  }
});
