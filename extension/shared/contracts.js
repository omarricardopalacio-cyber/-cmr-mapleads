// shared/contracts.js — Contratos de eventos y comandos del Bridge Engine.
// Cargado tanto por background como por content scripts.
(function (root) {
  const EVENTS = Object.freeze({
    MESSAGE_RECEIVED: "message-in",
    MESSAGE_SENT: "message-out",
    MESSAGE_FAILED: "message-failed",
    CHAT_OPENED: "chat-opened",
    CHAT_CHANGED: "chat-changed",
    SESSION_READY: "session-ready",
    SESSION_LOST: "session-lost",
    QUEUE_RETRY: "queue-retry",
    ACK: "ack",
    HEARTBEAT: "heartbeat",
    STATUS: "status",
  });

  const COMMANDS = Object.freeze({
    SEND_MESSAGE: "send_message",
  });

  /** @returns {string} ISO timestamp */
  const now = () => new Date().toISOString();

  /** Construye un evento normalizado para enviar al backend. */
  function makeEvent(type, data = {}) {
    return { type, sentAt: now(), ...data };
  }

  const api = { EVENTS, COMMANDS, makeEvent, now };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.__engineContracts = api;
})(typeof self !== "undefined" ? self : globalThis);
