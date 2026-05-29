// content/core/message-parser.js — Nodo DOM → JSON normalizado.
(function () {
  const sel = () => window.__engineSelectors;

  function getChatId() {
    const header = sel().findOne("chatHeader");
    return header?.getAttribute("data-id") || location.hash || "unknown";
  }

  function parseMessageNode(node) {
    const dataId = node.getAttribute("data-id") || node.id || "";
    const dir = window.__engineDetector.direction(node);

    const textEl = sel().findOne("textInNode", node);
    const text = textEl ? textEl.innerText.trim() : "";

    const copyable = sel().findOne("copyableMeta", node);
    const meta = copyable?.getAttribute("data-pre-plain-text") || "";
    const tsMatch = meta.match(/\[(.*?)\]/);

    const hasImage = !!node.querySelector('img[src^="blob:"]');
    const hasAudio = !!node.querySelector("audio");
    const hasVideo = !!node.querySelector("video");

    return {
      id: dataId,
      chatId: getChatId(),
      direction: dir,
      text,
      raw_meta: meta,
      timestamp_label: tsMatch ? tsMatch[1] : null,
      media: { image: hasImage, audio: hasAudio, video: hasVideo },
    };
  }

  window.__engineParser = { parseMessageNode };
})();
