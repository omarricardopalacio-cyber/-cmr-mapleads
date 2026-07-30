/**
 * Importación de historial WhatsApp (1:1, sin grupos).
 * - Guarda mensajes en CRM
 * - Clasifica con vigilante + segmentos + etiquetas
 * - NO dispara auto-replies ni flujos (evita spam)
 */
// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sanitizeMessageText, isWhatsAppSystemText } from "@/lib/message-text";
import { applyEntrySegmentToContact } from "@/lib/ad-segments.server";
import { ensureContactTag } from "@/lib/contact-tag.server";
import { runIntentWatcher } from "@/lib/intent-watcher.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Session-Token",
  "Access-Control-Max-Age": "86400",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const MsgSchema = z.object({
  waMessageId: z.string().min(1).max(200).optional(),
  text: z.string().max(20000).optional().nullable(),
  fromMe: z.boolean().optional(),
  direction: z.enum(["in", "out"]).optional(),
  sentAt: z.union([z.string(), z.number()]).optional(),
  type: z.string().max(64).optional(),
});

const BodySchema = z.object({
  chatId: z.string().min(3).max(200),
  contact: z
    .object({
      waId: z.string().min(1).max(200).optional(),
      displayName: z.string().max(255).optional().nullable(),
      phone: z.string().max(32).optional().nullable(),
      profilePictureUrl: z.string().max(2000).optional().nullable(),
    })
    .optional(),
  messages: z.array(MsgSchema).max(250),
  classify: z.boolean().optional().default(true),
  /** Etiquetas de WhatsApp Business (labels) del chat */
  labels: z.array(z.string().max(80)).max(20).optional(),
});

/** Normaliza el body antes de Zod para evitar "Invalid payload" por basura de WA. */
function sanitizeImportBody(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const b = raw as Record<string, unknown>;
  const contact = (b.contact && typeof b.contact === "object"
    ? { ...(b.contact as Record<string, unknown>) }
    : {}) as Record<string, unknown>;

  if (typeof contact.displayName === "string") {
    contact.displayName = contact.displayName.slice(0, 255);
  }
  if (typeof contact.profilePictureUrl === "string") {
    const pic = contact.profilePictureUrl;
    if (!pic.startsWith("http") || pic.length > 2000) delete contact.profilePictureUrl;
  }
  if (typeof contact.phone === "string") {
    contact.phone = contact.phone.replace(/\D/g, "").slice(0, 32) || null;
  }

  const msgsIn = Array.isArray(b.messages) ? b.messages : [];
  const messages = msgsIn.slice(0, 220).map((m: any) => {
    const waMessageId =
      typeof m?.waMessageId === "string" && m.waMessageId.trim()
        ? m.waMessageId.trim().slice(0, 200)
        : undefined;
    let text = m?.text ?? m?.body ?? "";
    if (typeof text !== "string") text = String(text ?? "");
    text = text.slice(0, 20000);
    let type = typeof m?.type === "string" ? m.type.slice(0, 64) : undefined;
    let sentAt = m?.sentAt ?? m?.timestamp;
    if (typeof sentAt === "string" || typeof sentAt === "number") {
      /* ok */
    } else {
      sentAt = undefined;
    }
    return {
      waMessageId,
      text,
      fromMe: !!m?.fromMe,
      direction: m?.fromMe ? "out" : m?.direction === "out" ? "out" : "in",
      sentAt,
      type,
    };
  });

  const labels = Array.isArray(b.labels)
    ? b.labels.map((l) => String(l).slice(0, 80)).filter(Boolean).slice(0, 20)
    : undefined;

  return {
    chatId: String(b.chatId || "").trim().slice(0, 200),
    contact: Object.keys(contact).length ? contact : undefined,
    messages,
    classify: b.classify !== false,
    labels,
  };
}

function digits(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).split("@")[0].replace(/\D/g, "");
  return s || undefined;
}

/** Nunca persistir el LID como teléfono (14–15 dígitos del @lid). */
function sanitizePhone(phone: string | undefined, waId: string): string | undefined {
  if (!phone) return undefined;
  const d = digits(phone);
  if (!d || d.length < 8 || d.length > 15) return undefined;
  if (String(waId).includes("@lid")) {
    const lidDigits = digits(waId);
    if (lidDigits && d === lidDigits) return undefined;
  }
  return d;
}

