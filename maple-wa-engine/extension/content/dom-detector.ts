// ============================================================
// MAPLE WA ENGINE — DOM Message Detector (MutationObserver)
// Fallback robusto cuando WPP no carga o falla
// Escanea TODO el documento y usa múltiples estrategias
// ============================================================

import { sendToBackground } from "../bridge/postmessage";
import { isBase64Thumbnail } from "../shared/message-text";

const SEEN = new Map<string, number>();
const TTL_MS = 120_000;
let observer: MutationObserver | null = null;
let active = false;
let lastScan = Date.now();

// Selectores actualizados para WhatsApp Web (2025-2026)
// Incluye soporte para LIDs puros después de borrar chats
const MSG_SELECTORS = [
  '[data-testid="msg-container"]',
  'div.message-out',
  'div.message-in',
  'div[data-id*="false_"]',
  'div[data-id*="true_"]',
  '[role="row"] div[data-id]',
  // Selectores para LIDs puros (ej: 3EB0A8FB8336EA9E8A39B0)
  'div[data-id]',
  '[data-id]',
];

const PANEL_SELECTORS = [
  '[data-testid="conversation-panel-messages"]',
  '[data-testid="conversation-panel"]',
  '#main .copyable-area',
  '#main',
  '[data-testid="chat-messages-list"]',
  'div[role="application"] div[role="region"]',
];

function gc() {
  const now = Date.now();
  for (const [k, t] of SEEN) {
    if (now - t > TTL_MS) SEEN.delete(k);
  }
}

function direction(node: HTMLElement): "in" | "out" {
  const dataId = node.getAttribute?.("data-id") || "";
  if (dataId.startsWith("true_")) return "out";
  if (dataId.startsWith("false_")) return "in";

  // Clases de WA Web
  if (node.classList?.contains("message-out")) return "out";
  if (node.classList?.contains("message-in")) return "in";

  // Descendientes
  if (node.querySelector?.(".message-out")) return "out";
  if (node.querySelector?.(".message-in")) return "in";

  // Iconos de estado (solo salientes)
  const hasChecks = node.querySelector?.('[data-icon*="check"]');
  if (hasChecks) return "out";

  // Atributos de testid
  if (node.getAttribute?.("data-testid")?.includes("own")) return "out";
  if (node.getAttribute?.("data-testid")?.includes("foreign")) return "in";

  // Estilo (flex-end = saliente en WA Web)
  try {
    const parent = node.parentElement;
    const style = parent ? getComputedStyle(parent) : null;
    if (style && (style.alignSelf === "flex-end" || style.justifyContent === "flex-end")) return "out";
  } catch {}

  return "in";
}

function parseListItemChatId(dataTestId: string): string | null {
  const chatIdMatch = dataTestId.replace(/^list-item-/, "").trim();
  if (chatIdMatch.endsWith("@c.us") || chatIdMatch.endsWith("@g.us")) {
    return chatIdMatch;
  }
  return null;
}

