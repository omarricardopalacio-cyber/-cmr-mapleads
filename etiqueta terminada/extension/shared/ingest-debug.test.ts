import assert from "node:assert/strict";
import {
  chatEventIsPostable,
  clipJid,
  ingestBodySnippet,
  shouldSkipDuplicateIngest,
  usableChatId,
} from "./ingest-debug.ts";

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

const now = 1_700_000_000_000;

test("an empty shell does not block the emoji body for the same id", () => {
  const previous = { at: now - 2_000, text: "", posted: true };
  assert.equal(
    shouldSkipDuplicateIngest({ previous, nextText: "😆 🤣", now }),
    false,
  );
  assert.equal(
    shouldSkipDuplicateIngest({
      previous: { at: now - 2_000, text: "😆 🤣", posted: true },
      nextText: "😆 🤣",
      now,
    }),
    true,
  );
});

test("a legacy numeric seen stamp does not swallow a later emoji", () => {
  assert.equal(
    shouldSkipDuplicateIngest({ previous: now - 1_000, nextText: "😆 🤣", now }),
    false,
  );
});

test("emoji-only inbound is postable and a blank chat shell is not", () => {
  assert.equal(chatEventIsPostable({ type: "NEW_MESSAGE", text: "😆 🤣" }), true);
  assert.equal(chatEventIsPostable({ type: "NEW_MESSAGE", text: "   " }), false);
  assert.equal(chatEventIsPostable({ type: "NEW_MESSAGE", text: "", media: { type: "image" } }), true);
  assert.equal(chatEventIsPostable({ type: "HEARTBEAT", text: "" }), true);
});

test("unknown chat id is not usable; a LID still is", () => {
  assert.equal(usableChatId("unknown", ""), undefined);
  assert.equal(usableChatId("", "28458470141990@lid"), "28458470141990@lid");
  assert.equal(usableChatId("573104611415@c.us"), "573104611415@c.us");
});

test("jid clip keeps the domain so the batch stays inside the CRM schema", () => {
  const long = `${"1".repeat(80)}@lid`;
  const clipped = clipJid(long, 64);
  assert.ok(clipped);
  assert.equal(clipped!.length <= 64, true);
  assert.equal(clipped!.endsWith("@lid"), true);
});

test("ingest debug snippet is one line", () => {
  const snippet = ingestBodySnippet('{"ok":true,\n"processed":1}   extra');
  assert.equal(snippet.includes("\n"), false);
  assert.equal(snippet.startsWith('{"ok":true,'), true);
});
