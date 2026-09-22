import assert from "node:assert/strict";
import {
  hasVisibleMessageText,
  isBase64Thumbnail,
  sanitizeMessageBody,
  visibleTextFromParts,
} from "./message-text.ts";

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

test("emoji-only text is visible and is not a thumbnail", () => {
  const emoji = "😆 🤣";
  assert.equal(hasVisibleMessageText(emoji), true);
  assert.equal(isBase64Thumbnail(emoji), false);
  assert.equal(sanitizeMessageBody({ body: emoji, type: "chat" }), emoji);
});

test("a long emoji string without spaces is not dropped as base64", () => {
  const emoji = "😆".repeat(80);
  assert.equal(emoji.length > 150, true);
  assert.equal(isBase64Thumbnail(emoji), false);
  assert.equal(hasVisibleMessageText(emoji), true);
  assert.equal(sanitizeMessageBody({ body: emoji, type: "chat" }), emoji);
});

test("jpeg thumbnails are still rejected", () => {
  const thumb = "/9j/" + "A".repeat(180);
  assert.equal(isBase64Thumbnail(thumb), true);
  assert.equal(hasVisibleMessageText(thumb), false);
  assert.equal(sanitizeMessageBody({ body: thumb, type: "image", caption: "foto" }), "foto");
});

test("emoji alt text fills an empty bubble", () => {
  assert.equal(
    visibleTextFromParts({ innerText: "", alts: ["😆", "🤣"] }),
    "😆 🤣",
  );
  assert.equal(
    visibleTextFromParts({ innerText: "hola", alts: ["😆"] }),
    "hola 😆",
  );
  assert.equal(
    visibleTextFromParts({ innerText: "hola 😆", alts: ["😆"] }),
    "hola 😆",
  );
});

test("blank and system banners are not visible chat text", () => {
  assert.equal(hasVisibleMessageText("   "), false);
  assert.equal(hasVisibleMessageText("Los mensajes están cifrados de extremo a extremo"), false);
});
