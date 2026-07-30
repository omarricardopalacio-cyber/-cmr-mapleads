// @ts-nocheck
import { createFileRoute } from '@tanstack/react-router'
import { supabaseAdmin } from '@/integrations/supabase/client.server'
import {
  sanitizeMessageText,
  isWhatsAppSystemText,
  stripLeakedToolMarkup,
} from '@/lib/message-text'
import {
  enrichMediaForMessage,
  stripHeavyFieldsForDb,
  toLocalOnlyMediaMeta,
} from '@/lib/engine-media.server'
import { registerFailedAiRequest, sendSupportMessage } from '@/lib/retry-manager.server'
import { loadCustomerMemory, extractAndSaveMemory } from '@/lib/ai/customer-memory.server'
import { transcribeInboundAudio } from '@/lib/ai/transcribe.server'
import { storagePathFromMediaUrl } from '@/lib/media'
import { z } from 'zod'
import { createDedupTracker, buildInboundDedupKey, buildAiReplyDedupKey } from './-ingest-dedupe'
import { ensureFlowRunForContact } from '@/lib/flow-trigger.server'

const dyn = () => supabaseAdmin as unknown as { from: (t: string) => any }

/** Borra el archivo de Storage tras usar el audio (p. ej. Whisper). No falla el ingest. */
async function deleteCloudMediaFile(media: Record<string, unknown> | null | undefined): Promise<void> {
  if (!media) return
  const path =
    (typeof media.storagePath === 'string' && media.storagePath) ||
    (typeof media.url === 'string' ? storagePathFromMediaUrl(media.url) : null)
  if (!path) return
  try {
    const { error } = await supabaseAdmin.storage.from('media').remove([path])
    if (error) console.warn('[ingest] deleteCloudMediaFile:', error.message)
  } catch (err) {
    console.warn('[ingest] deleteCloudMediaFile error:', (err as Error)?.message)
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token',
  'Access-Control-Max-Age': '86400',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })

const EventSchema = z
  .object({
    type: z.string().min(1).max(64),
    chatId: z.string().min(1).max(128).optional(),
    waMessageId: z.string().min(1).max(128).optional(),
    direction: z.enum(['in', 'out']).optional(),
    text: z.string().max(20000).optional(),
    media: z.record(z.string(), z.any()).optional(),
    raw: z.record(z.string(), z.any()).optional(),
    contact: z
      .object({
        waId: z.string().min(1).max(64),
        displayName: z.string().max(255).optional(),
        phone: z.string().max(32).optional(),
        profilePictureUrl: z.string().max(2000).optional(),
      })
      .optional(),
    sentAt: z.union([z.string(), z.number()]).optional(),
    commandId: z.string().uuid().optional(),
    ackStatus: z.string().max(32).optional(),
    payload: z.record(z.string(), z.any()).optional(),
    /** Importación de historial: guardar sin auto-reply / IA / flujos */
    historical: z.boolean().optional(),
    /** Tras guardar, clasificar vigilante+segmentos+tags (sin flujos) */
    historicalClassify: z.boolean().optional(),
  })
  .passthrough()

type NormalizedEvent = {
  type: 'message-in' | 'message-out' | 'heartbeat' | 'status' | 'ack'
  chatId?: string
  waMessageId?: string
  direction?: 'in' | 'out'
  text?: string
  media?: Record<string, unknown>
  raw?: Record<string, unknown>
  contact?: { waId: string; displayName?: string; phone?: string; profilePictureUrl?: string }
  sentAt?: string
  commandId?: string
  ackStatus?: string
  mediaRecovery?: boolean
  historical?: boolean
  historicalClassify?: boolean
}

const TYPE_MAP: Record<string, NormalizedEvent['type']> = {
  'message-in': 'message-in',
  'message-out': 'message-out',
  heartbeat: 'heartbeat',
  status: 'status',
  ack: 'ack',
  NEW_MESSAGE: 'message-in',
  MESSAGE_SENT: 'message-out',
  CONTACT_INFO: 'status',
  MESSAGE_ACK: 'ack',
  MESSAGE_FAILED: 'ack',
  SESSION_READY: 'heartbeat',
  SESSION_LOST: 'heartbeat',
  HEARTBEAT: 'heartbeat',
}

function toIso(ts: unknown): string | undefined {
  if (ts == null) return undefined
  if (typeof ts === 'string') {
    const d = new Date(ts)
    return isNaN(d.getTime()) ? undefined : d.toISOString()
  }
  if (typeof ts === 'number') {
    const ms = ts < 1e12 ? ts * 1000 : ts
    const d = new Date(ms)
    return isNaN(d.getTime()) ? undefined : d.toISOString()
  }
  return undefined
}

function digits(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).split('@')[0].replace(/\D/g, '')
  return s || undefined
}

function normalizeWaKey(v: unknown): string | undefined {
  if (v == null) return undefined
  const raw = String(v).trim().toLowerCase()
  if (!raw) return undefined
  const parts = raw.split('@')
  const user = parts[0]
  const domain = parts[1] || ''

  // Para LIDs, mantener el JID completo tal cual (alfanumérico y con guiones), ya que no son números de teléfono
  if (domain === 'lid' || raw.includes('@lid')) {
    return `${user}@lid`
  }

  // Para números de teléfono normales, quitar todo lo que no sean dígitos
  const base = user.replace(/\D/g, '')
  if (!base) return undefined
  return base
}

function isLidKey(v?: string | null): boolean {
  return Boolean(v && v.endsWith('@lid'))
}

/** Dígitos del user-part de un wa_id (detecta LID guardado como phone). */
function waIdUserDigits(waId?: string | null): string {
  if (!waId) return ''
  return String(waId).split('@')[0].replace(/\D/g, '')
}

/**
 * Nunca guardar un LID de WhatsApp como teléfono.
 * Tras el update de etiquetas WA, el resolver a veces devolvía el propio LID
 * (14–15 dígitos) y el CRM creaba un contacto “falso” + otro con el número real.
 */
function sanitizeContactPhone(
  phone: string | null | undefined,
  waId?: string | null,
): string | null {
  if (phone == null || phone === '') return null
  if (String(phone).includes('@lid')) return null
  const d = digits(phone)
  if (!d || d.length < 8 || d.length > 15) return null

  if (waId && isLidKey(waId)) {
    const lidDigits = waIdUserDigits(waId)
    if (lidDigits && d === lidDigits) return null
  }

  return d
}

function pickDisplayName(name: unknown, waId?: string, phone?: string): string | undefined {
  const clean = typeof name === 'string' ? name.trim() : ''
  if (clean && clean.toLowerCase() !== 'unknown') return clean
  return phone ?? waId?.replace(/@lid$/, '')
}

function isUsefulDisplayName(name: unknown, phone?: string, waId?: string): boolean {
  if (typeof name !== 'string') return false
  const clean = name.trim()
  if (!clean) return false
  const lower = clean.toLowerCase()
  if (lower === 'unknown') return false
  if (phone && clean === phone) return false
  if (waId && clean === waId.replace(/@lid$/, '')) return false
  if (clean.startsWith('Cliente')) return false
  return true
}

function canCreateContactRecord({
  waId,
  phone,
  displayName,
}: {
  waId: string
  phone?: string | null
  displayName?: string | null
}) {
  const cleanPhone = sanitizeContactPhone(phone, waId)
  if (cleanPhone) return true
  if (!waId) return false
  // Contacto solo-LID: crear sin phone para no perder el chat (luego CONTACT_INFO fusiona)
  if (isLidKey(waId)) return true
  if (!isLidKey(waId) && Boolean(digits(waId))) return true
  return isUsefulDisplayName(displayName, phone ?? undefined, waId)
}

function extractSessionTelemetry(rawEvent: z.infer<typeof EventSchema>) {
  const p = (rawEvent.payload as Record<string, unknown> | undefined) ?? (rawEvent.raw as Record<string, unknown> | undefined) ?? {}
  const device = (p.device as Record<string, unknown> | undefined) ?? (p.deviceInfo as Record<string, unknown> | undefined) ?? {}
  return {
    phoneNumber: typeof p.phoneNumber === 'string' ? p.phoneNumber : typeof p.me === 'string' ? p.me : undefined,
    deviceName: typeof device.name === 'string' ? device.name : typeof p.deviceName === 'string' ? p.deviceName : undefined,
    batteryLevel: typeof device.battery === 'number' ? device.battery : typeof p.battery === 'number' ? p.battery : undefined,
    platform: typeof device.platform === 'string' ? device.platform : typeof p.platform === 'string' ? p.platform : undefined,
  }
}

/** Desanida payloads dobles enviados por la extensión ({ payload: { payload: { chatId } } }). */
function unwrapBridgePayload(e: z.infer<typeof EventSchema>): Record<string, any> {
  const outer = (e.payload as Record<string, any>) || {}
  const inner = outer.payload
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return { ...outer, ...inner }
  }
  return outer
}

function normalizeEvent(e: z.infer<typeof EventSchema>, meWaId?: string | null): NormalizedEvent {
  const rawType = String(e.type || '')
  const type: NormalizedEvent['type'] = TYPE_MAP[rawType] ?? 'status'
  const p: Record<string, any> = unwrapBridgePayload(e)

  const chatId = e.chatId ?? p.chatId ?? p.from ?? p.to
  const waMessageId = e.waMessageId ?? p.waMessageId ?? p.messageId ?? p.message_id ?? p.id

   const fromWa = normalizeWaKey(p.from)
   const toWa = normalizeWaKey(p.to)
   const chatWa = normalizeWaKey(chatId)

  let direction: 'in' | 'out' | undefined = e.direction ?? p.direction
  if (!direction && typeof p.fromMe === 'boolean') direction = p.fromMe ? 'out' : 'in'

  if (meWaId) {
     if (digits(fromWa) === meWaId) direction = 'out'
     else if (digits(toWa) === meWaId) direction = 'in'
  }
  if (!direction) {
    if (type === 'message-in') direction = 'in'
    else if (type === 'message-out') direction = 'out'
  }

   const counterpart =
     (direction === 'out' ? toWa ?? chatWa ?? fromWa : fromWa ?? chatWa ?? toWa) ?? chatWa
   const counterpartPhone = counterpart && !isLidKey(counterpart) ? digits(counterpart) : undefined

  const rawText = e.text ?? p.text ?? p.body ?? p.content
  const text =
    rawText != null
      ? sanitizeMessageText(String(rawText), p.caption != null ? String(p.caption) : undefined) ?? undefined
      : undefined
  const sentAt = toIso(e.sentAt) ?? toIso(p.sentAt) ?? toIso(p.timestamp) ?? toIso(p.t)

  let contact = e.contact
  if (!contact && counterpart) {
    contact = {
      waId: counterpart,
       displayName: pickDisplayName(p.notifyName ?? p.pushname ?? p.author?.name, counterpart, counterpartPhone),
       phone: counterpartPhone,
       profilePictureUrl: p.profilePictureUrl ?? p.profilePicture,
    }
   } else if (contact && meWaId && digits(contact.waId) === meWaId && counterpart) {
     contact = {
       waId: counterpart,
       displayName: pickDisplayName(contact.displayName, counterpart, counterpartPhone),
       phone: counterpartPhone,
       profilePictureUrl: contact.profilePictureUrl ?? p.profilePictureUrl ?? p.profilePicture,
     }
   } else if (contact) {
     const normalizedWaId = normalizeWaKey(contact.waId) ?? counterpart
     const rawPhone = contact.phone ? digits(contact.phone) : counterpartPhone
     const normalizedPhone = sanitizeContactPhone(
       rawPhone ?? (!isLidKey(normalizedWaId) ? digits(normalizedWaId) : null),
       normalizedWaId,
     )
     if (normalizedWaId) {
       contact = {
         waId: normalizedWaId,
         displayName: pickDisplayName(contact.displayName, normalizedWaId, normalizedPhone ?? undefined),
         phone: normalizedPhone ?? undefined,
         profilePictureUrl: contact.profilePictureUrl ?? p.profilePictureUrl ?? p.profilePicture,
       }
     }
  }

  const commandId = e.commandId ?? p.commandId ?? p.taskId
  const ackStatus = e.ackStatus ?? p.status ?? p.ackStatus

  return {
    type,
    chatId: chatId ? String(chatId) : undefined,
    waMessageId: waMessageId ? String(waMessageId) : undefined,
    direction,
    text: text != null ? String(text) : undefined,
    media: (e.media as any) ?? p.media,
    raw: (e.raw as any) ?? (e.payload as any),
    contact,
    sentAt,
    commandId,
    ackStatus: ackStatus != null ? String(ackStatus) : undefined,
    mediaRecovery: !!(e as { mediaRecovery?: boolean }).mediaRecovery || !!(p as { mediaRecovery?: boolean }).mediaRecovery,
    historical: !!(e as { historical?: boolean }).historical || !!(p as { historical?: boolean }).historical,
    historicalClassify:
      !!(e as { historicalClassify?: boolean }).historicalClassify ||
      !!(p as { historicalClassify?: boolean }).historicalClassify,
  }
}


