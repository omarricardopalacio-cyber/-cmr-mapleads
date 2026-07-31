/**
 * Aprendizaje de prompts por producto:
 * - Califica chats con ≥3 respuestas humanas (source=agent) ligados a un producto
 * - A 50 consultas → genera ai_observation (con backup)
 * - A 50 ventas → merge super-prompt (con backup)
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type MessageSource = "agent" | "ai" | "flow" | "unknown";

const MIN_HUMAN_REPLIES = 3;
const SAMPLE_TARGET = 50;
const MAX_TRANSCRIPT_TURNS = 40;
const MAX_PROMPT_CHARS = 3500;

type TranscriptTurn = {
  role: "in" | "out";
  source?: string | null;
  text: string;
  at?: string | null;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function normalizeMessageSource(raw: unknown): MessageSource | null {
  const s = String(raw || "").toLowerCase().trim();
  if (s === "agent" || s === "ai" || s === "flow" || s === "unknown") return s;
  return null;
}

/** Infiere source desde payload de engine_commands. */
export function sourceFromEnginePayload(payload: unknown): MessageSource {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const explicit = normalizeMessageSource(p.source);
  if (explicit && explicit !== "unknown") return explicit;
  if (p.flowRunId || p.flow_run_id) return "flow";
  if (p.dedupeKey || p.dedupe_key) return "ai";
  return "unknown";
}

/**
 * Resuelve origen de un outbound al hacer ingest (eco WA sin pending).
 */
