// ============================================================
// MAPLE WA ENGINE — Contracts & Constants
// ============================================================

export const CONSTANTS = {
  // Timeouts
  WPP_WAIT_TIMEOUT: 30000,
  WPP_RETRY_INTERVAL: 100,
  SEND_TIMEOUT: 30000,
  SEND_RETRY_MAX: 3,
  SEND_RETRY_DELAY: 2000,
  RATE_LIMIT_PER_MINUTE: 30,

  // Polling
  POLLING_INTERVAL_MS: 3000,
  HEARTBEAT_INTERVAL_MS: 15000,
  HEARTBEAT_TIMEOUT_MS: 45000,

  // Batch
  BATCH_MAX_SIZE: 50,
  BATCH_FLUSH_INTERVAL_MS: 5000,
  /** Above this base64 length, upload to Storage before queuing (avoids DB timeout). */
  MEDIA_INLINE_MAX_LEN: 48_000,

  // Storage
  DB_NAME: "MapleWAEngineDB",
  DB_VERSION: 1,

  // Bridge
  BRIDGE_EVENT_CHANNEL: "WA_EVENT",
  BRIDGE_COMMAND_CHANNEL: "WA_COMMAND",
  BRIDGE_REQUEST_CHANNEL: "WA_REQUEST",
  BRIDGE_RESPONSE_CHANNEL: "WA_RESPONSE",
} as const;

export const API_ENDPOINTS = {
  GET_COMMANDS: "/api/public/engine/commands",
  POST_INGEST: "/api/public/engine/ingest",
  POST_UPLOAD_MEDIA: "/api/public/engine/upload-media",
  POST_HEARTBEAT: "/api/public/engine/heartbeat",
} as const;

export const HEADERS = {
  CONTENT_TYPE: "application/json",
  SESSION_TOKEN: "X-Session-Token",
} as const;

// Event bus topics
export const TOPICS = {
  NEW_MESSAGE: "NEW_MESSAGE",
  MESSAGE_SENT: "MESSAGE_SENT",
  MESSAGE_FAILED: "MESSAGE_FAILED",
  MESSAGE_ACK: "MESSAGE_ACK",
  ACTIVE_CHAT_CHANGED: "ACTIVE_CHAT_CHANGED",
  CONTACT_UPDATED: "CONTACT_UPDATED",
  PRESENCE_CHANGED: "PRESENCE_CHANGED",
  LABEL_UPDATED: "LABEL_UPDATED",
  SESSION_READY: "SESSION_READY",
  SESSION_LOST: "SESSION_LOST",
  HEARTBEAT: "HEARTBEAT",
  CONNECTION_STATE_CHANGED: "CONNECTION_STATE_CHANGED",
  CHAT_OPENED: "CHAT_OPENED",
  CHAT_CLOSED: "CHAT_CLOSED",
  THEME_CHANGED: "THEME_CHANGED",
} as const;
