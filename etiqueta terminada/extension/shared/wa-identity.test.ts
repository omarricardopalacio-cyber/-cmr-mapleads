import assert from "node:assert/strict";
import {
  buildIngestContact,
  canonicalWaId,
  looksLikeLidDigits,
  peerProfilePictureUrl,
  sameProfilePicture,
  sanitizePhoneForIngest,
} from "./wa-identity.ts";

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

test("keeps a real Colombian mobile", () => {
  assert.equal(sanitizePhoneForIngest("573001234567"), "573001234567");
  assert.equal(canonicalWaId("573001234567"), "573001234567@c.us");
  assert.equal(canonicalWaId("573001234567@c.us"), "573001234567@c.us");
});

test("does not send @lid user-part as phone", () => {
  const lid = "559591234567890@lid";
  assert.equal(sanitizePhoneForIngest("559591234567890", lid), undefined);
  assert.equal(canonicalWaId(lid), lid);
  const built = buildIngestContact({
    counterpartJid: lid,
    contactWaId: lid,
    contactPhone: "559591234567890",
  });
  assert.equal(built.phone, undefined);
  assert.equal(built.contact?.phone, undefined);
  assert.equal(built.contact?.waId, lid);
  assert.equal(built.chatId, lid);
});

test("rewrites fake +1 LID phones to @lid", () => {
  const fake = "120363193653236531";
  assert.equal(looksLikeLidDigits(fake), true);
  assert.equal(sanitizePhoneForIngest(fake), undefined);
  assert.equal(sanitizePhoneForIngest(`${fake}@c.us`), undefined);
  assert.equal(canonicalWaId(fake), `${fake}@lid`);
  assert.equal(canonicalWaId(`${fake}@c.us`), `${fake}@lid`);
  const built = buildIngestContact({
    counterpartJid: `${fake}@lid`,
    contactPhone: fake,
    contactWaId: `${fake}@c.us`,
  });
  assert.equal(built.phone, undefined);
  assert.equal(built.contact?.waId, `${fake}@lid`);
});

test("raw long ids stay @lid with empty phone", () => {
  const raw = "349851234567890123";
  const built = buildIngestContact({
    counterpartJid: raw,
    contactPhone: raw,
    contactWaId: raw,
  });
  assert.equal(built.phone, undefined);
  assert.equal(built.contact?.waId, `${raw}@lid`);
});

test("resolved phone replaces the lid jid", () => {
  const built = buildIngestContact({
    counterpartJid: "559591234567890@lid",
    contactWaId: "573001234567@c.us",
    contactPhone: "573001234567",
    profilePictureUrl: "https://pps.whatsapp.net/v/example.jpg",
  });
  assert.equal(built.phone, "573001234567");
  assert.equal(built.contact?.waId, "573001234567@c.us");
  assert.equal(built.contact?.profilePictureUrl, "https://pps.whatsapp.net/v/example.jpg");
});

test("drops non-http profile pictures", () => {
  const built = buildIngestContact({
    counterpartJid: "573001234567@c.us",
    profilePictureUrl: "blob:https://web.whatsapp.com/abc",
  });
  assert.equal(built.contact?.profilePictureUrl, undefined);
});

test("CONTACT_INFO keeps the @lid key and the real phone", () => {
  const built = buildIngestContact({
    keepLidKey: true,
    counterpartJid: "559591234567890@lid",
    contactWaId: "559591234567890@lid",
    contactPhone: "573001234567",
    profilePictureUrl: "https://pps.whatsapp.net/v/t61/example.jpg",
  });
  assert.equal(built.contact?.waId, "559591234567890@lid");
  assert.equal(built.phone, "573001234567");
  assert.equal(built.contact?.profilePictureUrl, "https://pps.whatsapp.net/v/t61/example.jpg");
});

test("does not attach the session avatar to a peer", () => {
  const me = "https://pps.whatsapp.net/v/t61.24694-24/421234567890_n.jpg?ccb=11-4&oh=abc&oe=def";
  const meSignedAgain = "https://pps.whatsapp.net/v/t61.24694-24/421234567890_n.jpg?ccb=99&oh=zzz&oe=yyy";
  const peer = "https://pps.whatsapp.net/v/t61.24694-24/999888777666_n.jpg?ccb=11-4&oh=peer";
  assert.equal(sameProfilePicture(me, meSignedAgain), true);
  assert.equal(sameProfilePicture(me, peer), false);
  assert.equal(peerProfilePictureUrl(meSignedAgain, [me]), undefined);
  assert.equal(peerProfilePictureUrl(peer, [me]), peer);
  assert.equal(peerProfilePictureUrl("https://static.whatsapp.net/rsrc/icon-unread-count.svg", [me]), undefined);
  const built = buildIngestContact({
    counterpartJid: "573027879979@c.us",
    contactWaId: "573027879979@c.us",
    contactPhone: "573027879979",
    profilePictureUrl: meSignedAgain,
    ownProfilePictureUrls: [me],
  });
  assert.equal(built.phone, "573027879979");
  assert.equal(built.contact?.profilePictureUrl, undefined);
  const kept = buildIngestContact({
    counterpartJid: "573027879979@c.us",
    contactPhone: "573027879979",
    profilePictureUrl: peer,
    ownProfilePictureUrls: [me],
  });
  assert.equal(kept.contact?.profilePictureUrl, peer);
});

test("14-digit numbers starting with 1 are not phones", () => {
  assert.equal(sanitizePhoneForIngest("120363193653236"), undefined);
  assert.equal(canonicalWaId("120363193653236"), "120363193653236@lid");
});
