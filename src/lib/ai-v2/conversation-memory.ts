import type { MemoryResult } from "./types"

export async function loadConversationMemory(): Promise<MemoryResult> {
  return {
    success: true,
    message: "V2 conversation memory placeholder — no-op",
  }
}
