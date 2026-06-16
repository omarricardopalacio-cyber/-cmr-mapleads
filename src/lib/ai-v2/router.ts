import { getAiEngine } from "@/lib/config.server"
import { runAiAgent } from "@/lib/ai.server"
import type { AiRunParams, AiResponse } from "./types"
import { loadCustomerMemory } from "./customer-memory"
import { loadConversationMemory } from "./conversation-memory"
import { loadKnowledgeMemory } from "./knowledge-memory"
import { catalogAgent } from "./catalog-agent"
import { salesAgent } from "./sales-agent"
import { buildResponse } from "./response-engine"

export async function runAiRouter(params: AiRunParams): Promise<AiResponse> {
  const engine = getAiEngine()

  if (engine === "v2") {
    return runAiAgentV2(params)
  }

  return runAiAgent(params as any)
}

export async function runAiAgentV2(_params: AiRunParams): Promise<AiResponse> {
  await loadCustomerMemory()
  await loadConversationMemory()
  await loadKnowledgeMemory()
  await catalogAgent()
  await salesAgent()
  return buildResponse()
}
