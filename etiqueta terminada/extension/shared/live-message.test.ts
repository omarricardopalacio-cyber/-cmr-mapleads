import assert from "node:assert/strict";
import { coerceFromMe, peerChatJid, shouldIngestLiveMessage } from "./live-message.ts";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log("ok", name);
  } catch (err) {
    console.error("FAIL", name);
    console.error(err);
    process.exitCode = 1;
  }
}

test("string false is not an outgoing message", () => {
  assert.equal(coerceFromMe("false"), false);
  assert.equal(coerceFromMe(false, "true"), false);
  assert.equal(coerceFromMe(undefined, true), true);
  assert.equal(coerceFromMe("nope"), undefined);
});

test("LID peer stays the chat even when from is our phone", () => {
  const peer = peerChatJid({
    remote: "28458470141990@lid",
    from: "573186662364@c.us",
    to: "573186662364@c.us",
    meDigits: "573186662364",
  });
  assert.equal(peer, "28458470141990@lid");
});

test("live sync ignores history and ciphertext, keeps a fresh inbound", () => {
  const now = Date.parse("2026-09-22T22:14:00Z");
  const catchup = now - 4 * 60_000;
  assert.equal(
    shouldIngestLiveMessage({
      messageId: "false_28458470141990@lid_ABC",
      type: "chat",
      timestampSec: Math.floor(now / 1000) - 30,
      nowMs: now,
      catchupSinceMs: catchup,
    }),
    true,
  );
  assert.equal(
    shouldIngestLiveMessage({
      messageId: "old",
      type: "chat",
      timestampSec: Math.floor(now / 1000) - 3600,
      nowMs: now,
      catchupSinceMs: catchup,
    }),
    false,
  );
  assert.equal(
    shouldIngestLiveMessage({
      messageId: "cipher",
      type: "ciphertext",
      timestampSec: Math.floor(now / 1000),
      nowMs: now,
      catchupSinceMs: catchup,
    }),
    false,
  );
});
