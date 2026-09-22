import assert from "node:assert/strict";
import {
  commandsRoutingError,
  describeTransportError,
  interpretCommandsResponse,
  interpretIngestResponse,
  unavailableMedia,
} from "./backend-response.ts";

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

const url = "https://creadorpaginasmapleads.netlify.app/crm/api/public/engine/commands";

test("HTML 200 is a routing error that names the URL", () => {
  const read = interpretCommandsResponse({
    url,
    status: 200,
    ok: true,
    contentType: "text/html; charset=utf-8",
    body: "<!DOCTYPE html><html><body>SPA</body></html>",
  });
  assert.equal(read.ok, false);
  if (!read.ok) {
    assert.equal(read.message, commandsRoutingError(url));
    assert.equal(read.message.includes("Failed to fetch"), false);
    assert.equal(read.message.includes(url), true);
  }
});

test("a non-json body is the same routing error", () => {
  const read = interpretCommandsResponse({
    url,
    status: 200,
    ok: true,
    contentType: "text/plain",
    body: "not-json",
  });
  assert.equal(read.ok, false);
});

test("JSON commands still parse", () => {
  const read = interpretCommandsResponse({
    url,
    status: 200,
    ok: true,
    contentType: "application/json",
    body: JSON.stringify({ commands: [{ id: "1", type: "PING" }] }),
  });
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.commands.length, 1);
});

test("Failed to fetch names the URL and is not the raw browser message", () => {
  const message = describeTransportError(url, new TypeError("Failed to fetch"));
  assert.equal(message.includes("Failed to fetch"), false);
  assert.equal(message.includes(url), true);
});

test("ingest 400 JSON for an empty batch is not a fatal non-JSON error", () => {
  const ingestUrl = "https://creadorpaginasmapleads.netlify.app/crm/api/public/engine/ingest";
  const read = interpretIngestResponse({
    url: ingestUrl,
    status: 400,
    ok: false,
    contentType: "application/json",
    body: JSON.stringify({ error: "Invalid payload" }),
  });
  assert.equal(read.action, "ignore");
  if (read.action === "ignore") {
    assert.equal(read.message.includes("no devolvió JSON"), false);
    assert.equal(read.message, "Invalid payload");
  }
});

test("ingest HTML is a real failure", () => {
  const read = interpretIngestResponse({
    url: "https://crm.example/ingest",
    status: 200,
    ok: true,
    contentType: "text/html",
    body: "<!DOCTYPE html><html></html>",
  });
  assert.equal(read.action, "fail");
});

test("a network miss does not claim the CRM returned non-JSON", () => {
  const message = describeTransportError(
    "https://creadorpaginasmapleads.netlify.app/crm/api/public/engine/ingest",
    new TypeError("Failed to fetch"),
  );
  assert.equal(message.includes("no devolvió JSON"), false);
  assert.equal(message.includes("Sin respuesta de red"), true);
});

test("missing media is labeled without throwing", () => {
  const media = unavailableMedia({ type: "document", mimetype: "application/vnd.rar" });
  assert.equal(media.missing_media, true);
  assert.equal(media.label, "Multimedia no disponible");
  assert.equal(media.extraction_error, "unavailable_on_device");
  assert.equal(media.type, "document");
});
