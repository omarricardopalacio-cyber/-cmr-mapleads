// sender.js — Inyecta texto en el input de WhatsApp y pulsa el botón enviar.

(function () {
  async function openChat(chatId) {
    // Estrategia mínima: si chatId es un número, usar wa.me deep link interno.
    // Si ya estamos en el chat correcto, no hacer nada.
    // (Versión robusta requiere store interno; se deja para Fase 2.)
    return true;
  }

  function setInputText(text) {
    const input = document.querySelector('div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]');
    if (!input) return false;
    input.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, text);
    return true;
  }

  function clickSend() {
    const btn = document.querySelector('button[data-tab="11"], button[aria-label="Enviar"], span[data-icon="send"]');
    if (!btn) return false;
    (btn.closest("button") || btn).click();
    return true;
  }

  async function sendMessage({ chatId, text }) {
    await openChat(chatId);
    if (!setInputText(text)) throw new Error("INPUT_NOT_FOUND");
    await new Promise((r) => setTimeout(r, 250));
    if (!clickSend()) throw new Error("SEND_BUTTON_NOT_FOUND");
    return { sent: true, at: Date.now() };
  }

  window.__engineSender = { sendMessage };
})();
