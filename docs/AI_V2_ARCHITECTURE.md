# AI V2 Architecture

## Current Architecture (V1)

```
Entry points (ingest.ts / retry-processor.ts)
       |
       v
  runAiAgent()                        src/lib/ai.server.ts:2267
       |
       ├── getCatalogConfig()
       ├── load thread, contact, config data
       ├── build system prompt
       ├── callAiProvider() — LLM call with tool support
       ├── tool execution loop (up to 6 rounds)
       ├── catalog search, order processing, memory save
       │
       └── returns { reply: string, actions: string[] }
```

- Single monolithic orchestrator (3936 lines)
- All concerns (prompting, tools, memory, catalog, sales) in one function
- No feature switch — always runs `runAiAgent`

## New Architecture (V2)

```
Entry points (ingest.ts / retry-processor.ts)
       │
       v
  runAiRouter()                       src/lib/ai-v2/router.ts
       │
       ├── engine === "v1" → runAiAgent()          [existing, unchanged]
       │
       └── engine === "v2" → runAiAgentV2()
                                │
                                ├── loadCustomerMemory()     customer-memory.ts
                                ├── loadConversationMemory() conversation-memory.ts
                                ├── loadKnowledgeMemory()    knowledge-memory.ts
                                ├── catalogAgent()           catalog-agent.ts
                                ├── salesAgent()             sales-agent.ts
                                │
                                └── buildResponse()          response-engine.ts
                                       │
                                       └── returns { reply: string, actions: string[] }
```

### Module Responsibilities (V2 — placeholders)

| Module | File | Responsibility |
|---|---|---|
| Router | `router.ts` | Feature switch, orchestration |
| Customer Memory | `customer-memory.ts` | Load/save per-contact memory |
| Conversation Memory | `conversation-memory.ts` | Load/save thread context |
| Knowledge Memory | `knowledge-memory.ts` | Load/save knowledge base |
| Catalog Agent | `catalog-agent.ts` | Product search & recommendation |
| Sales Agent | `sales-agent.ts` | Order processing & sales |
| Response Engine | `response-engine.ts` | Final reply builder |
| Prompt Builder | `prompt-builder.ts` | Prompt assembly |
| Types | `types.ts` | Shared type definitions |

## Routing Flow

```
                      ┌─────────────────────┐
                      │   HTTP Request      │
                      └─────────┬───────────┘
                                │
                     ┌──────────v──────────┐
                     │   getAiEngine()     │  ← reads AI_ENGINE env var
                     │  (config.server.ts) │     default: "v1"
                     └──────────┬──────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
               engine="v1"            engine="v2"
                    │                       │
                    v                       v
          runAiAgent()              runAiAgentV2()
          (ai.server.ts)            (ai-v2/router.ts)
                    │                       │
                    v                       v
           { reply, actions }      { reply, actions }
```

### Rollback Flow

Rollback to V1 is a **two-step process**:

1. **Set `AI_ENGINE=v1`** (or unset it — `v1` is the default)
2. **Restart/redeploy the server**

No code changes, no database migrations, no deploys.

> **Recovery time:** < 5 seconds (env var change + process restart)

## Feature Switch Behavior

| `AI_ENGINE` value | Result |
|---|---|
| unset / empty | runs V1 (`runAiAgent`) |
| `"v1"` | runs V1 (`runAiAgent`) |
| `"v2"` | runs V2 (`runAiAgentV2`) |
| any other value | falls back to V1 |

The switch is implemented in `src/lib/config.server.ts`:

```typescript
export function getAiEngine(): AiEngine {
  const engine = process.env.AI_ENGINE
  if (engine === "v2") return "v2"
  return "v1"
}
```

- Read at **request time** (not module load) for Cloudflare Workers compatibility.
- No caching — every request evaluates the env var fresh.

## Files Created

| File | Lines | Purpose |
|---|---|---|
| `src/lib/ai-v2/types.ts` | ~35 | Shared types (`AiRunParams`, `AiResponse`, etc.) |
| `src/lib/ai-v2/router.ts` | ~30 | Feature-switch router + V2 orchestrator |
| `src/lib/ai-v2/customer-memory.ts` | ~10 | Customer memory placeholder |
| `src/lib/ai-v2/conversation-memory.ts` | ~10 | Conversation memory placeholder |
| `src/lib/ai-v2/knowledge-memory.ts` | ~10 | Knowledge memory placeholder |
| `src/lib/ai-v2/catalog-agent.ts` | ~10 | Catalog agent placeholder |
| `src/lib/ai-v2/sales-agent.ts` | ~10 | Sales agent placeholder |
| `src/lib/ai-v2/response-engine.ts` | ~10 | Response builder placeholder |
| `src/lib/ai-v2/prompt-builder.ts` | ~8 | Prompt builder placeholder |
| `docs/AI_V2_ARCHITECTURE.md` | ~120 | This document |

## Files Modified

| File | Change |
|---|---|
| `src/lib/config.server.ts` | Added `getAiEngine()` feature switch |
| `src/routes/api/public/engine/ingest.ts` | Routes through `runAiRouter` instead of direct `runAiAgent` call |
| `src/routes/api/public/engine/retry-processor.ts` | Routes through `runAiRouter` instead of direct `runAiAgent` call |

## Future Memory Layers (planned, not implemented)

Phase 2 will add persistent storage:

```
Customer Memory ───→ contacts.crm_data.memory (JSONB, exists today)
                          │
                          v
                    contacts_memory (dedicated table, TBD)

Conversation Memory ───→ thread_messages (exists today)
                              │
                              v
                        conversation_summaries (table TBD)

Knowledge Memory ───→ org_knowledge_base (pgvector, table TBD)
```

- **pgvector** will power semantic search over knowledge sources.
- No schema changes in this phase.
- Memory functions currently return placeholders.

## Future Knowledge Base Layer (planned, not implemented)

```
org_knowledge_base
  ├── id          uuid PK
  ├── org_id      uuid FK
  ├── content     text
  ├── embedding   vector(1536)
  ├── source      text
  └── created_at  timestamptz
```

Will be used by `knowledge-memory.ts` for RAG (Retrieval-Augmented Generation).

## Verification

- **V1 behavior unchanged**: When `AI_ENGINE=v1` or unset, `runAiRouter` delegates to the existing `runAiAgent` with identical parameters and return type.
- **Additive only**: No existing code was removed or refactored.
- **Isolated V2**: All new code lives under `src/lib/ai-v2/`.
- **Compiles**: TypeScript strict mode passes.