function getChatId(): string {
  try {
    // === MÉTODO 1: Scraping por Sidebar Row Seleccionado (Altamente Robusto) ===
    const activeSidebarRow = document.querySelector(
      'div[role="row"] div[data-testid^="list-item-"][class*="selected"], ' +
        'div[role="listitem"] div[data-testid^="list-item-"][class*="selected"], ' +
        'div[role="row"] div[data-testid^="list-item-"][class*="_ak8l"], ' +
        'div[data-testid^="list-item-"][class*="selected"]'
    );

    if (activeSidebarRow) {
      const dataTestId = activeSidebarRow.getAttribute("data-testid");
      if (dataTestId) {
        const fromListItem = parseListItemChatId(dataTestId);
        if (fromListItem) return fromListItem;
      }
    }

    // Fila con aria-selected (patrón alternativo del panel izquierdo)
    const ariaSelected = document.querySelector(
      '[aria-selected="true"][data-testid^="list-item-"], ' +
        '[aria-selected="true"] [data-testid^="list-item-"]'
    );
    if (ariaSelected) {
      const testId =
        ariaSelected.getAttribute("data-testid") ||
        ariaSelected.querySelector('[data-testid^="list-item-"]')?.getAttribute("data-testid");
      if (testId) {
        const fromAria = parseListItemChatId(testId);
        if (fromAria) return fromAria;
      }
    }

    // === MÉTODO 2: Parsing de la URL de Avatar en el Header Activo ===
    const headerAvatar = document.querySelector(
      '#main header img[src*="u="], header img[src*="u="]'
    );
    if (headerAvatar) {
      const src = headerAvatar.getAttribute("src") || "";
      const phoneMatch = src.match(/[?&]u=(\d+)/);
      if (phoneMatch?.[1]) {
        return `${phoneMatch[1]}@c.us`;
      }
    }

    // === MÉTODO 3: Regex Estricto sobre location.hash (URL Fallback) ===
    const hash = location.hash || "";
    const hashMatch = hash.match(/(?:#|\/|main\/)([^/?#]+@(?:c\.us|g\.us))/);
    if (hashMatch?.[1]) {
      return decodeURIComponent(hashMatch[1]);
    }

    // === MÉTODO 4: Selector de Cabecera de Main Conversación como Último Recurso ===
    const mainHeader = document.querySelector("#main header");
    if (mainHeader) {
      const attributes = mainHeader.attributes;
      for (let i = 0; i < attributes.length; i++) {
        const attrVal = attributes[i]?.value;
        if (attrVal && (attrVal.endsWith("@c.us") || attrVal.endsWith("@g.us"))) {
          return attrVal;
        }
      }

      // data-id legacy en header o descendientes (versiones antiguas de WA Web)
      const legacyHeader = document.querySelector(
        '#main header [data-id], header [data-id]'
      );
      const legacyId = legacyHeader?.getAttribute?.("data-id");
      if (legacyId && (legacyId.includes("@c.us") || legacyId.includes("@g.us"))) {
        return legacyId;
      }
    }

    return "unknown";
  } catch (error) {
    console.error("[MAPLE DOM DETECTOR] Error crítico obteniendo chatId activo:", error);
    return "unknown";
  }
}

function extractText(node: HTMLElement): string {
  // Múltiples estrategias para extraer texto
  const selectors = [
    'span.selectable-text',
    'span._ao3e',
    'div.copyable-text span',
    '[data-testid="msg-text"]',
    '.selectable-text',
    'span[dir="ltr"]',
    'span[dir="rtl"]',
  ];
  for (const s of selectors) {
    const el = node.querySelector(s) as HTMLElement | null;
    if (el && el.innerText?.trim()) return el.innerText.trim();
  }
  // Fallback: texto directo del nodo
  return node.innerText?.trim() || "";
}

function extractTimestamp(node: HTMLElement): string | null {
  const copyable = node.querySelector('[data-pre-plain-text]') as HTMLElement | null;
  const meta = copyable?.getAttribute?.("data-pre-plain-text") || "";
  const m = meta.match(/\[(.*?)\]/);
  return m ? m[1] : null;
}

function extractChatIdFromDataId(dataId: string): string | null {
  // data-id format: true_573003918780@c.us_3EB0... or false_573...@g.us_3EB0...
  const match = dataId.match(/^(true|false)_([^@]+@(c\.us|g\.us))_/);
  if (match) {
    return match[2]; // Returns: 573003918780@c.us or 573...@g.us
  }
  return null;
}

function parseMessageNode(node: HTMLElement): any {
  const dataId = node.getAttribute?.("data-id") || "";
  const dir = direction(node);
  let text = extractText(node);
  if (isBase64Thumbnail(text)) {
    text = "";
  }
  const tsLabel = extractTimestamp(node);

  const hasImage = !!node.querySelector('img[src^="blob:"]') ||
                   !!node.querySelector('img[src^="data:"]');
  const hasAudio = !!node.querySelector("audio") ||
                   !!node.querySelector('[data-testid*="audio"]');
  const hasVideo = !!node.querySelector("video") ||
                   !!node.querySelector('[data-testid*="video"]');
  const hasDocument = !!node.querySelector('[data-icon="document"]') ||
                      !!node.querySelector('[data-testid*="document"]');

  // Try to get chatId from sidebar first, fallback to data-id extraction
  let chatId = getChatId();
  if (chatId === "unknown" && dataId) {
    const fromDataId = extractChatIdFromDataId(dataId);
    if (fromDataId) {
      chatId = fromDataId;
      console.log("[DOMDetector] chatId extraído de data-id:", chatId);
    }
  }

  return {
    id: dataId,
    chatId,
    direction: dir,
    text,
    timestamp_label: tsLabel,
    media: { image: hasImage, audio: hasAudio, video: hasVideo, document: hasDocument },
  };
}

async function extractImageFromDom(node: HTMLElement): Promise<string | null> {
  try {
    const img = node.querySelector("img[src]");
    if (!img) return null;

    const src = img.getAttribute("src");
    if (!src) return null;

    // Si es un blob URL, convertir a base64
    if (src.startsWith("blob:")) {
      const resp = await fetch(src);
      const blob = await resp.blob();
      return new Promise<string | null>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    }

    // Si es data URL, retornar directamente
    if (src.startsWith("data:")) return src;

    return null;
  } catch (e) {
    console.warn("[DOMDetector] Error extrayendo imagen del DOM:", e);
    return null;
  }
}

async function emitFromNode(node: HTMLElement) {
  const id = node.getAttribute?.("data-id");
  if (!id || SEEN.has(id)) return;

  try {
    const parsed = parseMessageNode(node);
    if (!parsed || (!parsed.text && !parsed.media.image && !parsed.media.audio && !parsed.media.video && !parsed.media.document)) {
      return;
    }

    // Extract phone number from full data-id format if available (ej: false_21917838930175@lid_3EB0...)
    if (parsed.chatId === "unknown" && id) {
      const match = id.match(/_(\d+)@lid_/);
      if (match && match[1]) {
        parsed.chatId = `${match[1]}@c.us`;
        console.log("[DOMDetector] chatId extraído de data-id:", parsed.chatId);
      }
    }

    const hasMedia = parsed.media.image || parsed.media.video || parsed.media.audio || parsed.media.document;

    let mediaPayload: any = undefined;
    if (hasMedia && (parsed.media.image || parsed.media.video || parsed.media.audio)) {
      try {
        const parser = (window as any).__engineParser;
        if (parser && typeof parser.parseMessageNodeAsync === "function") {
          const asyncParsed = await parser.parseMessageNodeAsync(node);
          if (asyncParsed?.mediaPayload) {
            mediaPayload = asyncParsed.mediaPayload;
            console.log("[DOMDetector] Media extraído con parser:", {
              id,
              hasBody: !!mediaPayload.body,
              mimeType: mediaPayload.mimeType || mediaPayload.mimetype,
            });
          }
        }
      } catch (parserErr) {
        console.warn("[DOMDetector] Error extrayendo media con parser:", parserErr);
      }

      const mediaStillPending =
        !mediaPayload ||
        (!mediaPayload.body && !mediaPayload.data && !mediaPayload.base64 && !mediaPayload.url);

      if (mediaStillPending) {
        console.log("[DOMDetector] Media aún no listo, se reintentará en el próximo escaneo:", id);
        return;
      }
    }

    SEEN.set(id, Date.now());
    gc();

    const evtType = parsed.direction === "out" ? "MESSAGE_SENT" : "NEW_MESSAGE";
    const payload: any = {
      type: parsed.direction === "out" ? "message-out" : "message-in",
      chatId: parsed.chatId,
      waMessageId: parsed.id,
      direction: parsed.direction,
      text: parsed.text,
      sentAt: new Date().toISOString(),
    };

    if (mediaPayload) {
      payload.media = mediaPayload;
    }

    console.log("[DOMDetector] Mensaje detectado:", evtType, hasMedia ? "(con media)" : "(texto)", parsed.text?.slice(0, 40));

    sendToBackground("WA_EVENT", {
      event: evtType,
      payload: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: evtType,
        payload,
        timestamp: Date.now(),
      },
    }).catch(() => {});

    chrome.storage.local.set({
      lastDomEvent: {
        type: evtType,
        text: parsed.text?.slice(0, 60),
        direction: parsed.direction,
        chatId: parsed.chatId,
        at: Date.now(),
      },
    }).catch(() => {});

  } catch (e) {
    console.warn("[DOMDetector] parse fail", e);
  }
}

function scanAll(): number {
  // ESTRATEGIA AGRESIVA: buscar TODOS los elementos con data-id que parezcan mensajes de WA
  const allWithId = document.querySelectorAll('[data-id*="true_"], [data-id*="false_"], [data-id]');
  const unique = new Map<string, HTMLElement>();
  for (const n of allWithId) {
    if (n instanceof HTMLElement) {
      const id = n.getAttribute?.("data-id") || "";
      // Los IDs de mensajes de WA son como: true_573003918780@c.us_3EB0... o false_573..._3EB0...
      // O después de borrar chats: solo el LID puro (ej: 3EB0A8FB8336EA9E8A39B0)
      if (id && (id.includes("true_") || id.includes("false_") || (/^[A-F0-9]{20,}$/.test(id)))) {
        unique.set(id, n);
      }
    }
  }

  // También probar los selectores clásicos como fallback
  for (const sel of MSG_SELECTORS) {
    try {
      const nodes = document.querySelectorAll(sel);
      nodes.forEach((n) => {
        if (n instanceof HTMLElement) {
          const id = n.getAttribute?.("data-id") || "";
          if (id) unique.set(id, n);
        }
      });
    } catch {}
  }

  const nodes = Array.from(unique.values());
  nodes.forEach((n) => emitFromNode(n));
  if (nodes.length > 0) {
    console.log(`[DOMDetector] scanAll: ${nodes.length} mensajes encontrados`);
  }
  return nodes.length;
}

function findMessagesPanel(): HTMLElement | null {
  for (const s of PANEL_SELECTORS) {
    const el = document.querySelector(s) as HTMLElement | null;
    if (el) return el;
  }
  return null;
}

function attach(): boolean {
  const panel = findMessagesPanel();

  if (!panel) {
    console.log("[DOMDetector] Panel no encontrado, reintentando...");
    return false;
  }

  observer?.disconnect();
  observer = new MutationObserver((muts) => {
    lastScan = Date.now();
    gc();
    let newMessages = false;
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        // Verificar si el nodo o sus hijos son mensajes
        // Incluye soporte para LIDs puros (sin _)
        const candidates = [];
        if (node.matches?.('[data-id]')) candidates.push(node);
        node.querySelectorAll?.('[data-id]').forEach((child) => {
          if (child instanceof HTMLElement) candidates.push(child);
        });
        for (const cand of candidates) {
          const id = cand.getAttribute?.("data-id");
          // Aceptar IDs con formato completo (false_123@c.us_3EB0...) o LIDs puros (3EB0...)
          if (id && (id.includes("_") || /^[A-F0-9]{20,}$/.test(id)) && !SEEN.has(id)) {
            emitFromNode(cand);
            newMessages = true;
          }
        }
      }
    }
    if (newMessages) console.log("[DOMDetector] Nuevos mensajes detectados via MutationObserver");
  });

  observer.observe(panel, { childList: true, subtree: true });
  active = true;
  console.log("[DOMDetector] Observer attached, panel:", panel);

  const count = scanAll();
  console.log(`[DOMDetector] ${count} mensajes escaneados al inicio`);
  return true;
}

