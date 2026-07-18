export type AiEngine = "v1" | "v2"

export type Msg = {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  tool_calls?: any[]
  tool_call_id?: string
  name?: string
}

export interface AiRunParams {
  orgId: string
  threadId: string
  contactId?: string
  sessionId?: string
  chatId?: string
  messages: Msg[]
  cfg: Record<string, unknown>
  contactName?: string | null
  contactPhone?: string | null
  autoRepliesWereSent?: boolean
}

export interface AiResponse {
  reply: string
  actions: string[]
}

export interface MemoryResult {
  success: boolean
  message: string
  data?: Record<string, unknown>
}

export interface AgentResult {
  success: boolean
  message: string
  data?: Record<string, unknown>
}
