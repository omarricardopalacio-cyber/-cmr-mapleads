// content/core/message-detector.js — Decide in/out con múltiples estrategias robustas.
(function () {
  function direction(node) {
    // 1) data-id: true_ = saliente, false_ = entrante
    const dataId = node.getAttribute?.("data-id") || node.id || "";
    if (dataId.startsWith("true_")) return "out";
    if (dataId.startsWith("false_")) return "in";

    // 2) clases CSS clásicas
    if (node.classList?.contains("message-out")) return "out";
    if (node.classList?.contains("message-in")) return "in";
    if (node.querySelector?.(".message-out")) return "out";
    if (node.querySelector?.(".message-in")) return "in";

    // 3) checkmarks de envío => mensaje propio
    if (node.querySelector?.('[data-icon="msg-dblcheck"], [data-icon="msg-check"], [data-icon="msg-dblcheck-ack"]')) {
      return "out";
    }

    // 4) testid específico
    if (node.querySelector?.('[data-testid="msg-container-own"]')) return "out";
    if (node.querySelector?.('[data-testid="msg-container-foreign"]')) return "in";

    // 5) alineación CSS (flex-end = saliente)
    try {
      const target = node.matches?.('[data-testid="msg-container"]') ? node.parentElement : node;
      const style = target ? getComputedStyle(target) : null;
      if (style && (style.alignSelf === "flex-end" || style.justifyContent === "flex-end")) return "out";
    } catch {}

    // por defecto, entrante
    return "in";
  }

  function isIncoming(node) {
    return direction(node) === "in";
  }

  window.__engineDetector = { direction, isIncoming };
})();
