import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PilotDatabase } from "../src/database.js";

function testDatabase() {
  return new PilotDatabase(join(mkdtempSync(join(tmpdir(), "maple-pilot-")), "pilot.sqlite"));
}

test("ingest is idempotent by WhatsApp message/event ID", () => {
  const database = testDatabase();
  const payload = {
    events: [{
      id: "event-in-1", type: "NEW_MESSAGE", timestamp: 1_700_000_000,
      payload: { messageId: "wa-1", chatId: "573001234567@c.us", from: "573001234567@c.us", body: "Hello", pushname: "Ada" },
    }],
  };
  assert.deepEqual(database.ingest(payload), { inserted: 1, duplicates: 0, acknowledgedCommands: 0 });
  assert.deepEqual(database.ingest(payload), { inserted: 0, duplicates: 1, acknowledgedCommands: 0 });
  assert.equal(database.recentMessages().length, 1);
  database.close();
});

test("command polling atomically claims and ACK events settle commands", () => {
  const database = testDatabase();
  const command = database.enqueueCommand("SEND_MESSAGE", { chatId: "573001234567@c.us", text: "Pilot outbound" });
  assert.equal(database.claimCommands().length, 1);
  assert.equal(database.claimCommands().length, 0);

  const result = database.ingest({
    events: [{ id: "ack-1", type: "MESSAGE_ACK", timestamp: Date.now(), payload: { commandId: command.id, ack: "server" } }],
  });
  assert.equal(result.acknowledgedCommands, 1);
  const row = database.db.prepare("SELECT status FROM engine_commands WHERE id = ?").get(command.id) as { status: string };
  assert.equal(row.status, "acked");
  database.close();
});
