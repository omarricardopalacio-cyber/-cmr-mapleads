import assert from "node:assert/strict";
import {
  LINK_FAILS_TO_DOWN,
  LINK_GRACE_MS,
  presentConnection,
  shouldMarkLinkDown,
} from "./link-status.ts";

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

const now = 1_000_000;

test("one failed poll does not drop the link", () => {
  assert.equal(
    shouldMarkLinkDown({ configured: true, failStreak: 1, lastOkAt: now - 1_500, now }),
    false,
  );
});

test("sustained failures after the grace mark the link down", () => {
  assert.equal(
    shouldMarkLinkDown({
      configured: true,
      failStreak: LINK_FAILS_TO_DOWN,
      lastOkAt: now - LINK_GRACE_MS,
      now,
    }),
    true,
  );
});

test("missing config is down immediately", () => {
  assert.equal(shouldMarkLinkDown({ configured: false, failStreak: 0, lastOkAt: now, now }), true);
});

test("header stays connected through one engine miss while the bridge was just OK", () => {
  const view = presentConnection({
    now,
    configured: true,
    failStreak: 1,
    lastLinkOkAt: now - 1_500,
    engineRaw: false,
    sessionRaw: false,
    bridgeRaw: false,
    lastEngineOkAt: now - 4_000,
    lastSessionOkAt: now - 4_000,
    lastBridgeOkAt: now - 4_000,
  });
  assert.equal(view.wppReady, true);
  assert.equal(view.sessionReady, true);
  assert.equal(view.backendConnected, true);
  assert.equal(view.uiConnected, true);
});

test("header matches dots when the engine has been down past the grace", () => {
  const view = presentConnection({
    now,
    configured: true,
    failStreak: 0,
    lastLinkOkAt: now - 500,
    engineRaw: false,
    sessionRaw: false,
    bridgeRaw: false,
    lastEngineOkAt: now - 30_000,
    lastSessionOkAt: now - 30_000,
    lastBridgeOkAt: now - 30_000,
  });
  assert.equal(view.wppReady, false);
  assert.equal(view.sessionReady, false);
  assert.equal(view.uiConnected, false);
  assert.equal(view.backendConnected, true);
});

test("a live bridge keeps the badge up even if the raw engine flag blipped", () => {
  const view = presentConnection({
    now,
    configured: true,
    failStreak: 2,
    lastLinkOkAt: now - 3_000,
    engineRaw: false,
    sessionRaw: false,
    bridgeRaw: true,
    lastEngineOkAt: 0,
    lastSessionOkAt: 0,
    lastBridgeOkAt: now,
  });
  assert.equal(view.uiConnected, true);
  assert.equal(view.wppReady, true);
  assert.equal(view.sessionReady, true);
});