const PayloadSchema = z.object({
  events: z.array(EventSchema).min(1).max(50),
})

type AutoReplyRule = {
  id: string;
  match_type: string;
  match_value: string;
  reply_text: string;
  cooldown_seconds: number | null;
  last_triggered_at: string | null;
  session_id: string | null;
  trigger_type: string | null;
  media_url: string | null;
  mime_type: string | null;
  action_add_tags: string[] | null;
  action_remove_tags: string[] | null;
  action_ai_behavior: string | null;
};

async function maybeAutoReply(
  orgId: string,
  sessionId: string,
  chatId: string,
  text: string,
  threadId: string,
  contactId: string,
): Promise<{ aiDisabled: boolean; totalDelaySec: number }> {
  const { data: rules } = await supabaseAdmin
    .from('auto_replies')
    .select(
      'id, match_type, match_value, reply_text, cooldown_seconds, last_triggered_at, session_id, trigger_type, media_url, mime_type, action_add_tags, action_remove_tags, action_ai_behavior, limit_per_contact',
    )
    .eq('org_id', orgId)
    .eq('is_active', true);
  if (!rules?.length) return { aiDisabled: false };

  const lower = text.toLowerCase();
  for (const raw of rules as unknown[] as AutoReplyRule[]) {
    if (raw.session_id && raw.session_id !== sessionId) continue;

    const triggerType = raw.trigger_type || 'keyword';
    // no_response triggers are handled by the no-response-worker, not here
    if (triggerType === 'no_response') continue;
    let hit = false;

    if (triggerType === 'first_message_overall') {
      const { count } = await supabaseAdmin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', threadId);
      hit = (count ?? 0) <= 1; // <= 1 because current message is already inserted
    } else if (triggerType === 'first_message_month') {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const { count } = await supabaseAdmin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', threadId)
        .eq('direction', 'in')
        .gte('sent_at', startOfMonth.toISOString());
      hit = (count ?? 0) <= 1;
    } else {
      const v = (raw.match_value || '').toLowerCase().trim();
      try {
        const cleanText = lower.trim();
        if (raw.match_type === 'equals') hit = cleanText === v;
        else if (raw.match_type === 'starts') hit = cleanText.startsWith(v);
        else if (raw.match_type === 'regex') hit = new RegExp(raw.match_value, 'i').test(text);
        else hit = cleanText.includes(v);
      } catch {
        hit = false;
      }
    }

    if (!hit) continue;
    if (raw.last_triggered_at) {
      const diff = (Date.now() - new Date(raw.last_triggered_at).getTime()) / 1000;
      if (diff < (raw.cooldown_seconds ?? 0)) continue;
    }

    if (raw.limit_per_contact && raw.limit_per_contact > 0) {
      const { count } = await supabaseAdmin
        .from('auto_reply_triggers')
        .select('id', { count: 'exact', head: true })
        .eq('rule_id', raw.id)
        .eq('contact_id', contactId);
      if ((count ?? 0) >= raw.limit_per_contact) continue;
    }

    // Fetch steps
    const { data: steps } = await supabaseAdmin
      .from('auto_reply_steps')
      .select('*')
      .eq('rule_id', raw.id)
      .order('step_order', { ascending: true });

    if (steps && steps.length > 0) {
      // Execute steps
      // For short delays we just wait in place. If it's a huge delay it might timeout the webhook, 
      // but for normal bots (0-10s) it will work perfectly.
      for (const step of steps) {
        if (step.cooldown_seconds && step.cooldown_seconds > 0) {
          // Cap the wait to 10 seconds to prevent webhook timeout
          const waitTime = Math.min(step.cooldown_seconds, 10);
          await new Promise((r) => setTimeout(r, waitTime * 1000));
        }

        if (step.media_url) {
          console.log('[auto-reply] enqueuing send_media command', {
            chatId,
            mediaUrl: step.media_url,
            mimeType: step.mime_type,
            caption: step.text_content,
            stepId: step.id,
          });
          await supabaseAdmin.from('engine_commands').insert({
            org_id: orgId,
            session_id: sessionId,
            type: 'send_media',
            payload: { chatId, mediaUrl: step.media_url, mimeType: step.mime_type, caption: step.text_content },
            status: 'pending',
          });
        } else if (step.text_content) {
          console.log('[auto-reply] enqueuing send_message command', { chatId, text: step.text_content, stepId: step.id });
          await supabaseAdmin.from('engine_commands').insert({
            org_id: orgId,
            session_id: sessionId,
            type: 'send_message',
            payload: { chatId, text: step.text_content },
            status: 'pending',
          });
        } else {
          console.warn('[auto-reply] auto-reply step has no media_url or text_content', { stepId: step.id, step });
        }
      }
    }

    // Calculate total cooldown so AI knows how long to wait after auto-replies
    const totalDelaySec = (steps ?? []).reduce((acc: number, step: any) => {
      return acc + (step.cooldown_seconds && step.cooldown_seconds > 0 ? Math.min(step.cooldown_seconds, 10) : 0);
    }, 0);

    // Tags actions
    if (raw.action_add_tags?.length) {
      const inserts = raw.action_add_tags.map((tagId) => ({
        contact_id: contactId,
        tag_id: tagId,
      }));
      await (supabaseAdmin as unknown as { from: (t: string) => { upsert: (d: unknown[], opts?: unknown) => Promise<unknown> } }).from('contact_tags').upsert(inserts, { onConflict: 'contact_id,tag_id' });
    }
    if (raw.action_remove_tags?.length) {
      await (supabaseAdmin as unknown as { from: (t: string) => { delete: () => { eq: (c: string, v: string) => { in: (c: string, v: string[]) => Promise<unknown> } } } }).from('contact_tags').delete().eq('contact_id', contactId).in('tag_id', raw.action_remove_tags);
    }

    // AI behavior action
    let aiDisabled = false;
    if (raw.action_ai_behavior === 'disable_ai') {
      await supabaseAdmin.from('threads').update({ ai_enabled: false } as unknown as Record<string, never>).eq('id', threadId);
      aiDisabled = true;
    } else if (raw.action_ai_behavior === 'enable_ai') {
      await supabaseAdmin.from('threads').update({ ai_enabled: true } as unknown as Record<string, never>).eq('id', threadId);
    }

    await supabaseAdmin
      .from('auto_replies')
      .update({ last_triggered_at: new Date().toISOString() })
      .eq('id', raw.id);

    await supabaseAdmin.from('auto_reply_triggers').insert({
      org_id: orgId,
      rule_id: raw.id,
      contact_id: contactId,
    });

    return { aiDisabled, totalDelaySec };
  }
  return { aiDisabled: false, totalDelaySec: 0 };
}

async function resolvePhoneForLidMessage(args: {
  orgId: string
  sessionId: string
  waId: string
  text?: string
  sentAt?: string
}) {
  const { orgId, sessionId, waId, text, sentAt } = args

  const { data: existing } = await supabaseAdmin
    .from('contacts')
    .select('id, phone')
    .eq('org_id', orgId)
    .eq('wa_id', waId)
    .maybeSingle()
  if (existing?.phone) return { contactId: existing.id, phone: existing.phone }

  // Contacto ya fusionado: wa_id=@c.us pero el LID llegó en un mensaje nuevo
  // Buscar por LID en observations no aplica; mirar comandos recientes.

  if (text?.trim()) {
    const { data: commands } = await supabaseAdmin
      .from('engine_commands')
      .select('payload, created_at')
      .eq('org_id', orgId)
      .eq('session_id', sessionId)
      .eq('type', 'send_message')
      .order('created_at', { ascending: false })
      .limit(20)

    const targetTs = sentAt ? new Date(sentAt).getTime() : Date.now()
    for (const cmd of commands ?? []) {
      const payload = (cmd.payload as Record<string, unknown> | null) ?? {}
      if (String(payload.text ?? '').trim() !== text.trim()) continue
      const chatId = String(payload.chatId ?? '')
      const phone = digits(chatId)
      if (!phone) continue
      const createdTs = new Date(cmd.created_at).getTime()
      if (Math.abs(targetTs - createdTs) > 1000 * 60 * 30) continue
      return { contactId: existing?.id ?? null, phone }
    }
  }

  // Fallback: último envío reciente de la sesión (5 min) si el texto no coincide
  {
    const { data: recent } = await supabaseAdmin
      .from('engine_commands')
      .select('payload, created_at')
      .eq('org_id', orgId)
      .eq('session_id', sessionId)
      .eq('type', 'send_message')
      .order('created_at', { ascending: false })
      .limit(5)

    const now = Date.now()
    for (const cmd of recent ?? []) {
      const createdTs = new Date(cmd.created_at).getTime()
      if (now - createdTs > 1000 * 60 * 5) continue
      const payload = (cmd.payload as Record<string, unknown> | null) ?? {}
      const phone = digits(String(payload.chatId ?? ''))
      if (phone) return { contactId: existing?.id ?? null, phone }
    }
  }

  return { contactId: existing?.id ?? null, phone: null }
}

async function enrollContactInFlow(contactId: string, orgId: string, sessionId: string) {
  const { data: flows } = await dyn()
    .from('flows')
    .select('id')
    .eq('org_id', orgId)
    .eq('trigger_type', 'new_contact')
    .eq('is_active', true);
  for (const flow of flows ?? []) {
    const { data: firstStep } = await dyn()
      .from('flow_steps')
      .select('id')
      .eq('flow_id', flow.id)
      .is('parent_step_id', null)
      .order('step_order', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!firstStep) continue;
    await dyn()
      .from('flow_runs')
      .upsert({
        org_id: orgId,
        flow_id: flow.id,
        contact_id: contactId,
        current_step_id: firstStep.id,
        status: 'active',
        next_execution_at: new Date().toISOString(),
        last_interaction_at: new Date().toISOString(),
      }, { onConflict: 'flow_id,contact_id' })
      .select()
      .single();
  }
}