export function startDomDetector(): void {
  if (active) return;
  console.log("[DOMDetector] Iniciando v2...");
  (window as any).__MAPLE_DOM_DETECTOR_ACTIVE = false;

  let attempts = 0;
  const boot = setInterval(() => {
    attempts++;
    // WhatsApp está listo cuando hay #app y elementos del chat
    const appReady = !!document.querySelector("#app, #main");
    const hasMessages = scanAll() > 0;

    if (appReady) {
      if (attach()) {
        (window as any).__MAPLE_DOM_DETECTOR_ACTIVE = true;
        console.log("[DOMDetector] Activado");
        clearInterval(boot);
        // Re-escanear cada 5s por nuevos mensajes y re-attach si cambia el chat
        setInterval(() => {
          if (!observer) attach();
          else scanAll();
        }, 5000);
      } else if (attempts > 30) {
        // Aún sin panel, pero intentar observer en body como último recurso
        console.warn("[DOMDetector] Sin panel después de 30s, usando fallback body");
        observer = new MutationObserver(() => {
          scanAll();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        active = true;
        (window as any).__MAPLE_DOM_DETECTOR_ACTIVE = true;
        clearInterval(boot);
      }
    }
  }, 1000);

  setTimeout(() => clearInterval(boot), 60000);
}

export function stopDomDetector(): void {
  observer?.disconnect();
  observer = null;
  active = false;
}
