// content/core/message-sender.js — Envío robusto con apertura de chat + DOM injection.
// Pipeline: openChat → focusComposer → injectText → dispatchEvents → clickSend/Enter → verifySent.
(function () {
  const sel = () => window.__engineSelectors;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function openChat(chatId) {
    if (!chatId) return true;
    // Si el header ya muestra ese chat, no hacemos nada.
    const header = sel().findOne("chatHeader");
    if (header?.getAttribute("data-id") === chatId) return true;

    // Buscar en la lista lateral.
    const candidates = [
      `[data-testid="cell-frame-container"] [data-id="${chatId}"]`,
      `div[role="listitem"] [data-id="${chatId}"]`,
      `[data-id="${chatId}"]`,
    ];
    for (const q of candidates) {
      const item = document.querySelector(q);
      if (item) {
        const clickable = item.closest('[role="listitem"], [role="row"], div[tabindex]') || item;
        clickable.click();
        for (let i = 0; i < 20; i++) {
          await sleep(150);
          const h = sel().findOne("chatHeader");
          if (h?.getAttribute("data-id") === chatId || sel().findOne("composer")) return true;
        }
        return true;
      }
    }
    // No encontrado — seguimos igual; tal vez el chat ya está abierto sin data-id en header.
    return false;
  }

  function focusComposer() {
    const input = sel().findOne("composer");
    if (!input) return null;
    input.focus();
    // Mover caret al final
    try {
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
    } catch {}
    return input;
  }

  function fireEvents(el, text) {
    try {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
    } catch {}
    try {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {}
    try {
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a", code: "KeyA" }));
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a", code: "KeyA" }));
    } catch {}
  }

  function injectText(input, text) {
    // Estrategia 1: beforeinput + execCommand insertText (la que mejor funciona en WA Web).
    try {
      input.focus();
      // Seleccionar todo y limpiar
      const sel0 = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      sel0.removeAllRanges();
      sel0.addRange(range);
      document.execCommand("delete", false);

      input.dispatchEvent(new InputEvent("beforeinput", {
        inputType: "insertText", data: text, bubbles: true, cancelable: true,
      }));
      const ok = document.execCommand("insertText", false, text);
      fireEvents(input, text);
      if (ok && (input.innerText || input.textContent || "").includes(text)) return true;
    } catch {}

    // Estrategia 2: insertar nodo de texto manual.
    try {
      input.focus();
      input.innerHTML = "";
      const textNode = document.createTextNode(text);
      input.appendChild(textNode);
      fireEvents(input, text);
      if ((input.innerText || input.textContent || "").includes(text)) return true;
    } catch {}

    // Estrategia 3: textContent + InputEvent.
    try {
      input.textContent = text;
      fireEvents(input, text);
      return (input.innerText || input.textContent || "").includes(text);
    } catch {
      return false;
    }
  }

  function clickSend() {
    const btn = sel().findOne("sendBtn");
    if (!btn) return false;
    const target =
      btn.closest('button') ||
      btn.closest('[role="button"]') ||
      btn.closest('div[aria-label]') ||
      btn.parentElement ||
      btn;

    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };

    try { target.dispatchEvent(new PointerEvent("pointerdown", opts)); } catch {}
    try { target.dispatchEvent(new MouseEvent("mousedown", opts)); } catch {}
    try { target.dispatchEvent(new PointerEvent("pointerup", opts)); } catch {}
    try { target.dispatchEvent(new MouseEvent("mouseup", opts)); } catch {}
    try { target.dispatchEvent(new MouseEvent("click", opts)); } catch {}
    try { target.click(); } catch {}
    return true;
  }


  function pressEnter(input) {
    const opts = { key: "Enter", code: "Enter", which: 13, keyCode: 13, bubbles: true, cancelable: true };
    input.dispatchEvent(new KeyboardEvent("keydown", opts));
    input.dispatchEvent(new KeyboardEvent("keypress", opts));
    input.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  async function verifySent(input) {
    for (let i = 0; i < 15; i++) {
      await sleep(120);
      const t = (input.innerText || input.textContent || "").trim();
      if (!t) return true;
    }
    return false;
  }

  async function sendMessage({ chatId, text }) {
    if (!text) throw new Error("EMPTY_TEXT");
    await openChat(chatId);
    await sleep(300);

    const input = focusComposer();
    if (!input) throw new Error("COMPOSER_NOT_FOUND");

    if (!injectText(input, text)) throw new Error("INPUT_INJECTION_FAILED");
    await sleep(220);

    if (!clickSend()) pressEnter(input);

    const ok = await verifySent(input);
    if (!ok) {
      // segundo intento: Enter
      pressEnter(input);
      await sleep(300);
    }
    return { sent: ok, at: Date.now() };
  }

  window.__engineSender = { sendMessage, openChat };
})();
