import type { AgentResult } from "./types"

export async function catalogAgent(): Promise<AgentResult> {
  return {
    success: true,
    message: "V2 catalog agent placeholder — no-op",
  }
}
