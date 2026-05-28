// parser.js — Convierte un nodo DOM de mensaje a JSON normalizado.

(function () {
  function getChatId() {
    // El chat activo aparece en el header; fallback: URL
    const header = document.querySelector('header [data-id], #main header');
    return header?.getAttribute("data-id") || location.hash || "unknown";
  }

  function parseMessageNode(node) {
    const dataId = node.getAttribute("data-id") || node.id || "";
    const direction = node.classList.contains("message-out") ? "out" : "in";

    // Texto
    const textEl = node.querySelector("span.selectable-text, span._ao3e, div.copyable-text span");
    const text = textEl ? textEl.innerText.trim() : "";

    // Timestamp (data-pre-plain-text="[10:23, 28/05/2026] Nombre: ")
    const copyable = node.querySelector("[data-pre-plain-text]");
    const meta = copyable?.getAttribute("data-pre-plain-text") || "";
    const tsMatch = meta.match(/\[(.*?)\]/);

    // Media básica
    const hasImage = !!node.querySelector('img[src^="blob:"]');
    const hasAudio = !!node.querySelector("audio");
    const hasVideo = !!node.querySelector("video");

    return {
      id: dataId,
      chatId: getChatId(),
      direction,
      text,
      raw_meta: meta,
      timestamp_label: tsMatch ? tsMatch[1] : null,
      media: { image: hasImage, audio: hasAudio, video: hasVideo },
    };
  }

  window.__engineParser = { parseMessageNode };
})();
