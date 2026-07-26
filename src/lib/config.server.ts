import process from "node:process";

// Server-only config. The .server.ts suffix prevents Vite from bundling
// this file into the client — values here never reach the browser.
//
// On Cloudflare Workers, env binds at REQUEST time. Module-scope reads
// (e.g. `const x = process.env.X`) resolve to undefined — always read
// process.env INSIDE a function or handler.
//
// When to use which env-access pattern:
//   - .server.ts module (this file): server-only helpers reused across
//     handlers. Wrap reads in a function so they run per-request.
//   - inline process.env inside a createServerFn handler: one-off reads
//     not reused elsewhere.
//   - import.meta.env.VITE_FOO: PUBLIC config readable from both client
//     and server (analytics IDs, public URLs). Define in .env with the
//     VITE_ prefix. Never put secrets here — they ship to the browser.

export function getServerConfig() {
  return {
    nodeEnv: process.env.NODE_ENV,
    // Prompt SYSTEM: "compact" (default) | "legacy" para rollback.
    // Equivale a AI_PROMPT_MODE=legacy  o  AI_COMPACT_PROMPT=false
    aiPromptMode: (() => {
      const mode = String(process.env.AI_PROMPT_MODE || "")
        .toLowerCase()
        .trim();
      if (mode === "legacy" || mode === "full" || mode === "old") return "legacy" as const;
      if (mode === "compact" || mode === "new") return "compact" as const;
      const compact = String(process.env.AI_COMPACT_PROMPT ?? "true")
        .toLowerCase()
        .trim();
      if (compact === "0" || compact === "false" || compact === "no" || compact === "off") {
        return "legacy" as const;
      }
      return "compact" as const;
    })(),
  };
}
