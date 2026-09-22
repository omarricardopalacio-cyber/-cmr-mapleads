import assert from "node:assert/strict";
import { noteDetectedPeer, recentPeerText, wasRecentlyDetected } from "./recent-detect.ts";

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

const now = 5_000_000;

test("an empty WPP hit does not hide the list preview", () => {
  noteDetectedPeer(["573104611415@c.us"], now, "");
  assert.equal(wasRecentlyDetected("573104611415", 8_000, now + 1_000), false);
});

test("a peer already emitted with emoji text suppresses the list duplicate", () => {
  noteDetectedPeer(["573104611415@c.us", "573104611415"], now, "😆 🤣");
  assert.equal(wasRecentlyDetected("573104611415", 8_000, now + 1_000), true);
  assert.equal(recentPeerText("573104611415", 8_000, now + 1_000), "😆 🤣");
});

test("an older visible text does not count as this emoji preview", () => {
  noteDetectedPeer(["573001112233@c.us"], now, "holaaaa");
  assert.equal(recentPeerText("573001112233", 8_000, now + 1_000), "holaaaa");
  assert.equal(recentPeerText("573001112233", 8_000, now + 1_000) === "😆 🤣", false);
});
