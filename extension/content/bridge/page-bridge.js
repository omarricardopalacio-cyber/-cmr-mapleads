// content/bridge/page-bridge.js — Corre en MAIN world para acceder a Store y al editor real de WhatsApp.
(function () {
  const REQUEST = "ENGINE_PAGE_REQUEST";
  const RESPONSE = "ENGINE_PAGE_RESPONSE";

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getWebpackChunk() {
    return (
      window.webpackChunkwhatsapp_web_client ||
      window.webpackChunkbuild ||
      window.webpackChunkapp
    );
  }

  function ensureStore() {
    try {
      if (window.Store?.Chat) return true;

      const chunk = getWebpackChunk();
      if (!chunk?.push) return false;

      const modules = [];
      const tag = `engine_${Date.now()}`;
      chunk.push([
        [tag],
        {},
        function (req) {
          for (const id in req.m) {
            try {
              modules.push(req(id));
            } catch {}
          }
        },
      ]);

      const Store = (window.Store = window.Store || {});
      for (const mod of modules) {
        if (!mod || typeof mod !== "object") continue;

        if (!Store.Chat && mod.Chat?.get) Store.Chat = mod.Chat;
        if (!Store.Chat && mod.default?.Chat?.get) Store.Chat = mod.default.Chat;

        if (!Store.SendTextMsgToChat && typeof mod.SendTextMsgToChat === "function") {
          Store.SendTextMsgToChat = mod.SendTextMsgToChat;
        }
        if (!Store.SendTextMsgToChat && typeof mod.sendTextMsgToChat === "function") {
          Store.SendTextMsgToChat = mod.sendTextMsgToChat;
        }

        if (!Store.FindOrCreateChat && mod.FindOrCreateChat?.findOrCreateLatestChat) {
          Store.FindOrCreateChat = mod.FindOrCreateChat;
        }
        if (!Store.FindOrCreateChat && mod.default?.findOrCreateLatestChat) {
          Store.FindOrCreateChat = mod.default;
        }
      }

      if (Store.Chat?.modelClass?.prototype && !Store.Chat.modelClass.prototype.sendMessage && Store.SendTextMsgToChat) {
        Store.Chat.modelClass.prototype.sendMessage = function (...args) {
          return Store.SendTextMsgToChat(this, ...args);
        };
      }

      return !!window.Store?.Chat;
    } catch {
      return false;
    }
  }

  async function trySendViaStore(chatId, text) {
    if (!chatId || !text) return { ok: false, error: "missing_params" };
    if (!ensureStore()) return { ok: false, error: "store_unavailable" };

    try {
      const Store = window.Store;
      let chat = Store.Chat?.get?.(chatId);
      if (!chat && typeof Store.Chat?.find === "function") {
        chat = await Store.Chat.find(chatId);
      }
      if (!chat && Store.FindOrCreateChat?.findOrCreateLatestChat) {
        chat = await Store.FindOrCreateChat.findOrCreateLatestChat(chatId);
      }
      if (!chat) return { ok: false, error: "chat_not_found" };

      if (typeof chat.sendMessage === "function") {
        await chat.sendMessage(text);
        return { ok: true, via: "store" };
      }

      if (typeof Store.SendTextMsgToChat === "function") {
        await Store.SendTextMsgToChat(chat, text);
        return { ok: true, via: "store" };
      }

      return { ok: false, error: "send_api_missing" };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }

  function dispatchInputEvents(input, text) {
    try {
      input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
    } catch {}
    try {
      input.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
    } catch {}
    try {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {}
  }

  function locateComposer() {
    return (
      document.querySelector('[data-testid="conversation-compose-box-input"]') ||
      document.querySelector('footer div[contenteditable="true"]') ||
      document.querySelector('div[contenteditable="true"][role="textbox"]')
    );
  }

  function locateSendButton() {
    return (
      document.querySelector('[data-testid="compose-btn-send"]') ||
      document.querySelector('[data-testid="send"]') ||
      document.querySelector('button[aria-label="Enviar"]') ||
      document.querySelector('button[aria-label="Send"]') ||
      document.querySelector('span[data-icon="send"]') ||
      document.querySelector('span[data-icon="wds-ic-send-filled"]')
    );
  }

  function clickLikeUser(target) {
    if (!target) return false;
    const button = target.closest('button,[role="button"],div[aria-label]') || target;
    const rect = button.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
    };
    try { button.dispatchEvent(new PointerEvent("pointerdown", opts)); } catch {}
    try { button.dispatchEvent(new MouseEvent("mousedown", opts)); } catch {}
    try { button.dispatchEvent(new PointerEvent("pointerup", opts)); } catch {}
    try { button.dispatchEvent(new MouseEvent("mouseup", opts)); } catch {}
    try { button.dispatchEvent(new MouseEvent("click", opts)); } catch {}
    try { button.click(); } catch {}
    return true;
  }

  async function injectComposerText(text) {
    const input = locateComposer();
    if (!input) return { ok: false, error: "composer_not_found" };

    try {
      input.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("delete", false);
      const inserted = document.execCommand("insertText", false, text);
      dispatchInputEvents(input, text);
      if (inserted || (input.innerText || input.textContent || "").includes(text)) {
        return { ok: true, via: "dom", mode: "execCommand" };
      }
    } catch {}

    try {
      input.focus();
      input.textContent = text;
      dispatchInputEvents(input, text);
      if ((input.innerText || input.textContent || "").includes(text)) {
        return { ok: true, via: "dom", mode: "textContent" };
      }
    } catch {}

    return { ok: false, error: "input_injection_failed" };
  }

  async function triggerSend() {
    const button = locateSendButton();
    if (button && clickLikeUser(button)) return { ok: true, mode: "button" };

    const input = locateComposer();
    if (!input) return { ok: false, error: "composer_not_found" };

    const opts = { key: "Enter", code: "Enter", which: 13, keyCode: 13, bubbles: true, cancelable: true };
    try { input.dispatchEvent(new KeyboardEvent("keydown", opts)); } catch {}
    try { input.dispatchEvent(new KeyboardEvent("keypress", opts)); } catch {}
    try { input.dispatchEvent(new KeyboardEvent("keyup", opts)); } catch {}
    return { ok: true, mode: "enter" };
  }

  async function verifyComposerCleared() {
    for (let i = 0; i < 12; i++) {
      await sleep(150);
      const input = locateComposer();
      const value = (input?.innerText || input?.textContent || "").trim();
      if (!value) return true;
    }
    return false;
  }

  async function openViaUrl(chatId) {
    const phone = String(chatId || "").replace(/@c\.us$/i, "").replace(/\D/g, "");
    if (!phone) return { ok: false, error: "invalid_chat_id" };
    const target = `https://web.whatsapp.com/send?phone=${phone}`;
    if (location.href !== target) location.href = target;

    for (let i = 0; i < 30; i++) {
      await sleep(300);
      if (locateComposer()) return { ok: true };
    }
    return { ok: false, error: "composer_not_found_after_url" };
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== REQUEST || !data.id) return;

    let result = { ok: false, error: "unknown_action" };

    if (data.action === "bootstrap_store") {
      result = { ok: ensureStore() };
    } else if (data.action === "send_via_store") {
      result = await trySendViaStore(data.chatId, data.text);
    } else if (data.action === "inject_and_send") {
      const injected = await injectComposerText(data.text);
      if (!injected.ok) result = injected;
      else {
        await sleep(120);
        const sent = await triggerSend();
        const cleared = sent.ok ? await verifyComposerCleared() : false;
        result = { ok: sent.ok, via: "dom", mode: sent.mode, cleared };
      }
    } else if (data.action === "open_chat_url") {
      result = await openViaUrl(data.chatId);
    }

    window.postMessage({ type: RESPONSE, id: data.id, result }, "*");
  });
})();