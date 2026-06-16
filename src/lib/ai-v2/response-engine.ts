import type { AiResponse } from "./types"

export async function buildResponse(): Promise<AiResponse> {
  return {
    reply: "V2 placeholder response",
    actions: [],
  }
}
