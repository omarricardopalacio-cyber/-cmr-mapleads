// content/core/message-detector.js — Decide in/out con múltiples estrategias.
(function () {
  function direction(node) {
    const dataId = node.getAttribute?.("data-id") || node.id || "";
    if (dataId.startsWith("true_")) return "out";
    if (dataId.startsWith("false_")) return "in";

    if (node.classList?.contains("message-out")) return "out";
    if (node.classList?.contains("message-in")) return "in";

    // Estructural: ¿tiene doble check (mensaje propio)?
    if (node.querySelector('[data-icon="msg-dblcheck"], [data-icon="msg-check"]')) return "out";

    return "in"; // por defecto, tratar como entrante
  }

  window.__engineDetector = { direction };
})();
