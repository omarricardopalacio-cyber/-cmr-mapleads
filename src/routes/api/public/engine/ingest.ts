// @ts-nocheck
import { createFileRoute } from '@tanstack/react-router'
import { supabaseAdmin } from '@/integrations/supabase/client.server'
import {
  sanitizeMessageText,
  isWhatsAppSystemText,
} from '@/lib/message-text'
import {
  enrichMediaForMessage,
  stripHeavyFieldsForDb,
  toLocalOnlyMediaMeta,
} from '@/lib/engine-media.server'
import { transcribeInboundAudio } from '@/lib/ai/transcribe.server'
import { storagePathFromMediaUrl } from '@/lib/media'
import { z } from 'zod'
import { createDedupTracker, buildInboundDedupKey, buildAiReplyDedupKey } from './-ingest-dedupe'
import { ensureFlowRunForContact } from '@/lib/flow-trigger.server'
import {
  insertMessagesSafe,
  resolveOutboundMessageSource,
} from '@/lib/message-insert.server'
import {
  scheduleDebouncedAiReply,
  processDueAiReplies,
  hasExistingAiReplyCommand,
} from '@/lib/ai-reply.server'

const dyn = () => supabaseAdmin as unknown as { from: (t: string) => any }

function isGreetingOnly(text: string): boolean {
  const normalized = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!?¡¿.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return /^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|hi|hello|saludos)$/.test(normalized)
}

async function claimInboundAutomation(params: {
  orgId: string
  sessionId: string
  threadId: string
  eventKey: string
  waMessageId?: string
}): Promise<boolean> {
  const { error } = await (supabaseAdmin as any)
    .from('inbound_automation_claims')
    .insert({
      org_id: params.orgId,
      session_id: params.sessionId,
      thread_id: params.threadId,
      event_key: params.eventKey,
      wa_message_id: params.waMessageId || null,
    })
  if (!error) return true
  if (error.code === '23505') return false
  // Compatibilidad durante despliegue antes de aplicar la migración.
  if (error.code === '42P01' || String(error.message || '').includes('inbound_automation_claims')) {
    console.warn('[ingest] automation claim table no disponible; usando dedupe local')
    return true
  }
  console.warn('[ingest] automation claim falló; fail-open', error.message)
  return true
}

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
/**
 * WhatsApp LID (identidad interna) suele ser 14–15 dígitos y NO es un celular.
 * Si lo guardamos como phone aparece como "+11875…" / "Cliente XXXX".
 */
function looksLikeLidDigits(d?: string | null): boolean {
  if (!d) return false
  // Teléfonos reales con país raramente empiezan por 1 y tienen ≥14 dígitos
  // sin ser NANP corto; los LID de WA Web sí.
  return d.length >= 14 && d.startsWith('1')
}

function sanitizeContactPhone(
  phone: string | null | undefined,
  waId?: string | null,
  ownNumbers?: Array<string | null | undefined>,
): string | null {
  if (phone == null || phone === '') return null
  if (String(phone).includes('@lid')) return null
  const d = digits(phone)
  if (!d || d.length < 8 || d.length > 15) return null

  if (waId && isLidKey(waId)) {
    const lidDigits = waIdUserDigits(waId)
    if (lidDigits && d === lidDigits) return null
  }
  if (looksLikeLidDigits(d)) return null

  const own = (ownNumbers || []).map(digits).filter(Boolean) as string[]
  if (own.includes(d)) return null

  return d
}

function sessionOwnDigits(session: {
  me_wa_id?: string | null
  phone_number?: string | null
}): string[] {
  return [digits(session.me_wa_id), digits(session.phone_number)].filter(Boolean) as string[]
}

function isOwnIdentity(
  value: string | null | undefined,
  own: string[],
): boolean {
  const d = digits(value)
  return Boolean(d && own.includes(d))
}

/** Elige la mejor ficha cuando hay varias con el mismo teléfono (evita maybeSingle crash). */
function pickBestContactRow<T extends { id: string; wa_id?: string | null; display_name?: string | null }>(
  rows: T[] | null | undefined,
): T | null {
  if (!rows?.length) return null
  const scored = [...rows].sort((a, b) => {
    const score = (r: T) => {
      let s = 0
      const wa = String(r.wa_id || '')
      if (wa.endsWith('@c.us') || (/^\d+$/.test(wa) && !looksLikeLidDigits(wa))) s += 3
      if (wa.endsWith('@lid')) s -= 2
      if (isUsefulDisplayName(r.display_name, undefined, r.wa_id)) s += 1
      return s
    }
    return score(b) - score(a)
  })
  return scored[0] ?? null
}

/** Saludos / primera línea de chat → NO son nombre de persona (evita 3 fichas "Hola cómo estás"). */
function looksLikeMessageNotPersonName(name: string): boolean {
  const t = name.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!t) return true
  if (/[¿?]/.test(t)) return true
  if (
    /^(hola|holaa+|buenas|buenos días|buenas tardes|buenas noches|hey|hi|hello|saludos)\b/.test(t)
  ) {
    return true
  }
  if (
    /\b(cómo estás|como estas|qué tal|que tal|me interesa|quiero info|información|cotiz|precio|disponible)\b/.test(
      t,
    )
  ) {
    return true
  }
  // Nombres reales rara vez tienen ≥4 palabras
  if (t.split(' ').filter(Boolean).length >= 4) return true
  if (/[!…]$/.test(t)) return true
  return false
}

function pickDisplayName(name: unknown, waId?: string, phone?: string): string | undefined {
  const clean = typeof name === 'string' ? name.trim() : ''
  if (clean && clean.toLowerCase() !== 'unknown' && !looksLikeMessageNotPersonName(clean)) {
    return clean
  }
  return phone ?? undefined
}

