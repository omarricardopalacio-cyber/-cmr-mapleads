// content/core/event-bus.js — Bus de eventos in-page + puente al background.
(function () {
  const listeners = new Map();

  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  }

  function emit(type, payload) {
    const set = listeners.get(type);
    if (set) for (const fn of set) try { fn(payload); } catch (e) { console.warn("[bus]", e); }
  }

  function sendToBackend(payload) {
    try {
      chrome.runtime.sendMessage({ __engine: true, payload });
    } catch (e) {
      // SW dormido — se reintenta en la próxima emisión
    }
  }

  window.__engineBus = { on, emit, sendToBackend };
})();
