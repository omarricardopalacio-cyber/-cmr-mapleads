const CONFIG = {
  openDelayMs: 2600,
  betweenChatsMs: 900,
  historyScrollMaxMs: 9000,
  historyScrollStepMs: 320,
  listScrollStepPx: 900
};

let stopRequested = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(...args) {
  console.log("[WA-Extractor]", ...args);
}

function getChatListContainer() {
  return (
    document.querySelector("#pane-side") ||
    document.querySelector('[data-testid="chat-list"]') ||
    document.querySelector("#side")
  );
}

function getConversationPanel() {
  return document.querySelector('[data-testid="conversation-panel-messages"]');
}

function getSidebarChats() {
  const pane = getChatListContainer() || document;
  const selectorGroups = [
    '[data-testid^="list-item-"]',
    '#pane-side [role="row"]',
    '#pane-side [role="listitem"]',
    '[role="listitem"]'
  ];

  const raw = [];
  for (const selector of selectorGroups) {
    const found = Array.from(pane.querySelectorAll(selector));
    for (const el of found) raw.push(el);
  }

  const unique = [];
  const seen = new Set();
  for (const el of raw) {
    const key =
      el.getAttribute("data-testid") ||
      el.getAttribute("data-id") ||
      `${el.getAttribute("aria-rowindex") || ""}|${String(el.textContent || "").slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(el);
  }

  return unique.filter((item) => Boolean(getChatNameFromListItem(item)));
}

function getChatNameFromListItem(item) {
  const candidates = [
    '[data-testid="cell-frame-title"]',
    '[data-testid="conversation-title"]',
    '[data-testid="list-item-title"]',
    'span[title][dir="auto"]',
    'span[title]',
    "span[dir='auto']"
  ];
  for (const selector of candidates) {
    const el = item.querySelector(selector);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return "";
}

function getChatKey(item) {
  const id = item.getAttribute("data-id") || "";
  const name = getChatNameFromListItem(item);
  const preview = String(item.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${id}|${name}|${preview}`;
}

function shouldIncludeChat(item, source) {
  if (source !== "unread") return true;
  return Boolean(
    item.querySelector('[aria-label*="no leído"], [aria-label*="unread"], [data-testid*="unread"]')
  );
}

function scrollChatListToLoadMore() {
  const pane = getChatListContainer();
  if (!pane) return false;
  const before = pane.scrollTop;
  pane.scrollTop = before + CONFIG.listScrollStepPx;
  return pane.scrollTop !== before;
}

function getOpenedChatName() {
  const candidates = [
    '#main header [data-testid="conversation-info-header-chat-title"]',
    "#main header span[title]",
    '#main header span[dir="auto"]'
  ];
  for (const selector of candidates) {
    const el = document.querySelector(selector);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return "";
}

function normalizeDigits(text) {
  return String(text || "").replace(/\D/g, "");
}

function isSameOpenedChat(targetName) {
  const opened = getOpenedChatName();
  if (!opened || !targetName) return false;
  if (opened === targetName) return true;

  const d1 = normalizeDigits(opened);
  const d2 = normalizeDigits(targetName);
  if (d1 && d2) {
    return d1.includes(d2) || d2.includes(d1) || d1.slice(-8) === d2.slice(-8);
  }
  return false;
}

function getConversationSignature() {
  const header = getOpenedChatName();
  const firstMsg = document.querySelector('[data-testid="conversation-panel-messages"] [data-testid="msg-container"]');
  const firstTxt = (firstMsg?.innerText || "").slice(0, 40);
  return `${header}|${firstTxt}`;
}

function dispatchRealClick(element) {
  if (!element) return;
  element.scrollIntoView({ block: "center", inline: "nearest" });
  const rect = element.getBoundingClientRect();
  const x = rect.left + Math.max(6, Math.min(rect.width - 6, rect.width / 3));
  const y = rect.top + Math.max(6, Math.min(rect.height - 6, rect.height / 2));

  const mouse = (type) =>
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0
    });

  element.dispatchEvent(mouse("mousemove"));
  element.dispatchEvent(mouse("mousedown"));
  element.dispatchEvent(mouse("mouseup"));
  element.dispatchEvent(mouse("click"));
}

function getClickableChatNode(chatItem) {
  return (
    chatItem.querySelector('[data-testid="cell-frame-container"]') ||
    chatItem.querySelector('[data-testid="cell-frame-title"]')?.closest('[role="listitem"]') ||
    chatItem.querySelector('[role="gridcell"]') ||
    chatItem
  );
}

function looksLikeConversationOpen() {
  const panel = getConversationPanel();
  const header = getOpenedChatName();
  const composer =
    document.querySelector('#main footer [contenteditable="true"]') ||
    document.querySelector('#main [contenteditable="true"][data-tab]');
  return Boolean(panel) && Boolean(header || composer);
}

async function clickChatAndWaitOpen(chatItem, expectedName, delayMs) {
  const beforeSig = getConversationSignature();
  const clickable = getClickableChatNode(chatItem);
  dispatchRealClick(clickable);

  const waitMs = Math.max(2200, delayMs);
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    const sameName = isSameOpenedChat(expectedName);
    const changedSig = getConversationSignature() !== beforeSig;
    if (sameName || changedSig || looksLikeConversationOpen()) return true;
    await sleep(120);
  }

  // Reintento simple por seguridad con click nativo.
  clickable.click();
  await sleep(450);
  return isSameOpenedChat(expectedName) || getConversationSignature() !== beforeSig || looksLikeConversationOpen();
}

