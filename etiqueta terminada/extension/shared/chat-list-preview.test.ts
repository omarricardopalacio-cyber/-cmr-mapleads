import assert from "node:assert/strict";
import {
  listPreviewMessageId,
  sentAtFromClockLabel,
  shouldEmitListRow,
  snapshotFromRowParts,
} from "./chat-list-preview.ts";

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

const now = new Date(2026, 8, 22, 17, 20, 0);

test("unread LID row from the chat list is an inbound with the visible phone", () => {
  const row = snapshotFromRowParts({
    titles: ["+57 310 4611415", "Igual muchas gracias"],
    lines: ["+57 310 4611415", "Igual muchas gracias", "5:14 p. m.", "1"],
    htmlSnippet: 'data-id="28458470141990@lid"',
    unreadLabel: "1 mensaje no leído",
    hasOutgoingTick: false,
    now,
  });
  assert.ok(row);
  assert.equal(row?.phone, "573104611415");
  assert.equal(row?.chatId, "573104611415@c.us");
  assert.equal(row?.lid, "28458470141990@lid");
  assert.equal(row?.text, "Igual muchas gracias");
  assert.equal(row?.direction, "in");
  assert.equal(row?.unread, 1);
  assert.equal(row?.sentAt, sentAtFromClockLabel("5:14 p. m.", now));
  assert.ok(listPreviewMessageId(row!).includes("573104611415"));
  assert.ok(listPreviewMessageId(row!).length <= 120);
});

test("emoji-only preview is kept as inbound text", () => {
  const row = snapshotFromRowParts({
    titles: ["+57 310 4611415", "😆 🤣"],
    lines: ["+57 310 4611415", "😆 🤣", "6:13 p. m.", "1"],
    htmlSnippet: 'data-id="28458470141990@lid"',
    unreadLabel: "1 mensaje no leído",
    hasOutgoingTick: false,
    now,
  });
  assert.equal(row?.text, "😆 🤣");
  assert.equal(row?.direction, "in");
  assert.equal(row?.chatId, "573104611415@c.us");
  assert.ok(row?.sentAt);
});

test("a check mark without unread is outgoing", () => {
  const row = snapshotFromRowParts({
    titles: ["+57 310 4611415", "Si sra"],
    lines: ["+57 310 4611415", "Si sra", "5:14 p. m."],
    hasOutgoingTick: true,
    now,
  });
  assert.equal(row?.direction, "out");
  assert.equal(row?.text, "Si sra");
  assert.equal(row?.unread, 0);
});

test("first scan emits only recent unread rows; later scans emit preview changes", () => {
  const nowMs = now.getTime();
  const recent = sentAtFromClockLabel("5:14 p. m.", now);
  const stale = new Date(nowMs - 3 * 60 * 60_000).toISOString();
  assert.equal(
    shouldEmitListRow({ previous: undefined, next: "a|1", primed: false, unread: 1, sentAt: recent, nowMs }),
    true,
  );
  assert.equal(
    shouldEmitListRow({ previous: undefined, next: "a|0", primed: false, unread: 0, sentAt: recent, nowMs }),
    false,
  );
  assert.equal(
    shouldEmitListRow({ previous: undefined, next: "old|1", primed: false, unread: 1, sentAt: stale, nowMs }),
    false,
  );
  assert.equal(
    shouldEmitListRow({
      previous: "hola|5:03|0|in",
      next: "gracias|5:14|1|in",
      primed: true,
      unread: 1,
      sentAt: recent,
      nowMs,
    }),
    true,
  );
  assert.equal(
    shouldEmitListRow({
      previous: "gracias|5:14|1|in",
      next: "gracias|5:14|1|in",
      primed: true,
      unread: 1,
      sentAt: recent,
      nowMs,
    }),
    false,
  );
  assert.equal(
    shouldEmitListRow({
      previous: undefined,
      next: "gracias|5:14|1|in",
      primed: true,
      unread: 1,
      sentAt: recent,
      nowMs,
    }),
    true,
  );
});
