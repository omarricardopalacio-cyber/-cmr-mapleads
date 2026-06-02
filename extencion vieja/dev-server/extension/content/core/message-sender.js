// content/core/message-sender.js — Envío robusto con apertura de chat + DOM injection.
// Pipeline: openChat → focusComposer → injectText → dispatchEvents → clickSend/Enter → verifySent.
(function () {
  const sel = () => window.__engineSelectors;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const PAGE_REQUEST = "ENGINE_PAGE_REQUEST";
  const PAGE_RESPONSE = "ENGINE_PAGE_RESPONSE";

  function callPage(action, payload = {}) {
    return new Promise((resolve) => {
      const id = `engine_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      function onMessage(event) {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.type !== PAGE_RESPONSE || data.id !== id) return;
        window.removeEventListener("message", onMessage);
        resolve(data.result || { ok: false, error: "empty_response" });
      }

      window.addEventListener("message", onMessage);
      window.postMessage({ type: PAGE_REQUEST, id, action, ...payload }, "*");
      setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve({ ok: false, error: `timeout:${action}` });
      }, 8000);
    });
  }

  async function trySendViaStore(text, chatId) {
    const boot = await callPage("bootstrap_store");
    if (!boot?.ok) return false;
    const result = await callPage("send_via_store", { chatId, text });
    return !!result?.ok;
  }

  async function openChat(chatId) {
    if (!chatId) return true;
    // Si el header ya muestra ese chat, no hacemos nada.
    const header = sel().findOne("chatHeader");
    const currentId = header?.getAttribute("data-id");
    if (currentId === chatId) return true;

    const waitCurrent = await callPage("wait_for_target_chat", {
      chatId,
      options: { attempts: 2, delay: 0 },
    });
    if (waitCurrent?.ok) return true;

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
    const viaUrl = await callPage("open_chat_url", { chatId });
    if (!viaUrl?.ok) return false;
    const ready = await callPage("wait_for_target_chat", {
      chatId,
      options: { attempts: 20, delay: 200 },
    });
    return !!ready?.ok;
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

    if (await trySendViaStore(text, chatId)) {
      return { sent: true, via: "store", at: Date.now() };
    }

    const opened = await openChat(chatId);
    if (!opened) throw new Error("TARGET_CHAT_NOT_READY");
    await sleep(300);

    const injected = await callPage("inject_and_send", { text });
    if (injected?.ok) {
      return {
        sent: injected.cleared !== false,
        via: "dom-main",
        mode: injected.mode,
        at: Date.now(),
      };
    }

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
    return { sent: ok, via: "dom", at: Date.now() };
  }

  window.__engineSender = { sendMessage, openChat };
})();
