import type { MemoryResult } from "./types"

export async function loadCustomerMemory(): Promise<MemoryResult> {
  return {
    success: true,
    message: "V2 customer memory placeholder — no-op",
  }
}