async function scrollConversationUpToLoadHistory(maxDurationMs) {
  const panel = getConversationPanel();
  if (!panel) return false;

  const endAt = Date.now() + Math.max(5000, maxDurationMs);
  let stableRounds = 0;
  let lastTop = panel.scrollTop;

  while (Date.now() < endAt && !stopRequested) {
    panel.scrollTop = 0;
    await sleep(CONFIG.historyScrollStepMs);

    const nowTop = panel.scrollTop;
    if (nowTop === lastTop) {
      stableRounds += 1;
      if (stableRounds >= 4) break;
    } else {
      stableRounds = 0;
    }
    lastTop = nowTop;
  }
  return true;
}

function detectSentOrReceived(msgContainer, panelRect) {
  const rect = msgContainer.getBoundingClientRect();
  const panelCenter = panelRect.left + panelRect.width / 2;
  const msgCenter = rect.left + rect.width / 2;
  return msgCenter >= panelCenter ? "sent" : "received";
}

function parseTimestampFromMeta(metaText) {
  const meta = String(metaText || "");
  const timeMatch = meta.match(/\b\d{1,2}:\d{2}\b/);
  const dateMatch = meta.match(/\d{1,2}\/\d{1,2}\/\d{2,4}|hoy|ayer|lunes|martes|miercoles|jueves|viernes|sabado|domingo/i);
  if (dateMatch && timeMatch) return `${dateMatch[0]} ${timeMatch[0]}`;
  if (timeMatch) return timeMatch[0];
  if (dateMatch) return dateMatch[0];
  return "";
}

function extractMessagesFromOpenedChat() {
  const panel = getConversationPanel();
  if (!panel) return [];

  const panelRect = panel.getBoundingClientRect();
  const containers = Array.from(panel.querySelectorAll('[data-testid="msg-container"]'));
  const out = [];

  for (const msg of containers) {
    const copyable = msg.querySelector("div.copyable-text[data-pre-plain-text]");
    const meta = copyable?.getAttribute("data-pre-plain-text") || "";

    let text = "";
    if (copyable) {
      text = String(copyable.innerText || "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .join(" ");
    }

    if (!text) {
      text = String(msg.innerText || "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .join(" ");
    }

    if (!text) continue;

    out.push({
      type: detectSentOrReceived(msg, panelRect),
      text,
      timestamp: parseTimestampFromMeta(meta)
    });
  }

  return out;
}

function dedupeMessages(messages) {
  const seen = new Set();
  const out = [];
  for (const m of messages) {
    const key = `${m.type}|${m.timestamp}|${m.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function buildChatResult(chatName, messages) {
  return {
    chat_name: chatName,
    messages
  };
}

async function extractSingleChat(chatItem, delayMs) {
  const chatName = getChatNameFromListItem(chatItem);
  if (!chatName) return null;

  const opened = await clickChatAndWaitOpen(chatItem, chatName, delayMs);
  if (!opened) {
    log("No se pudo abrir chat:", chatName);
    return null;
  }

  await sleep(Math.max(2000, delayMs));
  await scrollConversationUpToLoadHistory(CONFIG.historyScrollMaxMs);
  await sleep(250);

  const messages = dedupeMessages(extractMessagesFromOpenedChat());
  log("Chat extraido:", chatName, "mensajes:", messages.length);
  return buildChatResult(chatName, messages);
}

async function runExtraction({ maxChats, delayMs, source }) {
  const results = [];
  const visited = new Set();
  let passesWithoutProgress = 0;

  while (results.length < maxChats && passesWithoutProgress < 8 && !stopRequested) {
    const visibleChats = getSidebarChats().filter((item) => shouldIncludeChat(item, source));

    chrome.runtime.sendMessage({
      type: "EXTRACTION_DIAGNOSTIC",
      detectedChats: visibleChats.length,
      processed: results.length
    });

    if (!visibleChats.length && !results.length) {
      throw new Error("No se detectaron chats en la bandeja.");
    }

    let progressInPass = false;

    for (const chatItem of visibleChats) {
      if (stopRequested || results.length >= maxChats) break;

      const key = getChatKey(chatItem);
      if (visited.has(key)) continue;
      visited.add(key);

      try {
        const chatData = await extractSingleChat(chatItem, delayMs);
        if (!chatData) continue;

        results.push(chatData);
        progressInPass = true;

        chrome.runtime.sendMessage({
          type: "EXTRACTION_PROGRESS",
          current: results.length,
          total: maxChats,
          chatName: chatData.chat_name,
          messageCount: chatData.messages.length
        });
      } catch (err) {
        log("Error extrayendo chat:", err);
      }

      await sleep(Math.max(350, CONFIG.betweenChatsMs));
    }

    if (stopRequested || results.length >= maxChats) break;

    if (!progressInPass) {
      passesWithoutProgress += 1;
    } else {
      passesWithoutProgress = 0;
    }

    const moved = scrollChatListToLoadMore();
    if (!moved) break;
    await sleep(500);
  }

  return {
    exportedAt: new Date().toISOString(),
    totalChats: results.length,
    chats: results
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "STOP_EXTRACTION") {
    stopRequested = true;
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type !== "START_EXTRACTION") return;

  (async () => {
    try {
      stopRequested = false;
      const payload = await runExtraction({
        maxChats: Math.max(1, Number(message.maxChats || 50)),
        delayMs: Math.max(800, Number(message.delayMs || 1200)),
        source: message.source || "inbox"
      });

      if (!stopRequested) {
        chrome.runtime.sendMessage({
          type: "EXTRACTION_DONE",
          payload
        });
      }
    } catch (error) {
      chrome.runtime.sendMessage({
        type: "EXTRACTION_ERROR",
        error: error?.message || String(error)
      });
    }
  })();

  sendResponse({ ok: true });
  return true;
});
