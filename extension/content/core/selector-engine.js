// content/core/selector-engine.js — Registro central de selectores con fallback.
// Si WhatsApp cambia el DOM, solo se toca este archivo.
(function () {
  const REGISTRY = {
    appReady: ["#app", "#main", 'div[id="app"]'],
    messagesPanel: [
      '[data-testid="conversation-panel-messages"]',
      '[data-testid="conversation-panel"]',
      "#main .copyable-area",
      "#main",
    ],
    messageNode: [
      '[data-testid="msg-container"]',
      "div.message-in, div.message-out",
      'div[data-id*="false_"], div[data-id*="true_"]',
      '#main div[role="row"] div[data-id]',
    ],
    chatHeader: ['header [data-id]', "#main header"],
    composer: [
      '[data-testid="conversation-compose-box-input"]',
      'footer div[contenteditable="true"][data-tab="10"]',
      'footer div[contenteditable="true"]',
    ],
    sendBtn: [
      '[data-testid="send"]',
      '[data-testid="compose-btn-send"]',
      'button[data-tab="11"]',
      'button[aria-label="Enviar"]',
      'span[data-icon="send"]',
    ],
    textInNode: [
      "span.selectable-text",
      "span._ao3e",
      "div.copyable-text span",
    ],
    copyableMeta: ["[data-pre-plain-text]"],
  };

  /** Primer elemento que matchee cualquiera de los selectores. */
  function findOne(group, root = document) {
    const sels = REGISTRY[group];
    if (!sels) return null;
    for (const s of sels) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  /** Todos los elementos del primer selector que devuelva algo. */
  function findAll(group, root = document) {
    const sels = REGISTRY[group];
    if (!sels) return [];
    for (const s of sels) {
      const nodes = root.querySelectorAll(s);
      if (nodes.length) return nodes;
    }
    return [];
  }

  function unionSelector(group) {
    return REGISTRY[group].join(", ");
  }

  window.__engineSelectors = { findOne, findAll, unionSelector, REGISTRY };
})();
