import crypto from 'crypto';

const sessionToken = "efa2465d9780a4e68725bec646c78f5cd3f843a8cf1ece89f979a58a76965251";
const messageText = process.argv[2] || "hola prueba contexto";
const phone = "573001234567";
const chatId = `${phone}@c.us`;
const eventId = "test-msg-" + crypto.randomBytes(8).toString('hex');

const body = {
  eventId: eventId,
  direction: "INCOMING",
  chat: {
    whatsappId: chatId
  },
  content: {
    body: messageText
  },
  contact: {
    whatsappId: chatId,
    pushName: "Tester Contexto",
    phoneNumber: phone
  },
  timestamp: Math.floor(Date.now() / 1000)
};

async function main() {
  console.log(`Sending message: "${messageText}" with eventId: ${eventId}`);
  const res = await fetch("http://localhost:8080/api/public/engine/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-session-token": sessionToken
    },
    body: JSON.stringify(body)
  });

  console.log(`Response status: ${res.status}`);
  const responseText = await res.text();
  console.log(`Response text: ${responseText}`);
}

main().catch(console.error);
