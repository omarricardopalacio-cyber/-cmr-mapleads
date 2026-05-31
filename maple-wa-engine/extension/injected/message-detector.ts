// ============================================================
// MAPLE WA ENGINE — Message Detector (Injected Script)
// Detección adicional de mensajes y acks
// ============================================================

import { getWPP } from "./wpp-bootstrap";

export async function getMessageById(msgId: string): Promise<any> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");
  return WPP.chat.getMessageById(msgId);
}

export async function getMessagesByChatId(
  chatId: string,
  count = 50
): Promise<any[]> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");
  return WPP.chat.getMessages(chatId, { count });
}

export async function deleteMessage(msgId: string, everyone = false): Promise<void> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");
  return WPP.chat.deleteMessage(msgId, everyone);
}

export function subscribeToAck(
  msgId: string,
  callback: (ack: number) => void
): () => void {
  const WPP = getWPP();
  if (!WPP) {
    console.warn("[MessageDetector] WPP no disponible para ack subscription");
    return () => {};
  }

  // WA-JS no expone un listener directo de ack por msgId,
  // pero podemos hacer polling ligero
  let lastAck = -1;
  let active = true;

  const check = async () => {
    if (!active) return;
    try {
      const msg = await WPP.chat.getMessageById(msgId);
      if (msg && msg.ack !== undefined && msg.ack !== lastAck) {
        lastAck = msg.ack;
        callback(msg.ack);
        if (msg.ack >= 3) {
          active = false;
          return;
        }
      }
    } catch (e) {}
    if (active) setTimeout(check, 500);
  };

  check();
  return () => { active = false; };
}
