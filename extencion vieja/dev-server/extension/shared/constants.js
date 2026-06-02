// shared/constants.js — Constantes runtime.
(function (root) {
  const CONST = Object.freeze({
    POLL_MS: 3000,
    FLUSH_MS: 1500,
    HEARTBEAT_MS: 15000,
    HEALTH_MS: 30000,
    MAX_BATCH: 25,
    DEDUP_TTL_MS: 120_000,
    SEND_COOLDOWN_MS: 600,
    SEND_JITTER_MS: 1200,
    BACKOFF_MS: [1000, 3000, 10_000, 30_000],
    ALARMS: {
      POLL: "engine.poll",
      FLUSH: "engine.flush",
      HEARTBEAT: "engine.heartbeat",
      HEALTH: "engine.health",
    },
  });
  root.__engineConst = CONST;
})(typeof self !== "undefined" ? self : globalThis);
