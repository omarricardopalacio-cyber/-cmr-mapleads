// content/core/message-sender.js — Envío con InputEvent moderno + fallback execCommand.
// Pipeline: focusComposer → injectText → dispatchEvents → clickSend → verifySent.
(function () {
  const sel = () => window.__engineSelectors;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function focusComposer() {
    const input = sel().findOne("composer");
    if (!input) return null;
    input.focus();
    return input;
  }

  function injectText(input, text) {
    // Estrategia 1: InputEvent moderno (preferida).
    try {
      input.focus();
      // Limpiar primero
      const sel0 = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      sel0.removeAllRanges();
      sel0.addRange(range);

      const evt = new InputEvent("beforeinput", {
        inputType: "insertText",
        data: text,
        bubbles: true,
        cancelable: true,
      });
      const accepted = input.dispatchEvent(evt);
      if (accepted && input.innerText.includes(text)) return true;
    } catch {}

    // Estrategia 2: execCommand (deprecated pero todavía funciona en WhatsApp Web).
    try {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, text);
      if (input.innerText.includes(text)) return true;
    } catch {}

    // Estrategia 3: setear textContent + InputEvent input.
    try {
      input.textContent = text;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return input.innerText.includes(text);
    } catch {
      return false;
    }
  }

  function clickSend() {
    const btn = sel().findOne("sendBtn");
    if (!btn) return false;
    (btn.closest("button") || btn).click();
    return true;
  }

  async function verifySent(input) {
    // Tras enviar, el composer queda vacío.
    for (let i = 0; i < 10; i++) {
      await sleep(120);
      if (!input.innerText.trim()) return true;
    }
    return false;
  }

  async function sendMessage({ chatId, text }) {
    void chatId; // selección de chat se asume hecha por el operador / fase 2
    const input = focusComposer();
    if (!input) throw new Error("COMPOSER_NOT_FOUND");
    if (!injectText(input, text)) throw new Error("INPUT_INJECTION_FAILED");
    await sleep(180);
    if (!clickSend()) {
      // fallback Enter
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", which: 13, keyCode: 13, bubbles: true }));
    }
    const ok = await verifySent(input);
    return { sent: ok, at: Date.now() };
  }

  window.__engineSender = { sendMessage };
})();