// Ventana amplia: el pitch del flujo + preguntas de cantidad/ciudad no deben
// empujar fuera del prompt el contexto del producto cuando el cliente cotiza.
const HISTORY_WINDOW = 30;
const MAX_MSG_CHARS = 2000;
const inboundEventDedupe = createDedupTracker(45_000);
const aiReplyDedupe = createDedupTracker(60_000);

async function loadThreadHistory(orgId: string, threadId: string, userText: string) {
  const { data: prior } = await supabaseAdmin
    .from('messages')
    .select('direction, text, sent_at')
    .eq('thread_id', threadId)
    .not('text', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(HISTORY_WINDOW)

  const priorMsgs = ((prior ?? []) as any[])
    .filter((m: any) => typeof m.text === 'string' && m.text.trim().length > 0)
    .reverse()
    .map((m: any) => ({
      role: (m.direction === 'out' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: String(m.text).trim().slice(0, MAX_MSG_CHARS),
    }))

  const lastPrior = priorMsgs[priorMsgs.length - 1]
  return lastPrior && lastPrior.role === 'user' && lastPrior.content === userText.trim()
    ? priorMsgs
    : [...priorMsgs, { role: 'user' as const, content: userText }]
}

async function hasRecentPendingReply(sessionId: string, threadId: string, chatId: string, text: string, windowMs: number = 45_000) {
  if (!sessionId || !threadId || !chatId) return false
  const since = new Date(Date.now() - windowMs).toISOString()
  const { data } = await supabaseAdmin
    .from('engine_commands')
    .select('id, payload, created_at')
    .eq('org_id', (await supabaseAdmin.from('threads').select('org_id').eq('id', threadId).maybeSingle()).data?.org_id ?? '')
    .eq('session_id', sessionId)
    .eq('type', 'SEND_MESSAGE')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20)

  const targetText = String(text ?? '').trim().toLowerCase()
  return (data ?? []).some((cmd: any) => {
    const payload = (cmd.payload as Record<string, unknown> | null) ?? {}
    const payloadText = String(payload.text ?? '').trim().toLowerCase()
    const sameChat = String(payload.chatId ?? '').trim() === String(chatId).trim()
    const sameText = payloadText && targetText && payloadText.includes(targetText)
    return sameChat && (sameText || payloadText === targetText)
  })
}

function normalizeForReplyDedup(text: string) {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

async function hasRecentQueuedReply(
  orgId: string,
  sessionId: string,
  chatId: string,
  text: string,
  windowMs = 120_000,
) {
  if (!orgId || !sessionId || !chatId || !text?.trim()) return false
  const since = new Date(Date.now() - windowMs).toISOString()
  const normalizedText = normalizeForReplyDedup(text)

  const { data } = await supabaseAdmin
    .from('engine_commands')
    .select('id, type, payload, status, scheduled_for, created_at')
    .eq('org_id', orgId)
    .eq('session_id', sessionId)
    .in('type', ['SEND_MESSAGE', 'send_message'])
    .in('status', ['pending', 'delivered'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(40)

  return (data ?? []).some((cmd: any) => {
    const payload = (cmd.payload as Record<string, unknown> | null) ?? {}
    const payloadText = normalizeForReplyDedup(String(payload.text ?? ''))
    const payloadChat = String(payload.chatId ?? '').trim()
    return payloadChat === String(chatId).trim() && payloadText === normalizedText
  })
}

/** Eco real: solo si el cliente reenvía EXACTO un bloque largo que acabamos de mandar. */
async function isExactEchoOfRecentOutbound(
  threadId: string,
  text: string,
  windowMs = 45_000,
): Promise<boolean> {
  const normalized = normalizeForReplyDedup(text)
  // Textos cortos (hola, 1, ok) nunca: el menú/IA casi siempre los contiene.
  if (!threadId || !normalized || normalized.length < 40) return false
  const since = new Date(Date.now() - windowMs).toISOString()
  const { data } = await supabaseAdmin
    .from('messages')
    .select('text')
    .eq('thread_id', threadId)
    .eq('direction', 'out')
    .gte('sent_at', since)
    .order('sent_at', { ascending: false })
    .limit(10)

  return (data ?? []).some((m: any) => {
    const out = normalizeForReplyDedup(String(m.text ?? ''))
    return out.length >= 40 && out === normalized
  })
}

function isSelfChat(chatId: string | undefined, meWaId: string | null | undefined, phoneNumber?: string | null) {
  const chatDigits = digits(chatId)
  if (!chatDigits) return false
  const me = digits(meWaId) || digits(phoneNumber)
  if (me && chatDigits === me) return true
  return false
}

/**
 * Filtros mínimos SIN rate-limit ni cancelación de colas.
 * Bucles se evitan con: solo direction=in, banners, self-chat, dedupe de mensaje
 * y no inventar fillers cuando la IA falla.
 */
async function shouldSkipAutomation(opts: {
  orgId: string
  sessionId: string
  threadId: string
  chatId: string
  text: string
  meWaId?: string | null
  phoneNumber?: string | null
  direction?: string
}): Promise<{ skip: boolean; reason?: string }> {
  const text = String(opts.text ?? '').trim()
  if (!text) return { skip: true, reason: 'empty' }
  if (opts.direction && opts.direction !== 'in') return { skip: true, reason: 'not_inbound' }
  if (isWhatsAppSystemText(text)) return { skip: true, reason: 'system_banner' }
  if (isSelfChat(opts.chatId, opts.meWaId, opts.phoneNumber)) {
    return { skip: true, reason: 'self_chat' }
  }
  if (await isExactEchoOfRecentOutbound(opts.threadId, text)) {
    return { skip: true, reason: 'exact_echo_of_outbound' }
  }
  return { skip: false }
}

async function hasExistingAiReplyCommand(
  orgId: string,
  sessionId: string,
  dedupeKey: string,
) {
  if (!orgId || !sessionId || !dedupeKey) return false

  const { data, error } = await supabaseAdmin
    .from('engine_commands')
    .select('id')
    .eq('org_id', orgId)
    .eq('session_id', sessionId)
    .contains('payload', { dedupeKey })
    .in('status', ['pending', 'delivered', 'acked'])
    .limit(1)

  if (error) {
    console.warn('[ai-reply] failed to query existing AI reply command', {
      orgId,
      sessionId,
      dedupeKey,
      error,
    })
    return false
  }

  return Array.isArray(data) && data.length > 0
}

async function hasDuplicateIncomingMessage(
  threadId: string,
  text: string | undefined,
  media: Record<string, unknown> | undefined,
  sentAt: string | undefined,
) {
  if (!threadId || !sentAt) return false

  const parsedSentAt = new Date(sentAt)
  if (Number.isNaN(parsedSentAt.getTime())) return false

  const windowMs = 3000
  const start = new Date(parsedSentAt.getTime() - windowMs).toISOString()
  const end = new Date(parsedSentAt.getTime() + windowMs).toISOString()

  let query = supabaseAdmin
    .from('messages')
    .select('id')
    .eq('thread_id', threadId)
    .eq('direction', 'in')
    .gte('sent_at', start)
    .lte('sent_at', end)
    .limit(1)

  if (text) query = query.eq('text', text)
  if (media) query = query.not('media', 'is', null)

  const { data } = await query
  return Array.isArray(data) && data.length > 0
}

async function hasDuplicateOutgoingMessage(
  threadId: string,
  text: string | undefined,
  media: Record<string, unknown> | undefined,
  sentAt: string | undefined,
) {
  if (!threadId || !sentAt) return false

  const parsedSentAt = new Date(sentAt)
  if (Number.isNaN(parsedSentAt.getTime())) return false

  const windowMs = 3000
  const start = new Date(parsedSentAt.getTime() - windowMs).toISOString()
  const end = new Date(parsedSentAt.getTime() + windowMs).toISOString()

  let query = supabaseAdmin
    .from('messages')
    .select('id')
    .eq('thread_id', threadId)
    .eq('direction', 'out')
    .gte('sent_at', start)
    .lte('sent_at', end)
    .limit(1)

  if (text) query = query.eq('text', text)
  if (media) query = query.not('media', 'is', null)

  const { data } = await query
  return Array.isArray(data) && data.length > 0
}

/** True si el payload trae algo visible en el CRM (texto o media útil). */
function hasRenderableMessageContent(
  text: string | null | undefined,
  media: Record<string, unknown> | null | undefined,
): boolean {
  if (typeof text === 'string' && text.trim().length > 0) return true
  if (!media || typeof media !== 'object') return false
  if (typeof media.url === 'string' && media.url.trim()) return true
  if (media.localOnly === true) return true
  if (media.missing_media === true) return true
  if (typeof media.body === 'string' && media.body.length > 20) return true
  if (typeof media.base64 === 'string' && media.base64.length > 20) return true
  if (typeof media.data === 'string' && media.data.length > 20) return true
  if (typeof media.type === 'string' && media.type.length > 0) return true
  return false
}

async function maybeAiReply(
  orgId: string,
  sessionId: string,
  chatId: string,
  contactId: string,
  threadId: string,
  text: string,
  delayAfterAutoReplies: number = 0,
  autoRepliesWereSent: boolean = false,
  aiReplyDedupeKey?: string,
) {
  const { data: thread } = await supabaseAdmin
    .from('threads')
    .select('ai_enabled, assigned_to_user_id')
    .eq('id', threadId)
    .maybeSingle();

  // Si el cliente vuelve a escribir y no hay humano asignado, reactivar IA.
  // Borrar el chat en WhatsApp NO limpia el CRM: el hilo quedaba ai_enabled=false.
  if ((thread as unknown as { ai_enabled?: boolean })?.ai_enabled === false) {
    const assigned = (thread as unknown as { assigned_to_user_id?: string | null })?.assigned_to_user_id
    if (assigned) {
      console.info('[ai-reply] skip: IA off y hay humano asignado', { threadId, assigned })
      return
    }
    try {
      await supabaseAdmin
        .from('threads')
        .update({ ai_enabled: true } as unknown as Record<string, never>)
        .eq('id', threadId)
        .eq('org_id', orgId)
      console.info('[ai-reply] IA reactivada: cliente escribió de nuevo sin asesor asignado', {
        orgId,
        threadId,
        chatId,
      })
    } catch (reErr) {
      console.warn('[ai-reply] no se pudo reactivar IA:', (reErr as Error)?.message)
      return
    }
  }

  // Wait for all auto-reply steps to finish sending before AI enters
  // NOTE: auto-replies already awaited their steps synchronously, so NO extra delay needed here.
  // The autoRepliesWereSent flag is enough to signal contextual-entry mode.

  const scheduleAt = delayAfterAutoReplies > 0
    ? new Date(Date.now() + (delayAfterAutoReplies + 2) * 1000).toISOString()
    : null;

  let { data: cfg } = await supabaseAdmin
    .from('ai_configs')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle()

  if (!cfg) {
    try {
      const { cloneTemplateAiConfigToOrg } = await import('@/lib/org-helpers')
      await cloneTemplateAiConfigToOrg(orgId)
      const { data: newCfg } = await supabaseAdmin
        .from('ai_configs')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle()
      cfg = newCfg
    } catch (cloneErr: any) {
      console.error('[ingest] Failed to clone AI config on-the-fly:', cloneErr.message)
    }
  }

  if (!cfg || !cfg.enabled) return

  if (cfg.respond_to === 'new') {
    const { count } = await supabaseAdmin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', threadId)
      .eq('direction', 'out')
    if ((count ?? 0) > 0) return
  }

  const history = await loadThreadHistory(orgId, threadId, text)

  let historyWithContext = history
  if (autoRepliesWereSent) {
    const systemNote = {
      role: 'system' as const,
      content:
        'Acaban de enviarse mensajes automáticos al cliente. Continúa de forma natural, sin presentarte de nuevo y sin repetir lo ya dicho. Responde breve y haz máximo una pregunta.',
    }
    historyWithContext = [...history, systemNote]
  }

  let runAiAgent: any = null
  let cfgFast: Record<string, unknown> | null = null
  let provider = 'lovable'

  try {
    const importedAi = await import('@/lib/ai.server')
    runAiAgent = importedAi.runAiAgent
    cfgFast = { ...(cfg as Record<string, unknown>) }
    provider = (cfgFast.selected_provider as string) || (cfgFast.provider as string) || 'lovable'
    if (provider === 'lovable' && (!cfgFast.model || String(cfgFast.model).startsWith('gpt-'))) {
      cfgFast.model = 'google/gemini-3-flash-preview'
    }

    console.info('[ai-reply] starting', {
      orgId,
      threadId,
      chatId,
      provider,
      model: cfgFast.model,
      respond_to: cfgFast.respond_to,
      hasVertexSecret: !!cfgFast.vertex_service_account_json,
      historyLength: historyWithContext.length,
    })

    const firstAttempt = await runAiAgent({
      orgId,
      threadId,
      contactId,
      sessionId,
      chatId,
      messages: historyWithContext,
      cfg: cfgFast,
    })

    let actions = firstAttempt.actions ?? []
    let finalReply = stripLeakedToolMarkup(firstAttempt.reply?.trim() || '')

    // Si la IA activó un PAQUETE (flujo), el propio flujo envía el contenido en
    // orden. No mandamos una respuesta de texto de la IA para no duplicar ni
    // pisar ese contenido; la IA queda igual atendiendo dudas en los siguientes turnos.
    const activatedFlow = actions?.includes('activate_flow')

    if (!activatedFlow) {
      if (!finalReply) {
        const sentImage = actions?.includes('send_product_image') || actions?.includes('send_product_video')
        if (sentImage) {
          finalReply = '¿Cuál te gusta más? Cuéntame y avanzamos con tu pedido.'
        } else {
          // No inventar texto vacío: evita spam "[mensaje vacío]" / fillers en bucle.
          console.info('[ai-reply] sin texto útil; no se encola SEND_MESSAGE', {
            orgId,
            threadId,
            chatId,
            actions,
          })
          return
        }
      }

      // Si quedó basura de tools o activadores sin sentido, no enviar
      if (/activate_flow|present_product|<\/?function/i.test(finalReply)) {
        console.warn('[ai-reply] reply todavía contiene markup de tools; se omite envío', {
          orgId,
          threadId,
          preview: finalReply.slice(0, 120),
        })
        return
      }

      console.info('[ai-reply] finalReply', {
        orgId,
        threadId,
        chatId,
        sessionId,
        finalReply,
        actions,
        replyLength: finalReply.length,
      })

      let skipQueue = false
      if (aiReplyDedupeKey) {
        const duplicateReply = await hasExistingAiReplyCommand(orgId, sessionId, aiReplyDedupeKey)
        if (duplicateReply) {
          console.log('[ai-reply] skip duplicate queued reply by dedupeKey', { threadId, chatId, aiReplyDedupeKey })
          skipQueue = true
        }
      }

      if (!skipQueue) {
        const dupSameText = await hasRecentQueuedReply(orgId, sessionId, chatId, finalReply, 90_000)
        if (dupSameText) {
          console.log('[ai-reply] skip duplicate same text queued recently', { threadId, chatId })
          skipQueue = true
        }
      }

      if (!skipQueue) {
        await supabaseAdmin.from('engine_commands').insert({
          org_id: orgId,
          session_id: sessionId,
          type: 'SEND_MESSAGE',
          payload: { chatId, text: finalReply, dedupeKey: aiReplyDedupeKey },
          status: 'pending',
          scheduled_for: scheduleAt,
        })
      }
    } else {
      console.info('[ai-reply] paquete activado por la IA; se omite respuesta de texto', {
        orgId,
        threadId,
        chatId,
        actions,
      })
      // Garantizar IA ON: a veces el modelo llama transfer_to_human en el mismo
      // turno y deja el toggle apagado aunque el flujo diga "Activar IA".
      try {
        await supabaseAdmin
          .from('threads')
          .update({ ai_enabled: true } as unknown as Record<string, never>)
          .eq('id', threadId)
          .eq('org_id', orgId)
        console.info('[ai-reply] IA forzada ON tras activate_flow', { threadId, orgId })
      } catch (reOnErr) {
        console.warn('[ai-reply] no se pudo forzar IA ON tras flujo:', (reOnErr as Error)?.message)
      }
    }

    // === APRENDIZAJE: la IA "aprende" de este contacto a medida que atiende ===
    // Extraccion por reglas (regex), sin llamadas extra al LLM (cero tokens).
    // Se guarda en contacts.ai_memory (1 registro por contacto, se ACTUALIZA en
    // sitio: no crea filas nuevas ni infla el almacenamiento). Best-effort.
    if (process.env.DISABLE_AI_MEMORY !== 'true' && contactId) {
      try {
        const currentMemory = await loadCustomerMemory(orgId, contactId)
        await extractAndSaveMemory({
          orgId,
          contactId,
          userText: text,
          assistantReply: finalReply,
          actions,
          currentMemory,
          cfg: cfgFast,
        })
      } catch (memErr) {
        console.warn('[ai-reply] extractAndSaveMemory failed (ignorado)', {
          message: memErr instanceof Error ? memErr.message : String(memErr),
          orgId,
          threadId,
          contactId,
        })
      }
    }
  } catch (err) {
    let errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : '';
    console.warn('[ai-reply] first attempt failed', {
      message: errMsg,
      orgId,
      threadId,
      chatId,
      provider,
      model: cfgFast?.model,
      selected_provider: cfg?.selected_provider,
    });

    console.error('[ai-reply] error - DETALLES COMPLETOS:', {
      message: errMsg,
      stack: errStack?.slice(0, 500),
      orgId,
      threadId,
      chatId,
      provider: cfg?.provider,
      model: cfg?.model,
      selected_provider: cfg?.selected_provider,
      hasVertexKey: !!cfg?.vertex_service_account_json,
    });
    
    // Registrar la solicitud fallida para reintento automático después de 3 minutos
    const requestId = await registerFailedAiRequest(
      orgId,
      threadId,
      chatId,
      sessionId,
      text,
      errMsg,
      0,
      3,
      {
        messageHistory: historyWithContext,
        cfgProvider: cfg?.selected_provider || cfg?.provider,
        cfgModel: cfg?.model,
      }
    );

    // Enviar mensaje de apoyo (widget/notificación para el agente)
    if (requestId && sessionId) {
      await sendSupportMessage(orgId, sessionId, chatId, requestId, threadId);
    }

    // Antes: un error de IA apagaba el hilo para siempre (aunque el cliente
    // borrara el chat y volviera a escribir). Solo handoff si se pide explícito.
    if (process.env.ENABLE_AI_HANDOFF_ON_ERROR === 'true') {
      try {
        await supabaseAdmin
          .from('threads')
          .update({ ai_enabled: false } as unknown as Record<string, never>)
          .eq('id', threadId)
          .eq('org_id', orgId)
        console.info('[ai-reply] IA no pudo responder: conversación transferida a humano (ai_enabled=false)', {
          orgId,
          threadId,
          chatId,
        })
      } catch (handoffErr) {
        console.warn('[ai-reply] no se pudo transferir a humano (ai_enabled puede no existir):', (handoffErr as Error)?.message)
      }
    } else {
      console.warn('[ai-reply] error de IA; hilo sigue con IA activa (sin handoff automático)', {
        orgId,
        threadId,
        chatId,
      })
    }
  }
}

export const Route = createFileRoute('/api/public/engine/ingest')({

  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const token = request.headers.get('x-session-token')
        if (!token) return json(401, { error: 'Missing session token' })

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json(400, { error: 'Invalid JSON' })
        }
        let events: any[] = []
        if (body && typeof body === 'object' && 'eventId' in body) {
          const v2 = body as any
          const direction = v2.direction === 'OUTGOING' ? 'out' : 'in'
          const type = direction === 'out' ? 'message-out' : 'message-in'
          
          events = [{
            type,
            chatId: v2.chat?.whatsappId,
            waMessageId: v2.eventId,
            direction,
            text: v2.content?.body,
            sentAt: v2.timestamp,
            contact: v2.contact ? {
              waId: v2.contact.whatsappId,
              displayName: v2.contact.pushName,
              phone: v2.contact.phoneNumber,
            } : undefined,
            media: v2.content?.media ? {
              base64: v2.content.media.base64Data,
              filename: v2.content.media.fileName,
              mimetype: v2.content.media.mimeType,
              type: v2.content.type,
            } : undefined,
            raw: v2,
          }]
        } else {
          const parsed = PayloadSchema.safeParse(body)
          if (!parsed.success) return json(400, { error: 'Invalid payload', issues: parsed.error.issues })
          events = parsed.data.events
        }

        const { data: session, error: sErr } = await supabaseAdmin
          .from('wa_sessions')
          .select('id, org_id, me_wa_id, phone_number, default_agent_id, default_flow_id')
          .eq('session_token', token)
          .maybeSingle()
        if (sErr || !session) return json(401, { error: 'Invalid session token' })

        // Extract telemetry from the first heartbeat/session_ready event
        const telemetryEvent = events.find(
          (ev) => ev.type === 'HEARTBEAT' || ev.type === 'SESSION_READY',
        )
        const telemetry = telemetryEvent ? extractSessionTelemetry(telemetryEvent) : null
        await supabaseAdmin
          .from('wa_sessions')
          .update({
            status: 'connected',
            last_heartbeat_at: new Date().toISOString(),
            last_sync_at: new Date().toISOString(),
            ...(telemetry?.phoneNumber ? { phone_number: telemetry.phoneNumber } : {}),
            ...(telemetry?.deviceName ? { device_name: telemetry.deviceName } : {}),
            ...(telemetry?.batteryLevel != null ? { battery_level: telemetry.batteryLevel } : {}),
            ...(telemetry?.platform ? { platform: telemetry.platform } : {}),
          })
          .eq('id', session.id)

        const meWaId = session.me_wa_id ?? null
        const normalized = events.map((ev) => normalizeEvent(ev, meWaId))

        // Claves para Whisper (Groq preferido, OpenAI de respaldo). undefined = aún no consultada.
        let transcriptionKeysCache:
          | { groq: string | null; openai: string | null }
          | undefined = undefined
        const getTranscriptionKeys = async (): Promise<{
          groq: string | null
          openai: string | null
        }> => {
          if (transcriptionKeysCache !== undefined) return transcriptionKeysCache
          try {
            const { data } = await supabaseAdmin
              .from('ai_configs')
              .select('grok_api_key, openai_api_key')
              .eq('org_id', session.org_id)
              .maybeSingle()
            transcriptionKeysCache = {
              groq:
                ((data as any)?.grok_api_key as string) ||
                process.env.GROQ_API_KEY ||
                null,
              openai:
                ((data as any)?.openai_api_key as string) ||
                process.env.OPENAI_API_KEY ||
                null,
            }
          } catch {
            transcriptionKeysCache = {
              groq: process.env.GROQ_API_KEY || null,
              openai: process.env.OPENAI_API_KEY || null,
            }
          }
          return transcriptionKeysCache
        }

        for (const e of normalized) {
          try {
            if ((e.type === 'message-in' || e.type === 'message-out') && (e.waMessageId || e.chatId || e.text)) {
              const dedupKey = buildInboundDedupKey({
                sessionId: session.id,
                chatId: e.chatId,
                waMessageId: e.waMessageId,
                direction: e.direction,
                text: e.text,
                sentAt: e.sentAt,
                waId: e.contact?.waId,
              })
              const isMediaRecovery = !!(e as { mediaRecovery?: boolean }).mediaRecovery
              if (!isMediaRecovery && !inboundEventDedupe.shouldProcess(dedupKey)) {
                console.log('[ingest] skip duplicate event', { dedupKey, type: e.type, chatId: e.chatId })
                continue
              }
            }

            const waId = e.contact?.waId ?? normalizeWaKey(e.chatId)
            if (!waId) continue

            let contactId: string | null = null
            let phone = sanitizeContactPhone(e.contact?.phone ?? null, waId)

            // Extraer número de teléfono del waId (solo JID normal, NUNCA LID)
            const userPart = waId.split('@')[0];
            const cleanPhone = userPart.replace(/\D/g, '');

            if (!phone && cleanPhone && !waId.endsWith('@g.us') && !isLidKey(waId)) {
              phone = sanitizeContactPhone(cleanPhone, waId);
            }

            if (!phone && isLidKey(waId)) {
              const resolved = await resolvePhoneForLidMessage({
                orgId: session.org_id,
                sessionId: session.id,
                waId,
                text: e.text,
                sentAt: e.sentAt,
              })
              contactId = resolved.contactId
              phone = sanitizeContactPhone(resolved.phone, waId)
            }

            // Si el contacto LID ya existe con phone=LID (dato basura), limpiarlo
            if (isLidKey(waId)) {
              const { data: dirtyLid } = await supabaseAdmin
                .from('contacts')
                .select('id, phone')
                .eq('org_id', session.org_id)
                .eq('wa_id', waId)
                .maybeSingle()
              if (dirtyLid?.phone && sanitizeContactPhone(dirtyLid.phone, waId) == null) {
                await supabaseAdmin
                  .from('contacts')
                  .update({ phone: null } as any)
                  .eq('id', dirtyLid.id)
                console.info('[ingest] phone=LID limpiado del contacto', { contactId: dirtyLid.id, waId })
              }
            }

            if (phone) {
              const { data: byPhone } = await supabaseAdmin
                .from('contacts')
                .select('id, wa_id, display_name')
                .eq('org_id', session.org_id)
                .eq('phone', phone)
                .maybeSingle()
              if (byPhone) {
                contactId = byPhone.id
                
                const currentIsAnonymous = !byPhone.display_name || 
                  byPhone.display_name.startsWith('Cliente') || 
                  byPhone.display_name.toLowerCase() === 'unknown' ||
                  byPhone.display_name === phone;
                  
                const hasNewRealName = e.contact?.displayName && 
                  !e.contact.displayName.startsWith('Cliente') && 
                  e.contact.displayName.toLowerCase() !== 'unknown' &&
                  e.contact.displayName !== phone;

                if (byPhone.wa_id !== waId || (currentIsAnonymous && hasNewRealName)) {
                  await supabaseAdmin
                    .from('contacts')
                    .update({
                      wa_id: waId,
                      display_name: hasNewRealName ? e.contact.displayName : (byPhone.display_name ?? phone),
                      phone,
                      profile_picture_url: e.contact?.profilePictureUrl,
                    })
                    .eq('id', byPhone.id)
                }
              }
            }

            if (!contactId) {
              const { data: byWa } = await supabaseAdmin
                .from('contacts')
                .select('id')
                .eq('org_id', session.org_id)
                .eq('wa_id', waId)
                .maybeSingle()
              contactId = byWa?.id ?? null
            }

            if (!contactId) {
              const shouldCreateContact = canCreateContactRecord({
                waId,
                phone,
                displayName: e.contact?.displayName ?? null,
              })

              if (shouldCreateContact) {
                const { data: newContact } = await supabaseAdmin
                  .from('contacts')
                  .upsert(
                    {
                      org_id: session.org_id,
                      wa_id: waId,
                      display_name: e.contact?.displayName ?? phone ?? undefined,
                      phone,
                      profile_picture_url: e.contact?.profilePictureUrl,
                    },
                    { onConflict: 'org_id,wa_id' },
                  )
                  .select('id')
                  .single()
                contactId = newContact?.id ?? null
              }
            }

            if (contactId) {
              const { data: cont } = await supabaseAdmin
                .from('contacts')
                .select('display_name, wa_id')
                .eq('id', contactId)
                .maybeSingle()
              if (cont) {
                const currentIsAnonymous = !cont.display_name || 
                  cont.display_name.startsWith('Cliente') || 
                  cont.display_name.toLowerCase() === 'unknown' ||
                  cont.display_name === phone ||
                  cont.display_name === waId.replace(/@lid$/, '');
                  
                const hasNewRealName = e.contact?.displayName && 
                  !e.contact.displayName.startsWith('Cliente') && 
                  e.contact.displayName.toLowerCase() !== 'unknown' &&
                  e.contact.displayName !== phone &&
                  e.contact.displayName !== waId.replace(/@lid$/, '');

                if (currentIsAnonymous && hasNewRealName) {
                  await supabaseAdmin
                    .from('contacts')
                    .update({
                      display_name: e.contact.displayName,
                      profile_picture_url: e.contact?.profilePictureUrl,
                    })
                    .eq('id', contactId)
                }
              }
            }

            if (!contactId) continue

            const { data: thread } = await supabaseAdmin
              .from('threads')
              .upsert(
                {
                  org_id: session.org_id,
                  session_id: session.id,
                  contact_id: contactId,
                  last_message_at: e.sentAt ?? new Date().toISOString(),
                  assigned_to_user_id: session.default_agent_id ?? null,
                },
                { onConflict: 'session_id,contact_id' },
              )
              .select('id, focused_product_id')
              .single()
            if (!thread) continue

            // Auto-enroll in default flow for new contacts on this session
            if (session.default_flow_id) {
              try {
                const { data: firstStep } = await dyn()
                  .from('flow_steps')
                  .select('id')
                  .eq('flow_id', session.default_flow_id)
                  .is('parent_step_id', null)
                  .order('step_order', { ascending: true })
                  .limit(1)
                  .maybeSingle();
                if (firstStep) {
                  await dyn()
                    .from('flow_runs')
                    .upsert({
                      org_id: session.org_id,
                      flow_id: session.default_flow_id,
                      contact_id: contactId,
                      current_step_id: firstStep.id,
                      status: 'active',
                      next_execution_at: new Date().toISOString(),
                      last_interaction_at: new Date().toISOString(),
                    }, { onConflict: 'flow_id,contact_id' })
                    .select()
                    .single();
                }
              } catch (flowErr: any) {
                console.error('[ingest] default flow enrollment error (non-fatal):', flowErr.message);
              }
            }
            // DIAGNÓSTICO: Loguear estructura completa del media para mensajes entrantes
            if (e.media && (e.direction === 'in' || e.type === 'message-in')) {
              const mediaKeys = Object.keys(e.media as object);
              const mediaSample = {
                keys: mediaKeys,
                hasBase64: !!(e.media as any).base64,
                base64Len: ((e.media as any).base64 || '').length,
                hasBody: !!(e.media as any).body,
                bodyLen: ((e.media as any).body || '').length,
                hasData: !!(e.media as any).data,
                hasUrl: !!(e.media as any).url,
                hasMediaUrl: !!(e.media as any).mediaUrl,
                mimetype: (e.media as any).mimetype,
                type: (e.media as any).type,
              };
              console.log('[ingest] 🔍 RAW MEDIA INCOMING:', JSON.stringify(mediaSample));
            }

            const enrichedMedia = await enrichMediaForMessage(
              e.media as Record<string, unknown> | undefined,
              session.org_id,
            )

            if (e.media && !enrichedMedia) {
              console.warn('[ingest] ⚠️ Media PERDIDA en enrichMediaForMessage. Input:', {
                mediaType: (e.media as any)?.type,
                hasBase64: !!(e.media as any)?.base64,
                base64Len: ((e.media as any)?.base64 || '').length,
              });
            }

            if (!enrichedMedia && e.media) {
              console.log('[ingest] ℹ️ No enrichedMedia pero sí hay media objeto:', {
                waMessageId: e.waMessageId,
                textLen: e.text?.length,
              });
            }

            // === AUDIOS: transcribir notas de voz entrantes para que la IA las entienda ===
            // Whisper (Groq → OpenAI). El texto queda en `e.text` como si el cliente escribiera.
            // Si no se puede transcribir, igual disparamos la IA con un prompt de respaldo
            // (sin guardar texto falso en el mensaje).
            const incomingDirection = e.direction ?? (e.type === 'message-in' ? 'in' : 'out')
            let audioAiFallbackText: string | null = null
            {
              const mt = String(
                (enrichedMedia as any)?.mimeType || (enrichedMedia as any)?.mime_type || '',
              ).toLowerCase()
              const rawType = String(
                (e.media as any)?.type || (enrichedMedia as any)?.type || '',
              ).toLowerCase()
              const isAudio =
                mt.startsWith('audio/') || rawType === 'ptt' || rawType === 'audio'
              const audioUrl =
                enrichedMedia && typeof (enrichedMedia as any).url === 'string'
                  ? ((enrichedMedia as any).url as string)
                  : null

              if (
                process.env.DISABLE_AUDIO_TRANSCRIPTION !== 'true' &&
                incomingDirection === 'in' &&
                !e.text?.trim() &&
                isAudio
              ) {
                if (audioUrl) {
                  try {
                    const keys = await getTranscriptionKeys()
                    if (!keys.groq && !keys.openai) {
                      console.warn(
                        '[ingest] 🎤 sin grok_api_key/GROQ_API_KEY ni openai_api_key para transcribir audio',
                      )
                      audioAiFallbackText =
                        'El cliente envió una nota de voz. No pude escucharla porque no hay API de transcripción configurada. Responde amablemente pidiendo que escriba lo que necesita.'
                    } else {
                      const { text: transcript, provider } = await transcribeInboundAudio(
                        audioUrl,
                        keys,
                        {
                          mimeType:
                            (enrichedMedia as any).mimeType ||
                            (enrichedMedia as any).mime_type ||
                            undefined,
                        },
                      )
                      if (transcript?.trim()) {
                        e.text = transcript.trim()
                        console.log('[ingest] 🎤 audio transcrito', {
                          threadId: thread.id,
                          waMessageId: e.waMessageId,
                          length: e.text.length,
                          provider,
                        })
                        await deleteCloudMediaFile(enrichedMedia as Record<string, unknown>)
                        Object.assign(
                          enrichedMedia as object,
                          toLocalOnlyMediaMeta(enrichedMedia as Record<string, unknown>, {
                            transcribed: true,
                          }),
                        )
                      } else {
                        console.log('[ingest] 🎤 audio sin transcripción utilizable', {
                          waMessageId: e.waMessageId,
                          provider,
                        })
                        audioAiFallbackText =
                          'El cliente envió una nota de voz que no pude entender. Responde amablemente pidiendo que escriba lo que necesita en un mensaje de texto.'
                        await deleteCloudMediaFile(enrichedMedia as Record<string, unknown>)
                        Object.assign(
                          enrichedMedia as object,
                          toLocalOnlyMediaMeta(enrichedMedia as Record<string, unknown>, {
                            transcribed: false,
                          }),
                        )
                      }
                    }
                  } catch (err) {
                    console.warn(
                      '[ingest] 🎤 transcripción de audio falló:',
                      (err as Error)?.message,
                    )
                    audioAiFallbackText =
                      'El cliente envió una nota de voz que no pude escuchar. Responde amablemente pidiendo que escriba lo que necesita.'
                  }
                } else {
                  console.warn('[ingest] 🎤 audio entrante sin URL/base64 — no se puede transcribir', {
                    waMessageId: e.waMessageId,
                    hasMedia: !!e.media,
                    localOnly: !!(enrichedMedia as any)?.localOnly,
                    missing: !!(enrichedMedia as any)?.missing_media,
                  })
                  // Solo pedir texto si ya no esperamos mediaRecovery (sin missing_media)
                  if (!(enrichedMedia as any)?.missing_media) {
                    audioAiFallbackText =
                      'El cliente envió una nota de voz que no pude recibir. Responde amablemente pidiendo que escriba lo que necesita.'
                  }
                }
              }
            }

            const direction = e.direction ?? (e.type === 'message-in' ? 'in' : 'out')
            if (direction === 'out') {
              let recentOut = null;

              // 1. Intentar buscar por commandId si la extensión lo envió
              if (e.commandId) {
                const { data } = await supabaseAdmin
                  .from('messages')
                  .select('id, wa_message_id, media')
                  .eq('wa_message_id', `pending-${e.commandId}`)
                  .maybeSingle();
                recentOut = data;
              }

              // 2. Si no hay commandId, buscar el mensaje pendiente más reciente que coincida
              if (!recentOut) {
                let pendingQuery = supabaseAdmin
                  .from('messages')
                  .select('id, wa_message_id, media')
                  .eq('thread_id', thread.id)
                  .eq('direction', 'out')
                  .like('wa_message_id', 'pending-%')
                  .order('sent_at', { ascending: false })
                  .limit(1);

                if (e.text) {
                  pendingQuery = pendingQuery.eq('text', e.text);
                }
                if (e.media) {
                  pendingQuery = pendingQuery.not('media', 'is', null);
                }
                const { data } = await pendingQuery.maybeSingle();
                recentOut = data;
              }

              // 3. Fallback: buscar el último mensaje saliente (para evitar duplicados si ya no dice pending-)
              if (!recentOut) {
                const since = new Date(Date.now() - 120_000).toISOString();
                let query = supabaseAdmin
                  .from('messages')
                  .select('id, wa_message_id, media')
                  .eq('thread_id', thread.id)
                  .eq('direction', 'out')
                  .gte('sent_at', since)
                  .order('sent_at', { ascending: false })
                  .limit(1);

                if (e.text) query = query.eq('text', e.text);
                if (e.media) query = query.not('media', 'is', null);

                const { data } = await query.maybeSingle();
                recentOut = data;
              }

              if (recentOut?.wa_message_id?.startsWith('pending-')) {
                // El mensaje pendiente fue creado por el CRM, lo que significa que el CRM ya subió el archivo a Storage.
                // La extensión no tiene el archivo (sin base64), así que simplemente ignoramos el media de la extensión
                // y conservamos intacto el media original que ya tiene la URL.
                let finalMedia = recentOut.media;
                
                // Por si acaso la base de datos lo devuelve como string
                if (typeof finalMedia === 'string') {
                  try { finalMedia = JSON.parse(finalMedia); } catch {}
                }

                // Si por alguna razón el original no tiene URL, pero el nuevo sí (muy raro en salidas), lo usamos
                const parsedNewMedia = enrichedMedia as any;
                if (!finalMedia?.url && parsedNewMedia?.url) {
                  finalMedia = parsedNewMedia;
                }

                await supabaseAdmin
                  .from('messages')
                  .update({
                    wa_message_id: e.waMessageId ?? recentOut.wa_message_id,
                    media: finalMedia,
                  })
                  .eq('id', recentOut.id)
                continue
              }
              if (recentOut && e.waMessageId && recentOut.wa_message_id === e.waMessageId) {
                continue
              }

              if (e.direction === 'out' && e.sentAt) {
                const duplicateOutgoing = await hasDuplicateOutgoingMessage(thread.id, e.text, enrichedMedia as Record<string, unknown> | undefined, e.sentAt)
                if (duplicateOutgoing) {
                  console.log('[ingest] skip duplicate outgoing message by sentAt/text/media match', {
                    threadId: thread.id,
                    waMessageId: e.waMessageId,
                    sentAt: e.sentAt,
                    text: e.text,
                  })
                  continue
                }
              }
            }

            // Evitar violaciones de clave única si el mensaje ya existe (ej. detectado primero por DOM-detector y luego procesado con media por el EventEngine)
            let existingMessage = null;
            if (e.waMessageId) {
              const { data } = await supabaseAdmin
                .from('messages')
                .select('id, media, text')
                .eq('thread_id', thread.id)
                .eq('wa_message_id', e.waMessageId)
                .maybeSingle();
              existingMessage = data;
            }

            if (existingMessage) {
              let existingMediaObj = existingMessage.media as any;
              if (typeof existingMediaObj === 'string') {
                try { existingMediaObj = JSON.parse(existingMediaObj); } catch {}
              }
              const existingMissing = !existingMediaObj || !existingMediaObj.url || existingMediaObj.missing_media;
              const newHasUrl = enrichedMedia && !!enrichedMedia.url;
              const newHasLocalOnly = !!(enrichedMedia && (enrichedMedia as any).localOnly);
              const previousText = String(existingMessage.text ?? '').trim();
              const gotNewTranscript = !!(e.text?.trim() && !previousText);
              const textForAi = (e.text?.trim() || audioAiFallbackText || '').trim();
              const shouldFireAudioAi =
                !!textForAi &&
                !previousText &&
                (gotNewTranscript || !!audioAiFallbackText) &&
                (e.direction ?? (e.type === 'message-in' ? 'in' : 'out')) === 'in';

              if (existingMissing && (newHasUrl || newHasLocalOnly || gotNewTranscript || !!audioAiFallbackText)) {
                console.log('[ingest] Actualizando mensaje existente con media recuperada:', e.waMessageId);
                await supabaseAdmin
                  .from('messages')
                  .update({
                    media: (enrichedMedia || existingMediaObj) as any,
                    text: e.text ?? existingMessage.text,
                  })
                  .eq('id', existingMessage.id);

                // Audio transcrito (o fallback) tarde: disparar IA
                if (shouldFireAudioAi) {
                  const sendChatId = e.contact?.phone
                    ? `${e.contact.phone}@c.us`
                    : /^\d+$/.test(waId)
                      ? `${waId}@c.us`
                      : e.chatId
                  const audioGuard = await shouldSkipAutomation({
                    orgId: session.org_id,
                    sessionId: session.id,
                    threadId: thread.id,
                    chatId: sendChatId || e.chatId || '',
                    text: textForAi,
                    meWaId: session.me_wa_id,
                    phoneNumber: (session as any).phone_number,
                    direction: 'in',
                  })
                  if (audioGuard.skip) {
                    console.warn('[ingest] skip audio automation', { reason: audioGuard.reason, threadId: thread.id })
                  } else {
                  try {
                    await supabaseAdmin
                      .from('no_response_pending')
                      .update({ cancelled_at: new Date().toISOString() })
                      .eq('thread_id', thread.id)
                      .is('fired_at', null)
                      .is('cancelled_at', null)
                  } catch (_) { /* ignore */ }

                  const { aiDisabled, totalDelaySec } = await maybeAutoReply(
                    session.org_id,
                    session.id,
                    sendChatId,
                    textForAi,
                    thread.id,
                    contactId,
                  )
                  if (!aiDisabled) {
                    const autoRepliesWereSent = totalDelaySec > 0
                    const aiReplyDedupKey = buildAiReplyDedupKey({
                      sessionId: session.id,
                      threadId: thread.id,
                      text: textForAi,
                      waMessageId: e.waMessageId,
                      sentAt: e.sentAt,
                      chatId: sendChatId,
                    })
                    const alreadyQueued = await hasExistingAiReplyCommand(
                      session.org_id,
                      session.id,
                      aiReplyDedupKey,
                    )
                    if (!alreadyQueued && aiReplyDedupe.shouldProcess(aiReplyDedupKey)) {
                      console.log('[ingest] 🎤 IA disparada tras audio', {
                        waMessageId: e.waMessageId,
                        threadId: thread.id,
                        transcribed: gotNewTranscript,
                      })
                      if (process.env.ASYNC_AI_REPLY === 'true') {
                        maybeAiReply(
                          session.org_id,
                          session.id,
                          sendChatId,
                          contactId,
                          thread.id,
                          textForAi,
                          totalDelaySec,
                          autoRepliesWereSent,
                          aiReplyDedupKey,
                        ).catch((err) => {
                          console.error('[ingest] Error en maybeAiReply post-transcripción:', err)
                        })
                      } else {
                        await maybeAiReply(
                          session.org_id,
                          session.id,
                          sendChatId,
                          contactId,
                          thread.id,
                          textForAi,
                          totalDelaySec,
                          autoRepliesWereSent,
                          aiReplyDedupKey,
                        )
                      }
                    }
                  }
                  }
                }
              } else if (gotNewTranscript || (shouldFireAudioAi && !!audioAiFallbackText)) {
                if (gotNewTranscript) {
                  console.log('[ingest] Actualizando texto transcrito de audio:', e.waMessageId);
                  await supabaseAdmin
                    .from('messages')
                    .update({
                      text: e.text,
                      ...(enrichedMedia ? { media: enrichedMedia as any } : {}),
                    })
                    .eq('id', existingMessage.id);
                }

                if (shouldFireAudioAi) {
                  const sendChatId = e.contact?.phone
                    ? `${e.contact.phone}@c.us`
                    : /^\d+$/.test(waId)
                      ? `${waId}@c.us`
                      : e.chatId
                  const audioGuard2 = await shouldSkipAutomation({
                    orgId: session.org_id,
                    sessionId: session.id,
                    threadId: thread.id,
                    chatId: sendChatId || e.chatId || '',
                    text: textForAi,
                    meWaId: session.me_wa_id,
                    phoneNumber: (session as any).phone_number,
                    direction: 'in',
                  })
                  if (audioGuard2.skip) {
                    console.warn('[ingest] skip audio automation', { reason: audioGuard2.reason, threadId: thread.id })
                  } else {
                  const { aiDisabled, totalDelaySec } = await maybeAutoReply(
                    session.org_id,
                    session.id,
                    sendChatId,
                    textForAi,
                    thread.id,
                    contactId,
                  )
                  if (!aiDisabled) {
                    const aiReplyDedupKey = buildAiReplyDedupKey({
                      sessionId: session.id,
                      threadId: thread.id,
                      text: textForAi,
                      waMessageId: e.waMessageId,
                      sentAt: e.sentAt,
                      chatId: sendChatId,
                    })
                    if (
                      !(await hasExistingAiReplyCommand(session.org_id, session.id, aiReplyDedupKey)) &&
                      aiReplyDedupe.shouldProcess(aiReplyDedupKey)
                    ) {
                      const run = () =>
                        maybeAiReply(
                          session.org_id,
                          session.id,
                          sendChatId,
                          contactId,
                          thread.id,
                          textForAi,
                          totalDelaySec,
                          totalDelaySec > 0,
                          aiReplyDedupKey,
                        )
                      if (process.env.ASYNC_AI_REPLY === 'true') run().catch(console.error)
                      else await run()
                    }
                  }
                  }
                }
              } else {
                console.log('[ingest] Mensaje duplicado recibido, ignorando inserción:', e.waMessageId);
              }
              continue;
            }

            const messageDirection = e.direction ?? (e.type === 'message-in' ? 'in' : 'out')
            if (messageDirection === 'in' && e.sentAt) {
              const duplicateIncoming = await hasDuplicateIncomingMessage(
                thread.id,
                e.text,
                enrichedMedia as Record<string, unknown> | undefined,
                e.sentAt,
              )
              if (duplicateIncoming) {
                console.log('[ingest] skip duplicate incoming message by sentAt/text/media match', {
                  threadId: thread.id,
                  waMessageId: e.waMessageId,
                  sentAt: e.sentAt,
                  text: e.text,
                })
                continue
              }
            }

            // No guardar cáscaras vacías (eco MESSAGE_SENT de media sin texto → "[mensaje vacío]")
            if (!hasRenderableMessageContent(e.text, enrichedMedia as Record<string, unknown> | undefined)) {
              console.log('[ingest] skip empty message (sin texto ni media)', {
                threadId: thread.id,
                waMessageId: e.waMessageId,
                direction: messageDirection,
                type: e.type,
              })
              continue
            }

            await supabaseAdmin.from('messages').insert({
              org_id: session.org_id,
              thread_id: thread.id,
              wa_message_id: e.waMessageId ?? null,
              direction: e.direction ?? (e.type === 'message-in' ? 'in' : 'out'),
              text: e.text?.trim() ? e.text : null,
              media: enrichedMedia as any,
              // raw se deja vacio a proposito: el payload crudo ocupa mucho espacio,
              // nunca se lee para features y ya queda auditado en la tabla `events`.
              raw: null,
              sent_at: e.sentAt ?? new Date().toISOString(),
            })

            // Import historial: clasificar ficha sin responder ni iniciar flujos
            if (e.historical && e.historicalClassify && contactId) {
              try {
                let classifyText =
                  ((e.direction ?? (e.type === 'message-in' ? 'in' : 'out')) === 'in' && e.text?.trim()) ||
                  ''
                if (!classifyText) {
                  const { data: ins } = await supabaseAdmin
                    .from('messages')
                    .select('text')
                    .eq('thread_id', thread.id)
                    .eq('direction', 'in')
                    .not('text', 'is', null)
                    .order('sent_at', { ascending: true })
                    .limit(25)
                  classifyText = ((ins ?? []) as any[])
                    .map((m) => String(m.text || '').trim())
                    .filter(Boolean)
                    .join('\n')
                    .slice(0, 4000)
                }
                if (classifyText) {
                  const { applyEntrySegmentToContact } = await import('@/lib/ad-segments.server')
                  const { ensureContactTag } = await import('@/lib/contact-tag.server')
                  const { runIntentWatcher } = await import('@/lib/intent-watcher.server')
                  const firstLine = classifyText.split('\n').find((l) => l.trim()) || classifyText
                  const seg = await applyEntrySegmentToContact({
                    orgId: session.org_id,
                    contactId,
                    text: firstLine,
                  })
                  if (seg.applied && seg.segment) {
                    await ensureContactTag({
                      orgId: session.org_id,
                      contactId,
                      tagName: seg.segment.name,
                      color: '#a855f7',
                    })
                  }
                  const watch = await runIntentWatcher({
                    orgId: session.org_id,
                    contactId,
                    threadId: thread.id,
                    text: classifyText,
                    trigger: 'message',
                    skipFlowStart: true,
                  })
                  if (watch.intent_key) {
                    await ensureContactTag({
                      orgId: session.org_id,
                      contactId,
                      tagName: watch.intent_key,
                      color: '#0ea5e9',
                    })
                  }
                }
              } catch (histErr) {
                console.warn('[ingest] historical classify:', (histErr as Error)?.message)
              }
            }

            const textForAiInsert = (e.text?.trim() || audioAiFallbackText || '').trim()
            const inboundDir = (e.direction ?? (e.type === 'message-in' ? 'in' : 'out'))
            if (inboundDir === 'in' && textForAiInsert && !e.historical) {
              // Use phone@c.us when we have a real phone (avoids @lid issues)
              const sendChatId = e.contact?.phone
                ? `${e.contact.phone}@c.us`
                : /^\d+$/.test(waId)
                  ? `${waId}@c.us`
                  : e.chatId

              const guard = await shouldSkipAutomation({
                orgId: session.org_id,
                sessionId: session.id,
                threadId: thread.id,
                chatId: sendChatId || e.chatId || '',
                text: textForAiInsert,
                meWaId: session.me_wa_id,
                phoneNumber: (session as any).phone_number,
                direction: inboundDir,
              })
              if (guard.skip) {
                console.warn('[ingest] skip automation', {
                  reason: guard.reason,
                  threadId: thread.id,
                  chatId: sendChatId,
                  preview: textForAiInsert.slice(0, 80),
                })
                continue
              }

              if (e.text?.trim()) {
                try {
                  const { appendContactAskedQuestion } = await import('@/lib/contact-inquiry.server')
                  await appendContactAskedQuestion({
                    orgId: session.org_id,
                    contactId,
                    text: e.text,
                  })
                } catch (_) { /* ignore */ }
              }

              // Cancel any pending no-response timers for this thread (client responded)
              try {
                await supabaseAdmin
                  .from('no_response_pending')
                  .update({ cancelled_at: new Date().toISOString() })
                  .eq('thread_id', thread.id)
                  .is('fired_at', null)
                  .is('cancelled_at', null)
              } catch (_) { /* ignore */ }

              const { aiDisabled, totalDelaySec } = await maybeAutoReply(session.org_id, session.id, sendChatId, textForAiInsert, thread.id, contactId)
              if (!aiDisabled) {
                // auto-replies already ran synchronously above, so AI enters right after.
                // Pass autoRepliesWereSent so the AI uses contextual-entry mode.
                const autoRepliesWereSent = totalDelaySec > 0;
                const aiReplyDedupKey = buildAiReplyDedupKey({
                  sessionId: session.id,
                  threadId: thread.id,
                  text: textForAiInsert,
                  waMessageId: e.waMessageId,
                  sentAt: e.sentAt,
                  chatId: sendChatId,
                })
                const alreadyQueued = await hasExistingAiReplyCommand(session.org_id, session.id, aiReplyDedupKey)
                if (alreadyQueued) {
                  console.log('[ingest] skip duplicate AI reply by persisted command', { aiReplyDedupKey, threadId: thread.id, chatId: sendChatId })
                } else if (!aiReplyDedupe.shouldProcess(aiReplyDedupKey)) {
                  console.log('[ingest] skip duplicate AI reply', { aiReplyDedupKey, threadId: thread.id, chatId: sendChatId })
                } else if (process.env.ASYNC_AI_REPLY === 'true') {
                  // Asynchronous ejecución (optimizado)
                  console.log('[ingest] Despachando maybeAiReply en segundo plano (asíncrono)');
                  maybeAiReply(session.org_id, session.id, sendChatId, contactId, thread.id, textForAiInsert, totalDelaySec, autoRepliesWereSent, aiReplyDedupKey).catch((err) => {
                    console.error('[ingest] Error en maybeAiReply asíncrono:', err);
                  });
                } else {
                  // Fallback síncrono (reversión a comportamiento anterior)
                  console.log('[ingest] Ejecutando maybeAiReply de forma síncrona (rollback/legacy)');
                  await maybeAiReply(session.org_id, session.id, sendChatId, contactId, thread.id, textForAiInsert, totalDelaySec, autoRepliesWereSent, aiReplyDedupKey);
                }
              }

              // Vigilante: clasifica/etiqueta, pero NO arranca flujos si la IA está
              // activa (evita doble menú: IA activate_flow + vigilante a la vez).
              try {
                const { data: aiCfg } = await supabaseAdmin
                  .from('ai_configs')
                  .select('enabled')
                  .eq('org_id', session.org_id)
                  .maybeSingle()
                const { runIntentWatcher } = await import('@/lib/intent-watcher.server')
                void runIntentWatcher({
                  orgId: session.org_id,
                  contactId,
                  threadId: thread.id,
                  text: e.text || textForAiInsert,
                  trigger: 'message',
                  skipFlowStart: aiCfg?.enabled === true,
                }).catch((err) => {
                  console.warn('[ingest] watcher:', (err as Error)?.message)
                })
              } catch (_) { /* ignore */ }

              // Schedule no-response pending entries for active no_response rules
              try {
                const { data: noRespRules } = await supabaseAdmin
                  .from('auto_replies')
                  .select('id, no_response_delay_seconds, no_response_ai_scope, limit_per_contact')
                  .eq('org_id', session.org_id)
                  .eq('is_active', true)
                  .eq('trigger_type', 'no_response')
                for (const rule of noRespRules ?? []) {
                  const delaySeconds = rule.no_response_delay_seconds ?? 900
                  const firesAt = new Date(Date.now() + delaySeconds * 1000).toISOString()
                  // Check limit_per_contact
                  if (rule.limit_per_contact && rule.limit_per_contact > 0) {
                    const { count } = await supabaseAdmin
                      .from('no_response_pending')
                      .select('id', { count: 'exact', head: true })
                      .eq('rule_id', rule.id)
                      .eq('thread_id', thread.id)
                      .not('fired_at', 'is', null)
                    if ((count ?? 0) >= rule.limit_per_contact) continue
                  }
                  // Only insert if there isn't already a pending entry for this rule+thread
                  const { count: existing } = await supabaseAdmin
                    .from('no_response_pending')
                    .select('id', { count: 'exact', head: true })
                    .eq('rule_id', rule.id)
                    .eq('thread_id', thread.id)
                    .is('fired_at', null)
                    .is('cancelled_at', null)
                  if ((existing ?? 0) === 0) {
                    await supabaseAdmin.from('no_response_pending').insert({
                      org_id: session.org_id,
                      rule_id: rule.id,
                      thread_id: thread.id,
                      contact_id: contactId,
                      session_id: session.id,
                      chat_id: sendChatId,
                      fires_at: firesAt,
                    })
                  }
                }
              } catch (_) { /* ignore — don't break main flow */ }

              // Helper to start or restart a flow, respetando max_sends_per_contact.
              const ensureFlowRun = async (flowId: string, firstStepId: string, maxSends?: number | null) => {
                await ensureFlowRunForContact({
                  orgId: session.org_id,
                  contactId,
                  flowId,
                  firstStepId,
                  maxSends: maxSends ?? null,
                  processNow: true,
                });
              };

              // Keyword flow enrollment (wrapped to avoid breaking bridge on DB errors)
              try {
                const focusedProductId = (thread as any)?.focused_product_id
                  ? String((thread as any).focused_product_id)
                  : null;
                const { data: keywordFlows } = await dyn()
                  .from('flows')
                  .select('id, trigger_value, max_sends_per_contact, product_id')
                  .eq('org_id', session.org_id)
                  .eq('trigger_type', 'keyword')
                  .eq('is_active', true);
                for (const flow of keywordFlows ?? []) {
                  const flowPid = (flow as any).product_id
                    ? String((flow as any).product_id)
                    : null;
                  // Flujos de producto solo con ese producto en foco; generales solo sin foco
                  if (flowPid) {
                    if (focusedProductId !== flowPid) continue;
                  } else if (focusedProductId) {
                    continue;
                  }
                  const { data: firstStep } = await dyn()
                    .from('flow_steps')
                    .select('id')
                    .eq('flow_id', flow.id)
                    .is('parent_step_id', null)
                    .order('step_order', { ascending: true })
                    .limit(1)
                    .maybeSingle();
                  if (!firstStep) continue;
                  const lowerText = e.text.toLowerCase();
                  const triggerVal = (flow as any).trigger_value?.toLowerCase() ?? '';
                  if (triggerVal && lowerText.includes(triggerVal)) {
                    await ensureFlowRun(flow.id, firstStep.id, (flow as any).max_sends_per_contact);
                  }
                }

                const { count: inboundCount } = await dyn()
                  .from('messages')
                  .select('id', { count: 'exact', head: true })
                  .eq('thread_id', thread.id)
                  .eq('direction', 'in');
                const { count: outboundCount } = await dyn()
                  .from('messages')
                  .select('id', { count: 'exact', head: true })
                  .eq('thread_id', thread.id)
                  .eq('direction', 'out');

                const whatsappFlowTypes = [
                  { type: 'wa_new_message', shouldTrigger: true },
                  { type: 'wa_first_conversation', shouldTrigger: (inboundCount ?? 0) === 1 && (outboundCount ?? 0) === 0 },
                  { type: 'wa_customer_reply', shouldTrigger: (outboundCount ?? 0) > 0 },
                ];

                for (const trigger of whatsappFlowTypes) {
                  if (!trigger.shouldTrigger) continue;
                  const { data: flows } = await dyn()
                    .from('flows')
                    .select('id, max_sends_per_contact, product_id')
                    .eq('org_id', session.org_id)
                    .eq('trigger_type', trigger.type)
                    .eq('is_active', true);
                  for (const flow of flows ?? []) {
                    const flowPid = (flow as any).product_id
                      ? String((flow as any).product_id)
                      : null;
                    if (flowPid) {
                      if (focusedProductId !== flowPid) continue;
                    } else if (focusedProductId) {
                      continue;
                    }
                    const { data: firstStep } = await dyn()
                      .from('flow_steps')
                      .select('id')
                      .eq('flow_id', flow.id)
                      .is('parent_step_id', null)
                      .order('step_order', { ascending: true })
                      .limit(1)
                      .maybeSingle();
                    if (!firstStep) continue;
                    await ensureFlowRun(flow.id, firstStep.id, (flow as any).max_sends_per_contact);
                  }
                }

                // Update last_interaction_at for active/wait_node flow runs
                await dyn()
                  .from('flow_runs')
                  .update({ last_interaction_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                  .eq('contact_id', contactId)
                  .in('status', ['active', 'wait_node']);
              } catch (flowErr: any) {
                console.error('[ingest] flow error (non-fatal):', flowErr.message);
              }
            } else if (e.type === 'ack' && e.commandId) {
              const ackStatus = e.ackStatus ?? 'ok';
              const isFailed = ackStatus === 'failed' || ackStatus === 'error';
              const rawPayload = (e.raw as any) ?? {};
              const ackRecord: Record<string, any> = { status: ackStatus };
              if (rawPayload.error) ackRecord.error = String(rawPayload.error);
              if (rawPayload.result?.error) ackRecord.error = String(rawPayload.result.error);
              if (rawPayload.result?.messageId) ackRecord.messageId = rawPayload.result.messageId;
              await supabaseAdmin
                .from('engine_commands')
                .update({ status: isFailed ? 'failed' : 'acked', ack: ackRecord, acked_at: new Date().toISOString() })
                .eq('id', e.commandId)
                .eq('session_id', session.id);

              // Sync broadcast_recipients if this command belongs to a broadcast
              const { data: br } = await supabaseAdmin
                .from('broadcast_recipients')
                .select('id, broadcast_id')
                .eq('command_id', e.commandId)
                .maybeSingle();
              if (br) {
                const newStatus = isFailed ? 'failed' : 'sent';
                await supabaseAdmin
                  .from('broadcast_recipients')
                  .update({ status: newStatus, sent_at: isFailed ? null : new Date().toISOString() })
                  .eq('id', br.id);
                if (isFailed) {
                  await supabaseAdmin.rpc('increment_broadcast_failed', { p_broadcast_id: br.broadcast_id });
                } else {
                  await supabaseAdmin.rpc('increment_broadcast_sent', { p_broadcast_id: br.broadcast_id });
                }
              }
            }
          } catch (eventErr: any) {
            console.error('[ingest] Non-fatal error processing event in loop:', eventErr.message || eventErr, e);
          }
        }

        // Log de auditoria opcional. Es la tabla que mas crece; se puede
        // desactivar con DISABLE_EVENT_AUDIT=true para ahorrar espacio.
        const eventRows = process.env.DISABLE_EVENT_AUDIT === 'true'
          ? []
          : normalized.map((e, i) => ({
              org_id: session.org_id,
              session_id: session.id,
              type: e.type,
              payload: stripHeavyFieldsForDb(events[i]) as never,
            }))
        if (eventRows.length) {
          try {
            await supabaseAdmin.from('events').insert(eventRows)
          } catch (eventsErr: unknown) {
            console.error(
              '[ingest] events audit insert failed (non-fatal):',
              eventsErr instanceof Error ? eventsErr.message : eventsErr
            )
          }
        }

        // ---- CONTACT_INFO: enriquece o fusiona contactos (waId + foto + nombre + teléfono) ----
        const contactInfoEvents = events.filter(
          (ev) => String(ev?.type || '').toUpperCase() === 'CONTACT_INFO',
        )
        for (const ev of contactInfoEvents) {
          try {
            const p: Record<string, any> = unwrapBridgePayload(ev)
            const rawWaId = ev.chatId ?? p.waId ?? p.chatId
            const waId = normalizeWaKey(rawWaId)
            if (!waId) continue
            const phone = sanitizeContactPhone(
              p.phone ? digits(p.phone) : (!isLidKey(waId) ? digits(waId) : null),
              waId,
            )
            const displayName =
              typeof p.displayName === 'string' && p.displayName.trim()
                ? p.displayName.trim()
                : typeof p.pushname === 'string' && p.pushname.trim()
                  ? p.pushname.trim()
                  : null
            const picUrl = typeof p.profilePictureUrl === 'string' ? p.profilePictureUrl : null
            const isAnonName = (n?: string | null) =>
              !n || n.startsWith('Cliente') || n.toLowerCase() === 'unknown' ||
              n === phone || n === waId.replace(/@lid$/, '')
            // 1) Buscar contacto existente por wa_id (el LID que ya guardamos)
            const { data: byWa } = await supabaseAdmin
              .from('contacts')
              .select('id, wa_id, display_name, phone, profile_picture_url')
              .eq('org_id', session.org_id)
              .eq('wa_id', waId)
              .maybeSingle()
            // 2) Buscar contacto por phone (puede ser otro registro creado antes con @c.us)
            let byPhone: any = null
            if (phone) {
              const { data } = await supabaseAdmin
                .from('contacts')
                .select('id, wa_id, display_name, phone, profile_picture_url')
                .eq('org_id', session.org_id)
                .eq('phone', phone)
                .maybeSingle()
              byPhone = data
            }
            // CASO A: existen ambos y son distintos => fusionar (LID → phone)
            if (byWa && byPhone && byWa.id !== byPhone.id) {
              // Mover threads del contacto LID al contacto phone (resolviendo posibles
              // colisiones por unique session_id+contact_id)
              const { data: lidThreads } = await supabaseAdmin
                .from('threads')
                .select('id, session_id')
                .eq('contact_id', byWa.id)
              for (const t of lidThreads ?? []) {
                const { data: existingThread } = await supabaseAdmin
                  .from('threads')
                  .select('id')
                  .eq('contact_id', byPhone.id)
                  .eq('session_id', t.session_id)
                  .maybeSingle()
                if (existingThread) {
                  await supabaseAdmin.from('messages').update({ thread_id: existingThread.id }).eq('thread_id', t.id)
                  await supabaseAdmin.from('threads').delete().eq('id', t.id)
                } else {
                  await supabaseAdmin.from('threads').update({ contact_id: byPhone.id }).eq('id', t.id)
                }
              }
              // Mover tags / mover relaciones simples
              try {
                await (supabaseAdmin as any).from('contact_tags').update({ contact_id: byPhone.id }).eq('contact_id', byWa.id)
              } catch {}
              try {
                await (supabaseAdmin as any).from('notes').update({ contact_id: byPhone.id }).eq('contact_id', byWa.id)
              } catch {}
              try {
                await (supabaseAdmin as any).from('reminders').update({ contact_id: byPhone.id }).eq('contact_id', byWa.id)
              } catch {}
              // Actualizar phone contact con el mejor dato
              await supabaseAdmin.from('contacts').update({
                display_name: !isAnonName(byPhone.display_name) ? byPhone.display_name : (displayName ?? byWa.display_name ?? byPhone.display_name),
                profile_picture_url: picUrl ?? byPhone.profile_picture_url ?? byWa.profile_picture_url,
              } as any).eq('id', byPhone.id)
              // Borrar el LID huérfano
              await supabaseAdmin.from('contacts').delete().eq('id', byWa.id)
              continue
            }
            // CASO B: existe sólo por phone => actualizarlo con la mejor foto/nombre
            if (!byWa && byPhone) {
              const update: Record<string, any> = {}
              if (picUrl && picUrl !== byPhone.profile_picture_url) update.profile_picture_url = picUrl
              if (displayName && isAnonName(byPhone.display_name)) update.display_name = displayName
              if (Object.keys(update).length) {
                await supabaseAdmin.from('contacts').update(update as any).eq('id', byPhone.id)
              }
              continue
            }
            // CASO C: existe sólo por waId => añadir phone real (nunca LID) + foto + nombre
            if (byWa && !byPhone) {
              const update: Record<string, any> = {}
              const existingPhoneOk = sanitizeContactPhone(byWa.phone, byWa.wa_id)
              if (!existingPhoneOk && byWa.phone) update.phone = null
              if (phone && byWa.phone !== phone) update.phone = phone
              if (picUrl && picUrl !== byWa.profile_picture_url) update.profile_picture_url = picUrl
              if (displayName && isAnonName(byWa.display_name)) update.display_name = displayName
              if (Object.keys(update).length) {
                await supabaseAdmin.from('contacts').update(update as any).eq('id', byWa.id)
              }
              continue
            }
            // CASO D: no existe — sólo creamos si tenemos al menos phone o nombre útil
            if (!byWa && !byPhone && (phone || displayName)) {
              await supabaseAdmin.from('contacts').insert({
                org_id: session.org_id,
                wa_id: waId,
                phone,
                display_name: displayName ?? phone ?? waId.replace(/@lid$/, ''),
                profile_picture_url: picUrl,
              } as any)
            }
          } catch (err) {
            console.warn('[ingest] CONTACT_INFO handler error:', (err as Error)?.message)
          }
        }

        return json(200, { ok: true, processed: events.length })
      },
    },
  },
})