function toIso(ts: unknown): string {
  if (ts == null) return new Date().toISOString();
  if (typeof ts === "string") {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  if (typeof ts === "number") {
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  return new Date().toISOString();
}

function isGroupJid(jid: string): boolean {
  return String(jid).includes("@g.us");
}

export const Route = createFileRoute("/api/public/engine/import-history")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const token = request.headers.get("x-session-token");
        if (!token) return json(401, { error: "Missing session token" });

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json(400, { error: "Invalid JSON" });
        }

        const parsed = BodySchema.safeParse(sanitizeImportBody(raw));
        if (!parsed.success) {
          return json(400, {
            error: "Invalid payload",
            issues: parsed.error.issues.slice(0, 5),
          });
        }

        const body = parsed.data;
        if (isGroupJid(body.chatId)) {
          return json(400, { error: "groups_not_allowed", skipped: true });
        }

        const { data: session, error: sErr } = await supabaseAdmin
          .from("wa_sessions")
          .select("id, org_id, me_wa_id, phone_number")
          .eq("session_token", token)
          .maybeSingle();
        if (sErr || !session) return json(401, { error: "Invalid session token" });

        const orgId = session.org_id;
        const chatId = body.chatId.trim();
        const waId =
          body.contact?.waId?.trim() ||
          (chatId.includes("@") ? chatId : `${digits(chatId) || chatId}@c.us`);

        if (isGroupJid(waId)) {
          return json(400, { error: "groups_not_allowed", skipped: true });
        }

        let phone = sanitizePhone(
          body.contact?.phone ? digits(body.contact.phone) : undefined,
          waId,
        );
        if (!phone && !String(waId).includes("@lid")) {
          phone = sanitizePhone(digits(waId), waId);
        }

        const rawName =
          (body.contact?.displayName && String(body.contact.displayName).trim()) || "";
        const usefulName =
          !!rawName &&
          !/^cliente\s*\d+/i.test(rawName) &&
          rawName.toLowerCase() !== "unknown" &&
          rawName.toLowerCase() !== "sin número" &&
          !/^[.\-…·_*]+$/.test(rawName) &&
          rawName !== digits(waId);

        const hasMessages = Array.isArray(body.messages) && body.messages.length > 0;

        // Solo-LID vacío SIN mensajes → omitir. Con mensajes → crear (luego se enriquece).
        if (String(waId).includes("@lid") && !phone && !usefulName && !hasMessages) {
          return json(200, {
            ok: true,
            skipped: true,
            reason: "blank_lid_contact",
            imported: 0,
          });
        }

        const displayName =
          rawName ||
          (phone ? `+${phone}` : usefulName ? rawName : hasMessages ? "Cliente WhatsApp" : "Cliente");

        const pic =
          typeof body.contact?.profilePictureUrl === "string" &&
          body.contact.profilePictureUrl.startsWith("http")
            ? body.contact.profilePictureUrl
            : undefined;

        // Upsert contacto
        let contactId: string | null = null;
        if (phone) {
          const { data: byPhone } = await supabaseAdmin
            .from("contacts")
            .select("id")
            .eq("org_id", orgId)
            .eq("phone", phone)
            .maybeSingle();
          contactId = byPhone?.id ?? null;
        }
        if (!contactId) {
          const { data: byWa } = await supabaseAdmin
            .from("contacts")
            .select("id")
            .eq("org_id", orgId)
            .eq("wa_id", waId)
            .maybeSingle();
          contactId = byWa?.id ?? null;
        }
        if (!contactId) {
          const { data: created, error } = await supabaseAdmin
            .from("contacts")
            .insert({
              org_id: orgId,
              wa_id: waId,
              phone: phone || null,
              display_name: displayName,
              ...(pic ? { profile_picture_url: pic } : {}),
            } as any)
            .select("id")
            .single();
          if (error || !created?.id) {
            return json(500, { error: error?.message || "contact_create_failed" });
          }
          contactId = created.id;
        } else {
          await supabaseAdmin
            .from("contacts")
            .update({
              display_name: displayName,
              ...(phone ? { phone } : {}),
              ...(pic ? { profile_picture_url: pic } : {}),
              updated_at: new Date().toISOString(),
            } as any)
            .eq("id", contactId);
        }

        // Thread
        let threadId: string | null = null;
        const { data: existingThread } = await supabaseAdmin
          .from("threads")
          .select("id")
          .eq("org_id", orgId)
          .eq("session_id", session.id)
          .eq("contact_id", contactId)
          .maybeSingle();

        if (existingThread?.id) {
          threadId = existingThread.id;
        } else {
          const { data: th, error: thErr } = await supabaseAdmin
            .from("threads")
            .insert({
              org_id: orgId,
              session_id: session.id,
              contact_id: contactId,
              status: "open",
              ai_enabled: false,
            } as any)
            .select("id")
            .single();
          if (thErr || !th?.id) {
            // fallback sin ai_enabled / session
            const { data: th2, error: thErr2 } = await supabaseAdmin
              .from("threads")
              .insert({
                org_id: orgId,
                contact_id: contactId,
                status: "open",
              } as any)
              .select("id")
              .single();
            if (thErr2 || !th2?.id) {
              return json(500, { error: thErr?.message || thErr2?.message || "thread_failed" });
            }
            threadId = th2.id;
          } else {
            threadId = th.id;
          }
        }

        let imported = 0;
        let skipped = 0;
        const inboundTexts: string[] = [];

        // Ordenar cronológicamente
        const msgs = [...body.messages].sort((a, b) => {
          const ta = new Date(toIso(a.sentAt)).getTime();
          const tb = new Date(toIso(b.sentAt)).getTime();
          return ta - tb;
        });

        for (const m of msgs) {
          const fromMe = m.fromMe === true || m.direction === "out";
          const direction = fromMe ? "out" : "in";
          const text =
            sanitizeMessageText(m.text ?? null) ||
            (typeof m.text === "string" ? m.text.trim() : "") ||
            null;

          if (text && isWhatsAppSystemText(text)) {
            skipped++;
            continue;
          }
          if (!text) {
            skipped++;
            continue;
          }

          const waMessageId =
            m.waMessageId ||
            `hist-${chatId}-${direction}-${toIso(m.sentAt)}-${text.slice(0, 24)}`;

          if (m.waMessageId) {
            const { data: exists } = await supabaseAdmin
              .from("messages")
              .select("id")
              .eq("thread_id", threadId)
              .eq("wa_message_id", m.waMessageId)
              .maybeSingle();
            if (exists?.id) {
              skipped++;
              if (direction === "in") inboundTexts.push(text);
              continue;
            }
          }

          const { error: insErr } = await supabaseAdmin.from("messages").insert({
            org_id: orgId,
            thread_id: threadId,
            wa_message_id: waMessageId,
            direction,
            text,
            media: null,
            raw: null,
            sent_at: toIso(m.sentAt),
          });

          if (insErr) {
            if (String(insErr.message || "").includes("duplicate") || insErr.code === "23505") {
              skipped++;
            } else {
              console.warn("[import-history] insert:", insErr.message);
              skipped++;
            }
            continue;
          }
          imported++;
          if (direction === "in") inboundTexts.push(text);
        }

        await supabaseAdmin
          .from("threads")
          .update({ updated_at: new Date().toISOString() } as any)
          .eq("id", threadId);

        const classification: Record<string, unknown> = {
          intent_key: null,
          segment: null,
          tags: [] as string[],
        };

        if (body.classify !== false && contactId) {
          // 1) Segmento: preferir primer mensaje entrante (frase de anuncio)
          const firstIn = inboundTexts[0] || "";
          const allIn = inboundTexts.join("\n").slice(0, 4000);
          const segmentText = firstIn || allIn;

          if (segmentText) {
            const seg = await applyEntrySegmentToContact({
              orgId,
              contactId,
              text: segmentText,
              force: false,
            });
            if (seg.applied && seg.segment) {
              classification.segment = seg.segment.name;
              const tag = await ensureContactTag({
                orgId,
                contactId,
                tagName: seg.segment.name,
                color: "#a855f7",
              });
              if (tag.assigned) (classification.tags as string[]).push(seg.segment.name);
            }
          }

          // 2) Vigilante: intención + perfil (SIN iniciar flujos)
          if (allIn) {
            const watch = await runIntentWatcher({
              orgId,
              contactId,
              threadId,
              text: allIn,
              trigger: "message",
              skipFlowStart: true,
            });
            classification.intent_key = watch.intent_key ?? null;
            classification.watcher_skipped = watch.skipped;
            if (watch.intent_key) {
              const tag = await ensureContactTag({
                orgId,
                contactId,
                tagName: watch.intent_key,
                color: "#0ea5e9",
              });
              if (tag.assigned) (classification.tags as string[]).push(watch.intent_key);
            }
          }

          // 3) Labels de WhatsApp → etiquetas CRM
          for (const label of body.labels ?? []) {
            const name = String(label || "").trim();
            if (!name) continue;
            const tag = await ensureContactTag({
              orgId,
              contactId,
              tagName: name,
              color: "#64748b",
            });
            if (tag.assigned) (classification.tags as string[]).push(name);
          }
        }

        return json(200, {
          ok: true,
          contactId,
          threadId,
          chatId,
          imported,
          skipped,
          classification,
        });
      },
    },
  },
});