export async function resolveOutboundMessageSource(params: {
  orgId: string;
  sessionId?: string | null;
  text?: string | null;
  commandId?: string | null;
}): Promise<MessageSource> {
  try {
    if (params.commandId) {
      const { data: cmd } = await (supabaseAdmin as any)
        .from("engine_commands")
        .select("payload")
        .eq("id", params.commandId)
        .eq("org_id", params.orgId)
        .maybeSingle();
      if (cmd) return sourceFromEnginePayload(cmd.payload);
    }

    const text = String(params.text || "").trim();
    if (!text) return "unknown";

    const since = new Date(Date.now() - 180_000).toISOString();
    let q = (supabaseAdmin as any)
      .from("engine_commands")
      .select("payload, created_at")
      .eq("org_id", params.orgId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(25);
    if (params.sessionId) q = q.eq("session_id", params.sessionId);

    const { data: cmds } = await q;
    const match = (cmds || []).find((c: any) => {
      const p = c?.payload || {};
      const t = String(p.text || p.caption || "").trim();
      return t && t === text;
    });
    if (match) return sourceFromEnginePayload(match.payload);
  } catch (err) {
    console.warn(
      "[product-learning] resolveOutboundMessageSource",
      err instanceof Error ? err.message : err,
    );
  }
  return "unknown";
}

async function resolveProductIdForThread(params: {
  orgId: string;
  threadId: string;
  contactId?: string | null;
}): Promise<string | null> {
  const { data: thread } = await (supabaseAdmin as any)
    .from("threads")
    .select("focused_product_id, contact_id")
    .eq("id", params.threadId)
    .eq("org_id", params.orgId)
    .maybeSingle();

  if (thread?.focused_product_id) return String(thread.focused_product_id);

  const contactId = params.contactId || thread?.contact_id;
  if (contactId) {
    const { data: run } = await (supabaseAdmin as any)
      .from("flow_runs")
      .select("flow_id, flows(product_id, is_product_entry, name)")
      .eq("org_id", params.orgId)
      .eq("contact_id", contactId)
      .order("updated_at", { ascending: false })
      .limit(8);

    for (const r of run || []) {
      const flow = Array.isArray(r.flows) ? r.flows[0] : r.flows;
      const pid = flow?.product_id ? String(flow.product_id) : null;
      if (pid) return pid;
    }
  }

  return null;
}

async function countAgentReplies(threadId: string): Promise<number> {
  const { count } = await (supabaseAdmin as any)
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("direction", "out")
    .eq("source", "agent");
  return count ?? 0;
}

async function threadHasSale(params: {
  orgId: string;
  threadId: string;
  contactId?: string | null;
}): Promise<boolean> {
  const { data: t } = await (supabaseAdmin as any)
    .from("threads")
    .select("purchase_intent")
    .eq("id", params.threadId)
    .maybeSingle();
  if (String(t?.purchase_intent || "") === "compro") return true;

  if (params.contactId) {
    const { data: order } = await (supabaseAdmin as any)
      .from("orders")
      .select("id")
      .eq("org_id", params.orgId)
      .eq("contact_id", params.contactId)
      .limit(1)
      .maybeSingle();
    if (order?.id) return true;

    const { data: tag } = await (supabaseAdmin as any)
      .from("tags")
      .select("id")
      .eq("org_id", params.orgId)
      .ilike("name", "Compró")
      .maybeSingle();
    if (tag?.id) {
      const { data: link } = await (supabaseAdmin as any)
        .from("contact_tags")
        .select("tag_id")
        .eq("contact_id", params.contactId)
        .eq("tag_id", tag.id)
        .maybeSingle();
      if (link) return true;
    }
  }
  return false;
}

async function buildTranscriptExcerpt(threadId: string): Promise<TranscriptTurn[]> {
  const { data: msgs } = await (supabaseAdmin as any)
    .from("messages")
    .select("direction, text, source, sent_at")
    .eq("thread_id", threadId)
    .not("text", "is", null)
    .order("sent_at", { ascending: true })
    .limit(120);

  const turns: TranscriptTurn[] = [];
  for (const m of msgs || []) {
    const text = String(m.text || "").trim();
    if (!text) continue;
    const dir = m.direction === "out" ? "out" : "in";
    // Priorizar agent en outbound; incluir inbound siempre; omitir ai/flow salvo contexto breve
    if (dir === "out") {
      const src = normalizeMessageSource(m.source) || "unknown";
      if (src !== "agent" && src !== "unknown") continue;
    }
    turns.push({
      role: dir,
      source: m.source || null,
      text: text.slice(0, 500),
      at: m.sent_at || null,
    });
  }

  // Quedarse con los últimos N turnos (más señal reciente)
  return turns.slice(-MAX_TRANSCRIPT_TURNS);
}

async function listFlowsActivated(params: {
  orgId: string;
  contactId?: string | null;
}): Promise<Array<{ flow_id: string; name: string; reason: string }>> {
  if (!params.contactId) return [];
  const { data: runs } = await (supabaseAdmin as any)
    .from("flow_runs")
    .select("flow_id, status, updated_at, flows(id, name, product_id, is_product_entry)")
    .eq("org_id", params.orgId)
    .eq("contact_id", params.contactId)
    .order("updated_at", { ascending: false })
    .limit(10);

  const out: Array<{ flow_id: string; name: string; reason: string }> = [];
  for (const r of runs || []) {
    const flow = Array.isArray(r.flows) ? r.flows[0] : r.flows;
    if (!flow?.id) continue;
    out.push({
      flow_id: String(flow.id),
      name: String(flow.name || "flujo"),
      reason: flow.is_product_entry
        ? "entrada_producto"
        : flow.product_id
          ? "ligado_producto"
          : "activado",
    });
  }
  return out;
}

async function bumpProductCounter(
  productId: string,
  phase: "inquiry" | "sale",
): Promise<number> {
  const col = phase === "inquiry" ? "learning_inquiry_count" : "learning_sale_count";
  const { data: prod } = await (supabaseAdmin as any)
    .from("products")
    .select(col)
    .eq("id", productId)
    .maybeSingle();
  const current = Number(prod?.[col] || 0);
  if (current >= SAMPLE_TARGET) return current;
  const next = current + 1;
  await (supabaseAdmin as any)
    .from("products")
    .update({ [col]: next, updated_at: new Date().toISOString() })
    .eq("id", productId);
  return next;
}

async function enqueueJobIfReady(params: {
  orgId: string;
  productId: string;
  phase: "inquiry" | "sale";
  count: number;
}) {
  if (params.count < SAMPLE_TARGET) return;

  const jobPhase = params.phase === "inquiry" ? "inquiry_50" : "sale_50";

  const { data: existing } = await (supabaseAdmin as any)
    .from("product_learning_jobs")
    .select("id, status")
    .eq("product_id", params.productId)
    .eq("phase", jobPhase)
    .in("status", ["pending", "running", "done"])
    .maybeSingle();
  if (existing?.status === "done" || existing?.status === "running") return;
  if (existing?.status === "pending" && existing?.id) {
    // Sin cron: procesar el pending en cuanto haya tráfico
    void processProductLearningJob(String(existing.id)).catch((err) =>
      console.warn("[product-learning] process pending", err),
    );
    return;
  }

  const { data: samples } = await (supabaseAdmin as any)
    .from("product_learning_samples")
    .select("id")
    .eq("product_id", params.productId)
    .eq("phase", params.phase)
    .order("human_reply_count", { ascending: false })
    .order("qualified_at", { ascending: false })
    .limit(SAMPLE_TARGET);

  const sampleIds = (samples || []).map((s: any) => s.id);
  const { data: created, error } = await (supabaseAdmin as any)
    .from("product_learning_jobs")
    .insert({
      org_id: params.orgId,
      product_id: params.productId,
      phase: jobPhase,
      status: "pending",
      sample_ids: sampleIds,
    })
    .select("id")
    .maybeSingle();

  if (error && error.code !== "23505") {
    console.warn("[product-learning] enqueue job", error.message);
    return;
  }

  const jobId = created?.id ? String(created.id) : null;
  if (jobId) {
    // Procesar al llegar a 50 — no depende de cron externo
    void processProductLearningJob(jobId).catch((err) =>
      console.warn("[product-learning] process on enqueue", err),
    );
  } else {
    void kickProductLearningWorker({ force: true }).catch(() => {});
  }
}

/** Throttle global en memoria del proceso (Netlify/serverless: best-effort). */
let lastKickAt = 0;
const KICK_MIN_INTERVAL_MS = 90_000;

/**
 * Drena jobs pending sin cron. Llamar fire-and-forget desde ingest / UI.
 */
export async function kickProductLearningWorker(opts?: {
  force?: boolean;
  limit?: number;
}): Promise<number> {
  const now = Date.now();
  if (!opts?.force && now - lastKickAt < KICK_MIN_INTERVAL_MS) return 0;
  lastKickAt = now;
  try {
    return await processPendingProductLearningJobs(opts?.limit ?? 2);
  } catch (err) {
    console.warn(
      "[product-learning] kick worker",
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}

/**
 * Evalúa si el thread califica como sample inquiry y/o sale.
 * Seguro llamar en fire-and-forget tras mensajes / compras.
 */
export async function maybeQualifyProductLearning(params: {
  orgId: string;
  threadId: string;
  contactId?: string | null;
  /** Si true, intenta fase sale aunque inquiry ya exista */
  preferSale?: boolean;
}): Promise<void> {
  try {
    const productId = await resolveProductIdForThread(params);
    if (!productId) return;

    const humanCount = await countAgentReplies(params.threadId);
    if (humanCount < MIN_HUMAN_REPLIES) return;

    const contactId = params.contactId || null;
    const hasSale = await threadHasSale({
      orgId: params.orgId,
      threadId: params.threadId,
      contactId,
    });
    const transcript = await buildTranscriptExcerpt(params.threadId);
    const flows = await listFlowsActivated({
      orgId: params.orgId,
      contactId,
    });

    // Fase inquiry
    const { data: existingInquiry } = await (supabaseAdmin as any)
      .from("product_learning_samples")
      .select("id")
      .eq("product_id", productId)
      .eq("thread_id", params.threadId)
      .eq("phase", "inquiry")
      .maybeSingle();

    if (!existingInquiry) {
      const { data: prod } = await (supabaseAdmin as any)
        .from("products")
        .select("learning_inquiry_count")
        .eq("id", productId)
        .maybeSingle();
      if (Number(prod?.learning_inquiry_count || 0) < SAMPLE_TARGET) {
        const { error } = await (supabaseAdmin as any)
          .from("product_learning_samples")
          .insert({
            org_id: params.orgId,
            product_id: productId,
            thread_id: params.threadId,
            contact_id: contactId,
            phase: "inquiry",
            human_reply_count: humanCount,
            transcript_excerpt: transcript,
            flows_activated: flows,
            outcome: hasSale ? "sale" : "open",
          });
        if (!error) {
          const count = await bumpProductCounter(productId, "inquiry");
          await enqueueJobIfReady({
            orgId: params.orgId,
            productId,
            phase: "inquiry",
            count,
          });
        } else if (error.code !== "23505") {
          console.warn("[product-learning] insert inquiry sample", error.message);
        }
      }
    }

    // Fase sale
    if (hasSale || params.preferSale) {
      const saleOk = hasSale || (await threadHasSale(params));
      if (!saleOk) return;

      const { data: existingSale } = await (supabaseAdmin as any)
        .from("product_learning_samples")
        .select("id")
        .eq("product_id", productId)
        .eq("thread_id", params.threadId)
        .eq("phase", "sale")
        .maybeSingle();
      if (existingSale) return;

      const { data: prod } = await (supabaseAdmin as any)
        .from("products")
        .select("learning_sale_count")
        .eq("id", productId)
        .maybeSingle();
      if (Number(prod?.learning_sale_count || 0) >= SAMPLE_TARGET) return;

      const { error } = await (supabaseAdmin as any).from("product_learning_samples").insert({
        org_id: params.orgId,
        product_id: productId,
        thread_id: params.threadId,
        contact_id: contactId,
        phase: "sale",
        human_reply_count: humanCount,
        transcript_excerpt: transcript,
        flows_activated: flows,
        outcome: "sale",
      });
      if (!error) {
        const count = await bumpProductCounter(productId, "sale");
        await enqueueJobIfReady({
          orgId: params.orgId,
          productId,
          phase: "sale",
          count,
        });
      } else if (error.code !== "23505") {
        console.warn("[product-learning] insert sale sample", error.message);
      }
    }
  } catch (err) {
    console.warn(
      "[product-learning] maybeQualify",
      err instanceof Error ? err.message : err,
    );
  }
}

export async function backupProductPrompt(params: {
  orgId: string;
  productId: string;
  source: "manual" | "learning_inquiry" | "learning_sale" | "restore";
  jobId?: string | null;
  /** Si se pasa, usa este texto; si no, lee ai_observation actual */
  promptText?: string | null;
}): Promise<void> {
  let text = params.promptText;
  if (text === undefined) {
    const { data: prod } = await (supabaseAdmin as any)
      .from("products")
      .select("ai_observation")
      .eq("id", params.productId)
      .eq("org_id", params.orgId)
      .maybeSingle();
    text = prod?.ai_observation ?? "";
  }
  await (supabaseAdmin as any).from("product_prompt_versions").insert({
    org_id: params.orgId,
    product_id: params.productId,
    prompt_text: String(text || ""),
    source: params.source,
    job_id: params.jobId || null,
  });
}

function formatSamplesForLlm(
  samples: any[],
  productName: string,
  phase: "inquiry_50" | "sale_50",
): string {
  const blocks = samples.map((s, i) => {
    const turns = Array.isArray(s.transcript_excerpt) ? s.transcript_excerpt : [];
    const lines = turns
      .map((t: TranscriptTurn) => {
        const who =
          t.role === "in"
            ? "CLIENTE"
            : t.source === "agent"
              ? "AGENTE_HUMANO"
              : "NOSOTROS";
        return `${who}: ${t.text}`;
      })
      .join("\n");
    const flows = Array.isArray(s.flows_activated)
      ? s.flows_activated
          .map((f: any) => `${f.name || f.flow_id} (${f.reason || ""})`)
          .join("; ")
      : "";
    return [
      `--- CHAT ${i + 1} (respuestas humanas: ${s.human_reply_count}) ---`,
      flows ? `Flujos: ${flows}` : "",
      lines,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const goal =
    phase === "inquiry_50"
      ? "Crea un PROMPT DE VENDEDOR (Observación para la IA) para atender este producto exactamente como el equipo humano."
      : "Mejora el prompt actual combinándolo con patrones de chats que SÍ cerraron venta (super-prompt).";

  return [
    `Producto: ${productName}`,
    goal,
    "Incluye: pasos habituales, preguntas frecuentes del cliente, respuestas EXACTAS o muy cercanas del agente humano, y cuándo se activan flujos.",
    "No inventes precios, políticas ni datos que no aparezcan. Máximo ~3500 caracteres. Español colombiano natural.",
    "Escribe SOLO el texto del prompt (sin markdown de explicación).",
    "",
    ...blocks,
  ].join("\n");
}

async function generatePromptWithAi(params: {
  orgId: string;
  productName: string;
  phase: "inquiry_50" | "sale_50";
  samples: any[];
  currentPrompt?: string | null;
}): Promise<string> {
  // Dynamic import: evita arrastrar ai.server (+ meta-capi/node:crypto) al bundle del cliente
  const { callAiProvider, getAiConfigFromDb } = await import("@/lib/ai.server");
  const cfg = await getAiConfigFromDb(params.orgId);
  if (!cfg) throw new Error("Sin configuración de IA en la organización");

  const corpus = formatSamplesForLlm(params.samples, params.productName, params.phase);
  const system =
    params.phase === "sale_50"
      ? "Eres un coach de ventas. Fusionas el prompt actual con evidencia de chats que vendieron. Conserva el tono y frases del equipo."
      : "Eres un coach de ventas. Extraes un prompt operativo a partir de chats reales atendidos por humanos.";

  const userParts = [
    params.phase === "sale_50" && params.currentPrompt
      ? `PROMPT ACTUAL:\n${String(params.currentPrompt).slice(0, 4000)}\n\n`
      : "",
    corpus.slice(0, 28000),
  ];

  const { text } = await callAiProvider(cfg as Record<string, unknown>, [
    { role: "system", content: system },
    { role: "user", content: userParts.join("") },
  ]);

  const cleaned = String(text || "")
    .trim()
    .replace(/^```[\w]*\n?/i, "")
    .replace(/```$/i, "")
    .trim()
    .slice(0, MAX_PROMPT_CHARS);
  if (cleaned.length < 40) throw new Error("Prompt generado demasiado corto");
  return cleaned;
}

async function applyGeneratedPrompt(params: {
  orgId: string;
  productId: string;
  prompt: string;
  jobId: string;
  phase: "inquiry_50" | "sale_50";
}) {
  await backupProductPrompt({
    orgId: params.orgId,
    productId: params.productId,
    source: params.phase === "inquiry_50" ? "learning_inquiry" : "learning_sale",
    jobId: params.jobId,
  });

  const patch: Record<string, unknown> = {
    ai_observation: params.prompt,
    updated_at: new Date().toISOString(),
  };
  if (params.phase === "inquiry_50") {
    patch.learning_inquiry_prompt_at = new Date().toISOString();
  } else {
    patch.learning_sale_prompt_at = new Date().toISOString();
  }

  const { error } = await (supabaseAdmin as any)
    .from("products")
    .update(patch)
    .eq("id", params.productId)
    .eq("org_id", params.orgId);
  if (error) throw new Error(error.message);
}

export async function processProductLearningJob(jobId: string): Promise<void> {
  const { data: job } = await (supabaseAdmin as any)
    .from("product_learning_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.status !== "pending") return;

  await (supabaseAdmin as any)
    .from("product_learning_jobs")
    .update({ status: "running", updated_at: new Date().toISOString(), error: null })
    .eq("id", jobId);

  try {
    const { data: product } = await (supabaseAdmin as any)
      .from("products")
      .select("id, name, ai_observation")
      .eq("id", job.product_id)
      .maybeSingle();
    if (!product) throw new Error("Producto no encontrado");

    const samplePhase = job.phase === "sale_50" ? "sale" : "inquiry";
    let samples: any[] = [];
    if (Array.isArray(job.sample_ids) && job.sample_ids.length) {
      const { data } = await (supabaseAdmin as any)
        .from("product_learning_samples")
        .select("*")
        .in("id", job.sample_ids);
      samples = data || [];
    }
    if (samples.length < 10) {
      const { data } = await (supabaseAdmin as any)
        .from("product_learning_samples")
        .select("*")
        .eq("product_id", job.product_id)
        .eq("phase", samplePhase)
        .order("human_reply_count", { ascending: false })
        .limit(SAMPLE_TARGET);
      samples = data || [];
    }
    if (samples.length < 5) throw new Error(`Pocos samples (${samples.length})`);

    const prompt = await generatePromptWithAi({
      orgId: job.org_id,
      productName: product.name || "Producto",
      phase: job.phase,
      samples,
      currentPrompt: product.ai_observation,
    });

    await applyGeneratedPrompt({
      orgId: job.org_id,
      productId: job.product_id,
      prompt,
      jobId,
      phase: job.phase,
    });

    await (supabaseAdmin as any)
      .from("product_learning_jobs")
      .update({
        status: "done",
        generated_prompt: prompt,
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await (supabaseAdmin as any)
      .from("product_learning_jobs")
      .update({
        status: "failed",
        error: msg.slice(0, 500),
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    console.warn("[product-learning] job failed", jobId, msg);
  }
}

/** Procesa jobs pending (cron). */
export async function processPendingProductLearningJobs(limit = 3): Promise<number> {
  const { data: jobs } = await (supabaseAdmin as any)
    .from("product_learning_jobs")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  let n = 0;
  for (const j of jobs || []) {
    await processProductLearningJob(j.id);
    n++;
    await sleep(200);
  }

  // Reintentar failed antiguos (máx 1)
  const { data: failed } = await (supabaseAdmin as any)
    .from("product_learning_jobs")
    .select("id")
    .eq("status", "failed")
    .order("updated_at", { ascending: true })
    .limit(1);
  for (const j of failed || []) {
    await (supabaseAdmin as any)
      .from("product_learning_jobs")
      .update({ status: "pending", error: null, updated_at: new Date().toISOString() })
      .eq("id", j.id);
    await processProductLearningJob(j.id);
    n++;
  }
  return n;
}

/** Restaura el último backup (antes del actual). */
export async function restorePreviousProductPrompt(params: {
  orgId: string;
  productId: string;
}): Promise<{ ok: boolean; restored?: string }> {
  const { data: versions } = await (supabaseAdmin as any)
    .from("product_prompt_versions")
    .select("id, prompt_text, created_at")
    .eq("org_id", params.orgId)
    .eq("product_id", params.productId)
    .order("created_at", { ascending: false })
    .limit(1);

  const last = versions?.[0];
  if (!last) return { ok: false };

  const { data: prod } = await (supabaseAdmin as any)
    .from("products")
    .select("ai_observation")
    .eq("id", params.productId)
    .eq("org_id", params.orgId)
    .maybeSingle();

  // Guardar actual como restore-point
  await backupProductPrompt({
    orgId: params.orgId,
    productId: params.productId,
    source: "restore",
    promptText: prod?.ai_observation ?? "",
  });

  const { error } = await (supabaseAdmin as any)
    .from("products")
    .update({
      ai_observation: last.prompt_text || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.productId)
    .eq("org_id", params.orgId);
  if (error) throw new Error(error.message);
  return { ok: true, restored: last.prompt_text };
}

export async function getProductLearningStatus(params: {
  orgId: string;
  productId: string;
}) {
  const { data: prod } = await (supabaseAdmin as any)
    .from("products")
    .select(
      "learning_inquiry_count, learning_sale_count, learning_inquiry_prompt_at, learning_sale_prompt_at, ai_observation",
    )
    .eq("id", params.productId)
    .eq("org_id", params.orgId)
    .maybeSingle();

  const { data: jobs } = await (supabaseAdmin as any)
    .from("product_learning_jobs")
    .select("id, phase, status, error, finished_at, created_at")
    .eq("product_id", params.productId)
    .order("created_at", { ascending: false })
    .limit(4);

  const { count: backupCount } = await (supabaseAdmin as any)
    .from("product_prompt_versions")
    .select("id", { count: "exact", head: true })
    .eq("product_id", params.productId);

  return {
    inquiryCount: Number(prod?.learning_inquiry_count || 0),
    saleCount: Number(prod?.learning_sale_count || 0),
    inquiryPromptAt: prod?.learning_inquiry_prompt_at || null,
    salePromptAt: prod?.learning_sale_prompt_at || null,
    target: SAMPLE_TARGET,
    minHumanReplies: MIN_HUMAN_REPLIES,
    jobs: jobs || [],
    hasBackup: (backupCount || 0) > 0,
  };
}