function isUsefulDisplayName(name: unknown, phone?: string, waId?: string): boolean {
  if (typeof name !== 'string') return false
  const clean = name.trim()
  if (!clean) return false
  const lower = clean.toLowerCase()
  if (lower === 'unknown') return false
  if (/^[.\-…·_*]+$/.test(clean)) return false
  if (/^(n\/a|na|null|undefined|sin nombre)$/i.test(clean)) return false
  if (phone && clean === phone) return false
  if (waId && clean === waId.replace(/@lid$/, '')) return false
  if (clean.startsWith('Cliente')) return false
  if (looksLikeMessageNotPersonName(clean)) return false
  return true
}

function tryExtractContactDetailsFromText(text?: string | null): { extractedName?: string; extractedPhone?: string } {
  if (!text || typeof text !== 'string') return {}
  let extractedName: string | undefined
  let extractedPhone: string | undefined

  const phoneMatch = text.match(/(?:\+?57\s*)?(3\d{2}[\s.-]?\d{3}[\s.-]?\d{4})\b/)
  if (phoneMatch) {
    const raw = phoneMatch[1].replace(/\D/g, '')
    if (raw.length === 10 && raw.startsWith('3')) {
      extractedPhone = '57' + raw
    }
  }

  const nameMatch = text.match(/(?:nombre|me llamo|soy|mi nombre es)\s*[:=;\-]?\s*([A-ZÁÉÍÓÚa-záéíóúñÑ]{2,25}(?:\s+[A-ZÁÉÍÓÚa-záéíóúñÑ]{2,25}){0,3})/i)
  if (nameMatch) {
    const cand = nameMatch[1].trim()
    if (cand.length >= 3 && !looksLikeMessageNotPersonName(cand)) {
      extractedName = cand
    }
  }

  if (!extractedName) {
    const parts = text.split(/[\/\n,]+/).map((p) => p.trim()).filter(Boolean)
    if (parts.length >= 2) {
      const firstPart = parts[0]
      if (
        /^[A-ZÁÉÍÓÚa-záéíóúñÑ]{2,25}(?:\s+[A-ZÁÉÍÓÚa-záéíóúñÑ]{2,25}){0,2}$/.test(firstPart) &&
        !looksLikeMessageNotPersonName(firstPart)
      ) {
        extractedName = firstPart
      }
    }
  }

  return { extractedName, extractedPhone }
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
  // LID con nombre útil: permitir crear ficha temporal (se fusionará cuando llegue
  // el evento enriquecido con el teléfono real)
  if (isLidKey(waId) || looksLikeLidDigits(digits(waId))) {
    // Solo crear ficha LID si tiene un nombre real (no solo dígitos/LID)
    return isUsefulDisplayName(displayName, undefined, waId)
  }
  if (Boolean(digits(waId))) return true
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
): Promise<{ aiDisabled: boolean; totalDelaySec: number; matched: boolean; deferAiReply: boolean }> {
  const { data: rules } = await supabaseAdmin
    .from('auto_replies')
    .select(
      'id, match_type, match_value, reply_text, cooldown_seconds, last_triggered_at, session_id, trigger_type, media_url, mime_type, action_add_tags, action_remove_tags, action_ai_behavior, limit_per_contact',
    )
    .eq('org_id', orgId)
    .eq('is_active', true);
  if (!rules?.length) return { aiDisabled: false, totalDelaySec: 0, matched: false, deferAiReply: false };

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
      // Valor vacío haría includes('') === true (match universal) → rechazar.
      if (!v || v.length < 2) continue;
      try {
        const cleanText = lower.trim();
        if (raw.match_type === 'equals') hit = cleanText === v;
        else if (raw.match_type === 'starts') hit = cleanText.startsWith(v);
        else if (raw.match_type === 'regex') {
          if (!String(raw.match_value || '').trim()) continue;
          hit = new RegExp(raw.match_value, 'i').test(text);
        } else {
          // contains: exigir al menos 3 caracteres para evitar "la"/"si" accidentales
          if (v.length < 3) continue;
          hit = cleanText.includes(v);
        }
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
    let deferAiReply = true; // auto-respuesta ya tomó el turno
    if (raw.action_ai_behavior === 'disable_ai') {
      await supabaseAdmin.from('threads').update({ ai_enabled: false } as unknown as Record<string, never>).eq('id', threadId);
      aiDisabled = true;
    } else if (raw.action_ai_behavior === 'enable_ai') {
      // Enciende IA para el SIGUIENTE mensaje; no responder en este turno.
      await supabaseAdmin.from('threads').update({ ai_enabled: true } as unknown as Record<string, never>).eq('id', threadId);
      deferAiReply = true;
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

    return { aiDisabled, totalDelaySec, matched: true, deferAiReply };
  }
  return { aiDisabled: false, totalDelaySec: 0, matched: false, deferAiReply: false };
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
    // Buscar en ambas variantes de tipo: 'SEND_MESSAGE' (agente/IA) y 'send_message' (flujos)
    const { data: commands } = await supabaseAdmin
      .from('engine_commands')
      .select('payload, created_at')
      .eq('org_id', orgId)
      .eq('session_id', sessionId)
      .in('type', ['SEND_MESSAGE', 'send_message', 'send_media'])
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
      .in('type', ['SEND_MESSAGE', 'send_message', 'send_media'])
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

const inboundEventDedupe = createDedupTracker(45_000);
const aiReplyDedupe = createDedupTracker(60_000);

function normalizeForReplyDedup(text: string) {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
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
  const own = [digits(meWaId), digits(phoneNumber)].filter(Boolean) as string[]
  return own.includes(chatDigits)
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

/** Programa respuesta IA con debounce (agrupa mensajes partidos) y espera flujo activo. */
async function scheduleAiReplyFromIngest(params: {
  orgId: string
  sessionId: string
  chatId: string
  contactId: string
  threadId: string
  text: string
  delayAfterAutoReplies?: number
  autoRepliesWereSent?: boolean
  aiReplyDedupeKey?: string
}) {
  const {
    orgId,
    sessionId,
    chatId,
    contactId,
    threadId,
    text,
    delayAfterAutoReplies = 0,
    autoRepliesWereSent = false,
    aiReplyDedupeKey,
  } = params

  if (aiReplyDedupeKey) {
    const alreadyQueued = await hasExistingAiReplyCommand(orgId, sessionId, aiReplyDedupeKey)
    if (alreadyQueued) {
      console.log('[ingest] skip duplicate AI reply by persisted command', {
        aiReplyDedupeKey,
        threadId,
      })
      return
    }
  }

  try {
    const { executeAiReply } = await import('@/lib/ai-reply.server')
    console.info('[ingest] ejecutando IA de forma síncrona en serverless', { threadId, contactId })
    await executeAiReply({
      orgId,
      sessionId,
      chatId,
      contactId,
      threadId,
      text,
      delayAfterAutoReplies,
      autoRepliesWereSent,
      aiReplyDedupeKey,
    })
  } catch (err: any) {
    console.error('[ingest] error ejecutando IA síncrona, usando fallback scheduleDebouncedAiReply:', err?.message)
    await scheduleDebouncedAiReply({
      orgId,
      sessionId,
      chatId,
      contactId,
      threadId,
      text,
      delayAfterAutoReplies,
      autoRepliesWereSent,
      aiReplyDedupeKey,
      waitForFlow: true,
    })
  }
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

  // Respetar ai_enabled=false (flujo/humano lo apagó). NO reactivar aquí:
  // un paso "Activar IA" del mismo turno no debe disparar LLM sobre este mensaje.
  if ((thread as unknown as { ai_enabled?: boolean })?.ai_enabled === false) {
    console.info('[ai-reply] skip: IA desactivada en el hilo', { threadId })
    return
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

  // Si acabamos de presentar un producto (foco reciente) y este es el 1er mensaje
  // entrante, NO responder: el flujo/ficha ya preguntó; espera la respuesta del cliente.
  try {
    const { data: thFocus } = await supabaseAdmin
      .from('threads')
      .select('focused_product_id, focused_updated_at')
      .eq('id', threadId)
      .eq('org_id', orgId)
      .maybeSingle()
    const focusedAt = (thFocus as any)?.focused_updated_at
      ? new Date(String((thFocus as any).focused_updated_at)).getTime()
      : 0
    const focusAgeMs = focusedAt ? Date.now() - focusedAt : Number.POSITIVE_INFINITY
    if ((thFocus as any)?.focused_product_id && focusAgeMs >= 0 && focusAgeMs < 90_000) {
      const { count: inboundCount } = await supabaseAdmin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', threadId)
        .eq('direction', 'in')
      if ((inboundCount ?? 0) <= 1) {
        console.info('[ai-reply] defer: producto recién presentado; espera consulta del cliente', {
          threadId,
          focusAgeMs,
          inboundCount,
        })
        return
      }
    }
  } catch (deferErr) {
    console.warn('[ai-reply] defer check failed:', (deferErr as Error)?.message)
  }

  if (cfg.respond_to === 'new') {
    const { count } = await supabaseAdmin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', threadId)
      .eq('direction', 'out')
      .neq('source', 'flow')
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
    // activate_flow / present_product ya enviaron contenido: no añadir texto IA.
    const activatedFlow =
      actions?.includes('activate_flow') || actions?.includes('present_product')

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

        // Algunas sesiones no tienen me_wa_id configurado, pero sí phone_number
        // detectado por SESSION_READY. Usarlo como respaldo permite corregir en
        // servidor payloads de extensiones antiguas que ponían nuestro `to`
        // como contacto en mensajes entrantes.
        const meWaId = session.me_wa_id ?? session.phone_number ?? null
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

            const ownDigits = sessionOwnDigits(session)

            // Nunca procesar el chat consigo mismo como si fuera un cliente.
            if (
              isOwnIdentity(waId, ownDigits) ||
              isOwnIdentity(e.chatId, ownDigits) ||
              isOwnIdentity(e.contact?.phone, ownDigits)
            ) {
              console.warn('[ingest] skip self-identity event', {
                waId,
                chatId: e.chatId,
                phone: e.contact?.phone,
              })
              continue
            }

            // Mismo waMessageId ya guardado en OTRO hilo (LID vs teléfono vs self):
            // no crear otra ficha ni reenviar flujos. EXCEPCIÓN: mediaRecovery es
            // el segundo evento del mismo audio (ya con bytes/URL) y debe llegar
            // hasta la rama que actualiza/transcribe el mensaje existente.
            if (e.waMessageId && (e.type === 'message-in' || e.type === 'message-out')) {
              const { data: priorMsg } = await supabaseAdmin
                .from('messages')
                .select('id, thread_id')
                .eq('org_id', session.org_id)
                .eq('wa_message_id', e.waMessageId)
                .maybeSingle()
              if (priorMsg?.id && !e.mediaRecovery) {
                console.log('[ingest] skip cross-thread duplicate waMessageId', {
                  waMessageId: e.waMessageId,
                  threadId: priorMsg.thread_id,
                })
                continue
              } else if (priorMsg?.id && e.mediaRecovery) {
                console.info('[ingest] permitiendo mediaRecovery para mensaje existente', {
                  waMessageId: e.waMessageId,
                  threadId: priorMsg.thread_id,
                })
              }
            }

            let contactId: string | null = null
            let isNewContact = false
            let phone = sanitizeContactPhone(e.contact?.phone ?? null, waId, ownDigits)

            // Extraer número de teléfono del waId (solo JID normal, NUNCA LID)
            const userPart = waId.split('@')[0];
            const cleanPhone = userPart.replace(/\D/g, '');

            if (!phone && cleanPhone && !waId.endsWith('@g.us') && !isLidKey(waId)) {
              phone = sanitizeContactPhone(cleanPhone, waId, ownDigits);
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
              phone = sanitizeContactPhone(resolved.phone, waId, ownDigits)
            }

            // Si el contacto LID ya existe con phone=LID (dato basura), limpiarlo
            if (isLidKey(waId)) {
              const { data: dirtyLid } = await supabaseAdmin
                .from('contacts')
                .select('id, phone')
                .eq('org_id', session.org_id)
                .eq('wa_id', waId)
                .maybeSingle()
              if (dirtyLid?.phone && sanitizeContactPhone(dirtyLid.phone, waId, ownDigits) == null) {
                await supabaseAdmin
                  .from('contacts')
                  .update({ phone: null } as any)
                  .eq('id', dirtyLid.id)
                console.info('[ingest] phone=LID limpiado del contacto', { contactId: dirtyLid.id, waId })
              }
            }

            if (phone) {
              // .maybeSingle() rompe si ya hay duplicados → crea una 3ª ficha.
              const { data: phoneRows } = await supabaseAdmin
                .from('contacts')
                .select('id, wa_id, display_name, updated_at')
                .eq('org_id', session.org_id)
                .eq('phone', phone)
                .order('updated_at', { ascending: false })
                .limit(10)
              const byPhone = pickBestContactRow(phoneRows)
              if (byPhone) {
                contactId = byPhone.id

                // Fusionar fichas huérfanas con el mismo teléfono
                for (const dup of phoneRows || []) {
                  if (dup.id === byPhone.id) continue
                  const { data: dupThreads } = await supabaseAdmin
                    .from('threads')
                    .select('id, session_id')
                    .eq('org_id', session.org_id)
                    .eq('contact_id', dup.id)
                  for (const t of dupThreads || []) {
                    const { data: keepThread } = await supabaseAdmin
                      .from('threads')
                      .select('id')
                      .eq('session_id', t.session_id)
                      .eq('contact_id', byPhone.id)
                      .maybeSingle()
                    if (keepThread?.id) {
                      await supabaseAdmin
                        .from('messages')
                        .update({ thread_id: keepThread.id })
                        .eq('thread_id', t.id)
                      await supabaseAdmin.from('threads').delete().eq('id', t.id)
                    } else {
                      await supabaseAdmin
                        .from('threads')
                        .update({ contact_id: byPhone.id })
                        .eq('id', t.id)
                    }
                  }
                  await supabaseAdmin.from('contacts').delete().eq('id', dup.id)
                  console.info('[ingest] fusionado contacto duplicado por phone', {
                    from: dup.id,
                    to: byPhone.id,
                    phone,
                  })
                }
                
                const currentIsAnonymous = !isUsefulDisplayName(
                  byPhone.display_name,
                  phone ?? undefined,
                  byPhone.wa_id,
                )
                const hasNewRealName = isUsefulDisplayName(
                  e.contact?.displayName,
                  phone ?? undefined,
                  waId,
                )

                // Preferir wa_id de teléfono real sobre LID cuando ya tenemos phone
                const nextWaId =
                  isLidKey(byPhone.wa_id) && !isLidKey(waId)
                    ? waId
                    : isLidKey(waId) && byPhone.wa_id && !isLidKey(byPhone.wa_id)
                      ? byPhone.wa_id
                      : waId

                if (byPhone.wa_id !== nextWaId || (currentIsAnonymous && hasNewRealName)) {
                  await supabaseAdmin
                    .from('contacts')
                    .update({
                      wa_id: nextWaId,
                      display_name: hasNewRealName
                        ? e.contact!.displayName
                        : (byPhone.display_name ?? phone),
                      phone,
                      profile_picture_url: e.contact?.profilePictureUrl,
                    })
                    .eq('id', byPhone.id)
                }

                // Si existía ficha LID aparte, mover sus threads al contacto con teléfono
                if (isLidKey(waId) && byPhone.wa_id !== waId) {
                  const { data: lidContact } = await supabaseAdmin
                    .from('contacts')
                    .select('id')
                    .eq('org_id', session.org_id)
                    .eq('wa_id', waId)
                    .maybeSingle()
                  if (lidContact?.id && lidContact.id !== byPhone.id) {
                    await supabaseAdmin
                      .from('threads')
                      .update({ contact_id: byPhone.id })
                      .eq('org_id', session.org_id)
                      .eq('contact_id', lidContact.id)
                    await supabaseAdmin.from('contacts').delete().eq('id', lidContact.id)
                    console.info('[ingest] fusionado contacto LID → teléfono', {
                      lidContactId: lidContact.id,
                      phoneContactId: byPhone.id,
                      phone,
                    })
                  }
                }
              }
            }

            if (!contactId && phone) {
              const { data: threadWithLid } = await supabaseAdmin
                .from('threads')
                .select('contact_id')
                .eq('session_id', session.id)
                .order('last_message_at', { ascending: false })
                .limit(1)
                .maybeSingle()

              if (threadWithLid?.contact_id) {
                const { data: lidContact } = await supabaseAdmin
                  .from('contacts')
                  .select('id, wa_id, phone')
                  .eq('id', threadWithLid.contact_id)
                  .maybeSingle()

                if (lidContact && (isLidKey(lidContact.wa_id || '') || !lidContact.phone)) {
                  const safeName = isUsefulDisplayName(
                    e.contact?.displayName,
                    phone,
                    waId,
                  )
                    ? e.contact!.displayName
                    : phone

                  await supabaseAdmin
                    .from('contacts')
                    .update({
                      phone,
                      display_name: safeName,
                      profile_picture_url: e.contact?.profilePictureUrl,
                    })
                    .eq('id', lidContact.id)

                  contactId = lidContact.id
                  console.info('[ingest] vinculado teléfono a contacto LID existente (evitó duplicado)', {
                    contactId,
                    phone,
                    waId,
                  })
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
                const safeName = isUsefulDisplayName(
                  e.contact?.displayName,
                  phone ?? undefined,
                  waId,
                )
                  ? e.contact!.displayName
                  : phone ?? undefined
                const { data: newContact } = await supabaseAdmin
                  .from('contacts')
                  .upsert(
                    {
                      org_id: session.org_id,
                      wa_id: waId,
                      display_name: safeName,
                      phone,
                      profile_picture_url: e.contact?.profilePictureUrl,
                    },
                    { onConflict: 'org_id,wa_id' },
                  )
                  .select('id')
                  .single()
                contactId = newContact?.id ?? null
                isNewContact = Boolean(newContact?.id)
              } else if (
                isLidKey(waId) &&
                !phone &&
                (e.direction === 'in' || e.type === 'message-in') &&
                (e.text?.trim() || e.waMessageId)
              ) {
                // Fallback: LID entrante sin nombre ni teléfono → crear contacto anónimo
                // temporal para que el mensaje no se pierda. Se fusionará cuando llegue
                // el evento enriquecido con teléfono/nombre real de la extensión.
                console.info('[ingest] LID sin nombre — creando contacto anónimo temporal', { waId })
                const { data: anonContact } = await supabaseAdmin
                  .from('contacts')
                  .upsert(
                    {
                      org_id: session.org_id,
                      wa_id: waId,
                      display_name: null,
                      phone: null,
                    },
                    { onConflict: 'org_id,wa_id' },
                  )
                  .select('id')
                  .single()
                contactId = anonContact?.id ?? null
                isNewContact = Boolean(anonContact?.id)
              }
            }

            if (contactId) {
              const { data: cont } = await supabaseAdmin
                .from('contacts')
                .select('display_name, wa_id, phone')
                .eq('id', contactId)
                .maybeSingle()
              if (cont) {
                const currentIsAnonymous = !isUsefulDisplayName(
                  cont.display_name,
                  phone ?? cont.phone ?? undefined,
                  cont.wa_id || waId,
                )
                const hasNewRealName = isUsefulDisplayName(
                  e.contact?.displayName,
                  phone ?? cont.phone ?? undefined,
                  waId,
                )

                const extracted = tryExtractContactDetailsFromText(e.text)
                const updates: Record<string, any> = {}

                if (extracted.extractedPhone && !cont.phone) {
                  updates.phone = extracted.extractedPhone
                }
                if (extracted.extractedName && (currentIsAnonymous || !cont.display_name)) {
                  updates.display_name = extracted.extractedName
                } else if (currentIsAnonymous && hasNewRealName) {
                  updates.display_name = e.contact!.displayName
                  if (e.contact?.profilePictureUrl) {
                    updates.profile_picture_url = e.contact.profilePictureUrl
                  }
                } else if (
                  cont.display_name &&
                  looksLikeMessageNotPersonName(String(cont.display_name))
                ) {
                  updates.display_name = phone || extracted.extractedPhone || null
                }

                if (Object.keys(updates).length > 0) {
                  await supabaseAdmin
                    .from('contacts')
                    .update(updates as any)
                    .eq('id', contactId)
                }
              }
            }

            if (!contactId) continue

            // No tocar last_message_at aquí: solo tras insert exitoso del mensaje.
            // Si no, la lista muestra chats "activos" con 0 mensajes.
            const { data: thread } = await supabaseAdmin
              .from('threads')
              .upsert(
                {
                  org_id: session.org_id,
                  session_id: session.id,
                  contact_id: contactId,
                  assigned_to_user_id: session.default_agent_id ?? null,
                },
                { onConflict: 'session_id,contact_id' },
              )
              .select('id, focused_product_id, ai_enabled')
              .single()
            if (!thread) continue

            // default_flow se decide más abajo con el texto (solo saludo / nuevo contacto)
            // para no apilar con producto/IA/Vigilante.
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

                // Clasificar únicamente la transcripción real. Nunca enviar el
                // texto sintético de fallback al Vigilante/etiquetas.
                if (gotNewTranscript && e.text?.trim()) {
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
                      text: e.text.trim(),
                      trigger: 'message',
                      skipFlowStart: aiCfg?.enabled === true,
                    }).catch((err) => {
                      console.warn('[ingest] watcher audio transcrito:', (err as Error)?.message)
                    })
                  } catch (_) { /* no bloquear audio/IA */ }
                }

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

                  // Auto-respuestas/etiquetas solo reciben texto realmente
                  // transcrito. El fallback queda reservado a la respuesta IA.
                  const { aiDisabled, totalDelaySec } = gotNewTranscript && e.text?.trim()
                    ? await maybeAutoReply(
                        session.org_id,
                        session.id,
                        sendChatId,
                        e.text.trim(),
                        thread.id,
                        contactId,
                      )
                    : { aiDisabled: false, totalDelaySec: 0 }
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
                      await scheduleAiReplyFromIngest({
                        orgId: session.org_id,
                        sessionId: session.id,
                        chatId: sendChatId,
                        contactId,
                        threadId: thread.id,
                        text: textForAi,
                        delayAfterAutoReplies: totalDelaySec,
                        autoRepliesWereSent,
                        aiReplyDedupeKey,
                      })
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
                      text: e.text!.trim(),
                      trigger: 'message',
                      skipFlowStart: aiCfg?.enabled === true,
                    }).catch((err) => {
                      console.warn('[ingest] watcher audio transcrito:', (err as Error)?.message)
                    })
                  } catch (_) { /* no bloquear audio/IA */ }
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
                  const { aiDisabled, totalDelaySec } = gotNewTranscript && e.text?.trim()
                    ? await maybeAutoReply(
                        session.org_id,
                        session.id,
                        sendChatId,
                        e.text.trim(),
                        thread.id,
                        contactId,
                      )
                    : { aiDisabled: false, totalDelaySec: 0 }
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
                      await scheduleAiReplyFromIngest({
                        orgId: session.org_id,
                        sessionId: session.id,
                        chatId: sendChatId,
                        contactId,
                        threadId: thread.id,
                        text: textForAi,
                        delayAfterAutoReplies: totalDelaySec,
                        autoRepliesWereSent: totalDelaySec > 0,
                        aiReplyDedupeKey,
                      })
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

            const messageDirectionInsert =
              e.direction ?? (e.type === 'message-in' ? 'in' : 'out')
            let messageSource: string | null = null
            if (messageDirectionInsert === 'out') {
              try {
                messageSource = await resolveOutboundMessageSource({
                  orgId: session.org_id,
                  sessionId: session.id,
                  text: e.text,
                  commandId: e.commandId ?? null,
                })
              } catch {
                messageSource = 'unknown'
              }
            }

            const sentAtIso = e.sentAt ?? new Date().toISOString()
            const { error: msgInsErr } = await insertMessagesSafe({
              org_id: session.org_id,
              thread_id: thread.id,
              wa_message_id: e.waMessageId ?? null,
              direction: messageDirectionInsert,
              text: e.text?.trim() ? e.text : null,
              media: enrichedMedia as any,
              // raw se deja vacio a proposito: el payload crudo ocupa mucho espacio,
              // nunca se lee para features y ya queda auditado en la tabla `events`.
              raw: null,
              source: messageSource,
              sent_at: sentAtIso,
            })
            if (msgInsErr) {
              console.error('[ingest] messages.insert failed', msgInsErr.message, {
                threadId: thread.id,
                waMessageId: e.waMessageId,
              })
              continue
            }

            await supabaseAdmin
              .from('threads')
              .update({ last_message_at: sentAtIso })
              .eq('id', thread.id)

            // Aprendizaje: outbound agent o inbound tras atención humana
            if (
              (messageDirectionInsert === 'out' && messageSource === 'agent') ||
              messageDirectionInsert === 'in'
            ) {
              import('@/lib/product-learning.server')
                .then(async ({ maybeQualifyProductLearning, kickProductLearningWorker }) => {
                  await maybeQualifyProductLearning({
                    orgId: session.org_id,
                    threadId: thread.id,
                    contactId: contactId || thread.contact_id || null,
                  })
                  // Sin cron: drena jobs pending con throttle (~90s)
                  void kickProductLearningWorker()
                })
                .catch(() => {})
            }

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

            const realInboundText = (e.text?.trim() || '').trim()
            const textForAiInsert = (realInboundText || audioAiFallbackText || '').trim()
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

              // Orquestación única: un solo "dueño" por inbound.
              // Prioridad: producto en foco > activador producto > auto-respuesta >
              // flujo genérico > IA. Saludo "hola" → solo bienvenida.
              const eventKey = buildInboundDedupKey({
                sessionId: session.id,
                chatId: sendChatId || e.chatId,
                waMessageId: e.waMessageId,
                direction: 'in',
                text: textForAiInsert,
                sentAt: e.sentAt,
                waId,
              })
              const claimed = await claimInboundAutomation({
                orgId: session.org_id,
                sessionId: session.id,
                threadId: thread.id,
                eventKey,
                waMessageId: e.waMessageId,
              })
              if (!claimed) {
                console.info('[ingest] skip automation: claim perdido (duplicado concurrente)', {
                  eventKey,
                  threadId: thread.id,
                  waMessageId: e.waMessageId,
                })
                continue
              }

              const aiEnabledAtStart = (thread as any)?.ai_enabled !== false
              let focusedProductId = (thread as any)?.focused_product_id
                ? String((thread as any).focused_product_id)
                : null
              const greetingOnly = !!(realInboundText && isGreetingOnly(realInboundText))
              type Responder =
                | 'none'
                | 'product_focus'
                | 'product_entry'
                | 'welcome_flow'
                | 'auto_reply'
                | 'generic_flow'
                | 'ai'
              let responder: Responder = focusedProductId ? 'product_focus' : 'none'
              let skipAiThisInbound = false
              let totalDelaySec = 0
              let autoRepliesWereSent = false

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

              try {
                await supabaseAdmin
                  .from('no_response_pending')
                  .update({ cancelled_at: new Date().toISOString() })
                  .eq('thread_id', thread.id)
                  .is('fired_at', null)
                  .is('cancelled_at', null)
              } catch (_) { /* ignore */ }

              // 1) Bienvenida: primer mensaje de contacto nuevo → buscar flujos wa_first_conversation
              //    También usa default_flow_id si no se encontró flujo de bienvenida específico.
              if (isNewContact && !focusedProductId) {
                try {
                  // Primero: buscar flujos activos con trigger_type = 'wa_first_conversation'
                  const { data: firstConvFlows } = await dyn()
                    .from('flows')
                    .select('id, name, max_sends_per_contact')
                    .eq('org_id', session.org_id)
                    .eq('trigger_type', 'wa_first_conversation')
                    .eq('is_active', true)

                  let welcomeFlowId: string | null = null
                  let welcomeFlowName: string | undefined
                  let welcomeMaxSends: number | null = null

                  if (firstConvFlows && firstConvFlows.length > 0) {
                    const fc = firstConvFlows[0]
                    welcomeFlowId = fc.id
                    welcomeFlowName = fc.name
                    welcomeMaxSends = (fc as any).max_sends_per_contact ?? null
                    console.info('[ingest] encontrado flujo wa_first_conversation', {
                      flowId: welcomeFlowId,
                      flowName: welcomeFlowName,
                      threadId: thread.id,
                    })
                  } else if (greetingOnly && session.default_flow_id) {
                    // Fallback: default_flow_id de la sesión solo si es saludo puro
                    welcomeFlowId = session.default_flow_id
                  }

                  if (welcomeFlowId) {
                    const { data: firstStep } = await dyn()
                      .from('flow_steps')
                      .select('id')
                      .eq('flow_id', welcomeFlowId)
                      .is('parent_step_id', null)
                      .order('step_order', { ascending: true })
                      .limit(1)
                      .maybeSingle()
                    if (firstStep) {
                      const welcome = await ensureFlowRunForContact({
                        orgId: session.org_id,
                        contactId,
                        flowId: welcomeFlowId,
                        firstStepId: firstStep.id,
                        maxSends: welcomeMaxSends,
                        flowName: welcomeFlowName,
                        processNow: true,
                      })
                      if (welcome.started || welcome.alreadyActive || welcome.alreadyRecent) {
                        responder = 'welcome_flow'
                        skipAiThisInbound = true
                        console.info('[ingest] bienvenida: flujo primera conversación activado', {
                          threadId: thread.id,
                          flowId: welcomeFlowId,
                          flowName: welcomeFlowName,
                          deferAi: !!welcome.deferAiReply,
                        })
                      }
                    }
                  }
                } catch (flowErr: any) {
                  console.error('[ingest] welcome flow error:', flowErr.message)
                }
              }

              // 2) Activador de producto (solo si no hay foco y no es bienvenida)
              if (responder === 'none' && realInboundText && !greetingOnly) {
                try {
                  const { tryProductEntryTriggerOnFirstMessage } = await import(
                    '@/lib/product-entry-trigger.server'
                  )
                  const trig = await tryProductEntryTriggerOnFirstMessage({
                    orgId: session.org_id,
                    threadId: thread.id,
                    contactId,
                    sessionId: session.id,
                    chatId: sendChatId || e.chatId || null,
                    text: realInboundText,
                  })
                  if (trig.activated) {
                    responder = 'product_entry'
                    skipAiThisInbound = true
                    focusedProductId = trig.productId || focusedProductId
                    console.info('[ingest] entry_trigger_phrase activó producto', {
                      threadId: thread.id,
                      productId: trig.productId,
                      productName: trig.productName,
                    })
                  }
                } catch (trigErr) {
                  console.warn(
                    '[ingest] entry trigger:',
                    trigErr instanceof Error ? trigErr.message : trigErr,
                  )
                }
              }

              // 3) Auto-respuesta (bloqueada con producto en foco o bienvenida)
              if (responder === 'none' && realInboundText && !greetingOnly) {
                const ar = await maybeAutoReply(
                  session.org_id,
                  session.id,
                  sendChatId,
                  realInboundText,
                  thread.id,
                  contactId,
                )
                if (ar.matched) {
                  responder = 'auto_reply'
                  skipAiThisInbound = true
                  totalDelaySec = ar.totalDelaySec || 0
                  autoRepliesWereSent = totalDelaySec > 0
                  if (ar.aiDisabled) skipAiThisInbound = true
                }
              }

              // 4) Flujos keyword (solo producto ligado si hay foco; no en saludo)
              if (
                (responder === 'none' || responder === 'product_focus') &&
                realInboundText &&
                !greetingOnly
              ) {
                try {
                  const { data: aiCfgForFlows } = await supabaseAdmin
                    .from('ai_configs')
                    .select('enabled')
                    .eq('org_id', session.org_id)
                    .maybeSingle()
                  const aiHandlesFlows = aiCfgForFlows?.enabled === true && !focusedProductId

                  if (!aiHandlesFlows) {
                    const { data: keywordFlows } = await dyn()
                      .from('flows')
                      .select('id, trigger_value, max_sends_per_contact, product_id')
                      .eq('org_id', session.org_id)
                      .eq('trigger_type', 'keyword')
                      .eq('is_active', true)
                    for (const flow of keywordFlows ?? []) {
                      const flowPid = (flow as any).product_id
                        ? String((flow as any).product_id)
                        : null
                      if (focusedProductId) {
                        if (!flowPid || flowPid !== focusedProductId) continue
                      } else if (flowPid) {
                        continue
                      }
                      const triggerVal = String((flow as any).trigger_value || '')
                        .toLowerCase()
                        .trim()
                      if (!triggerVal || triggerVal.length < 3) continue
                      if (!realInboundText.toLowerCase().includes(triggerVal)) continue
                      const { data: firstStep } = await dyn()
                        .from('flow_steps')
                        .select('id')
                        .eq('flow_id', flow.id)
                        .is('parent_step_id', null)
                        .order('step_order', { ascending: true })
                        .limit(1)
                        .maybeSingle()
                      if (!firstStep) continue
                      const fr = await ensureFlowRunForContact({
                        orgId: session.org_id,
                        contactId,
                        flowId: flow.id,
                        firstStepId: firstStep.id,
                        maxSends: (flow as any).max_sends_per_contact ?? null,
                        processNow: true,
                      })
                      if (fr.started) {
                        if (responder === 'none') responder = 'generic_flow'
                        skipAiThisInbound = true
                        break
                      }
                    }
                  }
                } catch (flowErr: any) {
                  console.error('[ingest] keyword flow error:', flowErr.message)
                }
              }

              // 5) IA general — solo si nadie tomó el turno y estaba ON al inicio
              const canAi =
                !skipAiThisInbound &&
                aiEnabledAtStart &&
                (responder === 'none' || responder === 'product_focus') &&
                !(greetingOnly && responder === 'welcome_flow')

              if (canAi) {
                const aiReplyDedupKey = buildAiReplyDedupKey({
                  sessionId: session.id,
                  threadId: thread.id,
                  text: textForAiInsert,
                  waMessageId: e.waMessageId,
                  sentAt: e.sentAt,
                  chatId: sendChatId,
                })
                const alreadyQueued = await hasExistingAiReplyCommand(
                  session.org_id,
                  session.id,
                  aiReplyDedupKey,
                )
                if (alreadyQueued) {
                  console.log('[ingest] skip duplicate AI reply by persisted command', {
                    aiReplyDedupKey,
                    threadId: thread.id,
                  })
                } else if (!aiReplyDedupe.shouldProcess(aiReplyDedupKey)) {
                  console.log('[ingest] skip duplicate AI reply', {
                    aiReplyDedupKey,
                    threadId: thread.id,
                  })
                } else {
                  await scheduleAiReplyFromIngest({
                    orgId: session.org_id,
                    sessionId: session.id,
                    chatId: sendChatId,
                    contactId,
                    threadId: thread.id,
                    text: textForAiInsert,
                    delayAfterAutoReplies: totalDelaySec,
                    autoRepliesWereSent,
                    aiReplyDedupeKey,
                  })
                }
                if (responder === 'none') responder = 'ai'
              } else if (skipAiThisInbound) {
                console.info('[ingest] IA omitida este turno (orquestación)', {
                  threadId: thread.id,
                  responder,
                  aiEnabledAtStart,
                })
              }

              // Vigilante: clasifica/etiqueta. Nunca arranca flujos con saludo,
              // producto en foco, bienvenida, o si ya hubo dueño de respuesta.
              if (realInboundText) {
                try {
                  const skipWatcherFlows =
                    greetingOnly ||
                    !!focusedProductId ||
                    responder === 'welcome_flow' ||
                    responder === 'product_entry' ||
                    responder === 'auto_reply' ||
                    responder === 'generic_flow' ||
                    responder === 'ai' ||
                    aiEnabledAtStart
                  const { runIntentWatcher } = await import('@/lib/intent-watcher.server')
                  void runIntentWatcher({
                    orgId: session.org_id,
                    contactId,
                    threadId: thread.id,
                    text: realInboundText,
                    trigger: 'message',
                    skipFlowStart: skipWatcherFlows,
                  }).catch((err) => {
                    console.warn('[ingest] watcher:', (err as Error)?.message)
                  })
                } catch (_) { /* ignore */ }
              }

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
                  if (rule.limit_per_contact && rule.limit_per_contact > 0) {
                    const { count } = await supabaseAdmin
                      .from('no_response_pending')
                      .select('id', { count: 'exact', head: true })
                      .eq('rule_id', rule.id)
                      .eq('thread_id', thread.id)
                      .not('fired_at', 'is', null)
                    if ((count ?? 0) >= rule.limit_per_contact) continue
                  }
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
              } catch (_) { /* ignore */ }

              try {
                const { data: runsToResume, error: fetchErr } = await dyn()
                  .from('flow_runs')
                  .select('*')
                  .eq('contact_id', contactId)
                  .in('status', ['active', 'wait_node'])
                if (!fetchErr && runsToResume && runsToResume.length > 0) {
                  const nowStr = new Date().toISOString()
                  for (const run of runsToResume) {
                    const { data: updatedRun } = await dyn()
                      .from('flow_runs')
                      .update({
                        status: 'active',
                        next_execution_at: nowStr,
                        last_interaction_at: nowStr,
                        updated_at: nowStr,
                      })
                      .eq('id', run.id)
                      .select()
                      .single()
                    if (updatedRun) {
                      console.info('[ingest] Resumiendo flujo inmediatamente por interacción del cliente', {
                        runId: updatedRun.id,
                        contactId,
                      })
                      const { processRunUntilWaitOrCompleted } = await import('@/lib/flow-runner.server')
                      await processRunUntilWaitOrCompleted(updatedRun)
                    }
                  }
                }
              } catch (resumeErr: any) {
                console.error('[ingest] Error al resumir flujo inmediatamente:', resumeErr.message)
              }

              console.info('[ingest] orquestación turno', {
                threadId: thread.id,
                responder,
                greetingOnly,
                focusedProductId,
                skipAiThisInbound,
              })
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
