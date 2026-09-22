import assert from "node:assert/strict";
import {
  buildCommandIngestEvents,
  commandWaitMs,
  interpretCommandResult,
  isCommandUuid,
} from "./command-ack.ts";

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

const CMD = "11111111-1111-4111-8111-111111111111";

test("command ids must be uuid so ingest does not reject the batch", () => {
  assert.equal(isCommandUuid(CMD), true);
  assert.equal(isCommandUuid("171234-abc"), false);
  assert.equal(isCommandUuid(""), false);
});

test("a WPP send success is ack ok with messageId", () => {
  const read = interpretCommandResult({ messageId: "true_573@c.us_ABC", sent: true });
  assert.equal(read.ok, true);
  assert.equal(read.ackStatus, "ok");
  assert.equal(read.messageId, "true_573@c.us_ABC");
});

test("a send failure and a missing response are ack error", () => {
  assert.equal(interpretCommandResult({ error: "SEND_FAILED" }).ackStatus, "error");
  assert.equal(interpretCommandResult(undefined).error, "empty_command_response");
  assert.equal(interpretCommandResult({ payload: { error: "timeout" } }).error, "timeout");
});

test("successful send_message ACKs with chatId and also ingests the outbound text", () => {
  const events = buildCommandIngestEvents({
    commandId: CMD,
    commandType: "send_message",
    payload: { chatId: "573203538137@c.us", text: "CRM validation test" },
    result: { messageId: "true_573203538137@c.us_1", sent: true },
    now: 50,
  });
  assert.equal(events.length, 2);
  const ack = events[0];
  assert.equal(ack.type, "ack");
  assert.equal(ack.commandId, CMD);
  assert.equal(ack.ackStatus, "ok");
  assert.equal(ack.chatId, "573203538137@c.us");
  assert.equal(ack.contact?.phone, "573203538137");
  assert.equal((ack.payload.result as { messageId: string }).messageId, "true_573203538137@c.us_1");
  assert.equal(ack.payload.error, undefined);

  const outbound = events[1];
  assert.equal(outbound.type, "message-out");
  assert.equal(outbound.direction, "out");
  assert.equal(outbound.text, "CRM validation test");
  assert.equal(outbound.commandId, CMD);
  assert.equal(outbound.waMessageId, "true_573203538137@c.us_1");
  assert.equal(outbound.chatId, "573203538137@c.us");
});

test("a failed send ACKs error and does not invent an outbound bubble", () => {
  const events = buildCommandIngestEvents({
    commandId: CMD,
    commandType: "SEND_MESSAGE",
    payload: { chatId: "573203538137@c.us", text: "CRM validation test" },
    result: { error: "WA_SEND_ERROR_UNKNOWN" },
    now: 50,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].ackStatus, "error");
  assert.equal(events[0].payload.error, "WA_SEND_ERROR_UNKNOWN");
  assert.equal(events[0].chatId, "573203538137@c.us");
});

test("an unresolved LID is not stored as a phone", () => {
  const events = buildCommandIngestEvents({
    commandId: CMD,
    commandType: "SEND_MESSAGE",
    payload: { chatId: "123456789012345@lid", text: "hola" },
    result: { messageId: "mid", sent: true },
    now: 1,
  });
  assert.equal(events[0].contact?.waId.endsWith("@lid"), true);
  assert.equal(events[0].contact?.phone, undefined);
});

test("send waits longer than the sender timeout", () => {
  assert.ok(commandWaitMs("SEND_MESSAGE") >= 150_000);
  assert.ok(commandWaitMs("SEND_MEDIA") >= 540_000);
  assert.equal(commandWaitMs("PING"), 15_000);
});
