import { createFileRoute } from '@tanstack/react-router'
import { supabaseAdmin } from '@/integrations/supabase/client.server'
import { generateReply } from '@/lib/ai.server'
import { sanitizeMessageText } from '@/lib/message-text'
import { z } from 'zod'

const dyn = () => supabaseAdmin as unknown as { from: (t: string) => any }

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
      })
      .optional(),
    sentAt: z.union([z.string(), z.number()]).optional(),
    commandId: z.string().uuid().optional(),
    ackStatus: z.string().max(32).optional(),
    payload: z.record(z.string(), z.any()).optional(),
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
  contact?: { waId: string; displayName?: string; phone?: string }
  sentAt?: string
  commandId?: string
  ackStatus?: string
}

const TYPE_MAP: Record<string, NormalizedEvent['type']> = {
  'message-in': 'message-in',
  'message-out': 'message-out',
  heartbeat: 'heartbeat',
  status: 'status',
  ack: 'ack',
  NEW_MESSAGE: 'message-in',
  MESSAGE_SENT: 'message-out',
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

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
  'application/octet-stream': 'bin',
}

function normalizeMimeType(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase()
}

function extensionFromMime(mimeType: string, msgType?: string): string {
  const normalized = normalizeMimeType(mimeType)
  const mapped = MIME_TO_EXTENSION[normalized]
  if (mapped) return mapped

  const subtype = normalized.split('/')[1]
  if (subtype && /^[a-z0-9.+-]+$/i.test(subtype)) {
    const clean = subtype.replace(/[^a-z0-9]/gi, '').slice(0, 16)
    if (clean) return clean
  }

  if (msgType === 'ptt' || msgType === 'audio') return 'ogg'
  if (msgType === 'image') return 'jpg'
  if (msgType === 'video') return 'mp4'
  if (msgType === 'document') return 'pdf'
  return 'bin'
}

function parseBase64Media(
  base64Raw: string,
  fallbackMime: string,
): { mimeType: string; base64String: string } {
  let base64String = base64Raw.trim()
  let mimeType = normalizeMimeType(fallbackMime || 'application/octet-stream')

  const dataUriMatch = base64String.match(/^data:([^;]+);base64,(.+)$/i)
  if (dataUriMatch) {
    mimeType = normalizeMimeType(dataUriMatch[1])
    base64String = dataUriMatch[2]
  }

  base64String = base64String.replace(/\s/g, '')
  return { mimeType, base64String }
}

async function processMediaUpload(
  media: Record<string, unknown> | null | undefined,
  orgId: string,
): Promise<Record<string, unknown> | null> {
  if (!media) return null

  const base64Raw = media.base64 as string | undefined
  if (!base64Raw) return media

  try {
    const msgType = typeof media.type === 'string' ? media.type : undefined
    const { mimeType, base64String } = parseBase64Media(
      base64Raw,
      (media.mimetype as string) || 'application/octet-stream',
    )

    if (!base64String) {
      console.error('[ingest] media: payload base64 vacío tras limpiar Data URI')
      return media
    }

    const bytes = Buffer.from(base64String, 'base64')
    if (!bytes.length) {
      console.error('[ingest] media: decodificación resultó en 0 bytes')
      return media
    }

    const ext = extensionFromMime(mimeType, msgType)
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    const path = `${orgId}/${fileName}`

    const { error: upErr } = await supabaseAdmin.storage
      .from('media')
      .upload(path, bytes, { contentType: mimeType, upsert: false })
    if (upErr) {
      console.error('[ingest] media upload error:', upErr.message)
      return media
    }

    const { data: urlData } = supabaseAdmin.storage.from('media').getPublicUrl(path)
    return {
      url: urlData.publicUrl,
      mimeType,
      caption: (media.caption as string) || undefined,
      filename: fileName,
      size: bytes.length,
    }
  } catch (err) {
    console.error('[ingest] media processing error:', (err as Error).message)
    return media
  }
}

function digits(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).split('@')[0].replace(/\D/g, '')
  return s || undefined
}

function normalizeWaKey(v: unknown): string | undefined {
  if (v == null) return undefined
  const raw = String(v).trim()
  if (!raw) return undefined
  const base = raw.split('@')[0].replace(/\D/g, '')
  if (!base) return undefined
  return raw.includes('@lid') ? `${base}@lid` : base
}

function isLidKey(v?: string | null): boolean {
  return Boolean(v && v.endsWith('@lid'))
}

function pickDisplayName(name: unknown, waId?: string, phone?: string): string | undefined {
  const clean = typeof name === 'string' ? name.trim() : ''
  if (clean && clean.toLowerCase() !== 'unknown') return clean
  return phone ?? waId?.replace(/@lid$/, '')
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
    }
   } else if (contact && meWaId && digits(contact.waId) === meWaId && counterpart) {
     contact = {
       waId: counterpart,
       displayName: pickDisplayName(contact.displayName, counterpart, counterpartPhone),
       phone: counterpartPhone,
     }
   } else if (contact) {
     const normalizedWaId = normalizeWaKey(contact.waId) ?? counterpart
     const normalizedPhone = contact.phone ? digits(contact.phone) : counterpartPhone
     if (normalizedWaId) {
       contact = {
         waId: normalizedWaId,
         displayName: pickDisplayName(contact.displayName, normalizedWaId, normalizedPhone),
         phone: !isLidKey(normalizedWaId) ? normalizedPhone ?? digits(normalizedWaId) : normalizedPhone,
       }
     }
  }

  const commandId = e.commandId ?? p.commandId
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
): Promise<{ aiDisabled: boolean }> {
  const { data: rules } = await supabaseAdmin
    .from('auto_replies')
    .select(
      'id, match_type, match_value, reply_text, cooldown_seconds, last_triggered_at, session_id, trigger_type, media_url, mime_type, action_add_tags, action_remove_tags, action_ai_behavior',
    )
    .eq('org_id', orgId)
    .eq('is_active', true);
  if (!rules?.length) return { aiDisabled: false };

  const lower = text.toLowerCase();
  for (const raw of rules as unknown[] as AutoReplyRule[]) {
    if (raw.session_id && raw.session_id !== sessionId) continue;

    const triggerType = raw.trigger_type || 'keyword';
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
      const v = (raw.match_value || '').toLowerCase();
      try {
        if (raw.match_type === 'equals') hit = lower === v;
        else if (raw.match_type === 'starts') hit = lower.startsWith(v);
        else if (raw.match_type === 'regex') hit = new RegExp(raw.match_value, 'i').test(text);
        else hit = lower.includes(v);
      } catch {
        hit = false;
      }
    }

    if (!hit) continue;
    if (raw.last_triggered_at) {
      const diff = (Date.now() - new Date(raw.last_triggered_at).getTime()) / 1000;
      if (diff < (raw.cooldown_seconds ?? 0)) continue;
    }

    // Send text or media
    if (raw.media_url) {
      await supabaseAdmin.from('engine_commands').insert({
        org_id: orgId,
        session_id: sessionId,
        type: 'send_media',
        payload: { chatId, mediaUrl: raw.media_url, mimeType: raw.mime_type, caption: raw.reply_text },
        status: 'pending',
      });
    } else {
      await supabaseAdmin.from('engine_commands').insert({
        org_id: orgId,
        session_id: sessionId,
        type: 'send_message',
        payload: { chatId, text: raw.reply_text },
        status: 'pending',
      });
    }

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
    return { aiDisabled };
  }
  return { aiDisabled: false };
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

  if (!text?.trim()) return { contactId: existing?.id ?? null, phone: null }

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

async function maybeAiReply(
  orgId: string,
  sessionId: string,
  chatId: string,
  contactId: string,
  threadId: string,
  text: string,
) {
  const { data: thread } = await supabaseAdmin
    .from('threads')
    .select('ai_enabled')
    .eq('id', threadId)
    .maybeSingle();

  // If AI is disabled, re-enable it for next message and skip this one
  if ((thread as unknown as { ai_enabled?: boolean })?.ai_enabled === false) {
    await supabaseAdmin.from('threads').update({ ai_enabled: true } as unknown as Record<string, unknown>).eq('id', threadId);
    return;
  }

  const { data: cfg } = await supabaseAdmin
    .from('ai_configs')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle()
  if (!cfg || !cfg.enabled) return

  if (cfg.respond_to === 'new') {
    const { count } = await supabaseAdmin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', threadId)
      .eq('direction', 'out')
    if ((count ?? 0) > 0) return
  }

  // Get short history (last 10)
  const { data: hist } = await supabaseAdmin
    .from('messages')
    .select('direction, text')
    .eq('thread_id', threadId)
    .not('text', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(10)
  const history = (hist ?? [])
    .reverse()
    .slice(0, -1)
    .map((m: unknown) => ({
      role: ((m as { direction: string }).direction === 'out' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: String((m as { text: unknown }).text),
    }))

  try {
    const reply = await generateReply(cfg as { provider: 'lovable' | 'vertex'; model: string; system_prompt: string; knowledge_base: string; vertex_project?: string | null; vertex_location?: string | null; vertex_model?: string | null }, text, history)
    if (!reply?.trim()) return
    await supabaseAdmin.from('engine_commands').insert({
      org_id: orgId,
      session_id: sessionId,
      type: 'send_message',
      payload: { chatId, text: reply.trim() },
      status: 'pending',
    })
  } catch (err) {
    console.error('[ai-reply] error', err)
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
        const parsed = PayloadSchema.safeParse(body)
        if (!parsed.success) return json(400, { error: 'Invalid payload', issues: parsed.error.issues })

        const { data: session, error: sErr } = await supabaseAdmin
          .from('wa_sessions')
          .select('id, org_id, me_wa_id, default_agent_id, default_flow_id')
          .eq('session_token', token)
          .maybeSingle()
        if (sErr || !session) return json(401, { error: 'Invalid session token' })

        // Extract telemetry from the first heartbeat/session_ready event
        const telemetryEvent = parsed.data.events.find(
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
        const normalized = parsed.data.events.map((ev) => normalizeEvent(ev, meWaId))

        const eventRows = normalized.map((e, i) => ({
          org_id: session.org_id,
          session_id: session.id,
          type: e.type,
          payload: parsed.data.events[i] as unknown as never,
        }))
        await supabaseAdmin.from('events').insert(eventRows)

        for (const e of normalized) {
          if ((e.type === 'message-in' || e.type === 'message-out') && e.chatId) {
            const waId = e.contact?.waId ?? normalizeWaKey(e.chatId)
            if (!waId) continue

            let contactId: string | null = null
            let phone = e.contact?.phone ?? null

            if (!phone && isLidKey(waId)) {
              const resolved = await resolvePhoneForLidMessage({
                orgId: session.org_id,
                sessionId: session.id,
                waId,
                text: e.text,
                sentAt: e.sentAt,
              })
              contactId = resolved.contactId
              phone = resolved.phone
            }

            if (phone) {
              const { data: byPhone } = await supabaseAdmin
                .from('contacts')
                .select('id, wa_id')
                .eq('org_id', session.org_id)
                .eq('phone', phone)
                .maybeSingle()
              if (byPhone) {
                contactId = byPhone.id
                if (byPhone.wa_id !== waId || !e.contact?.displayName) {
                  await supabaseAdmin
                    .from('contacts')
                    .update({
                      wa_id: waId,
                      display_name: e.contact?.displayName ?? phone,
                      phone,
                    })
                    .eq('id', byPhone.id)
                }
              }
            }

            if (!contactId) {
              const { data: byWa } = await supabaseAdmin
                .from('contacts')
                .upsert(
                  {
                    org_id: session.org_id,
                    wa_id: waId,
                    display_name: e.contact?.displayName ?? phone ?? waId.replace(/@lid$/, ''),
                    phone,
                  },
                  { onConflict: 'org_id,wa_id' },
                )
                .select('id')
                .single()
              contactId = byWa?.id ?? null
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
              .select('id')
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
            const enrichedMedia = await processMediaUpload(
              e.media as Record<string, unknown> | undefined,
              session.org_id,
            )

            if (e.media && !enrichedMedia) {
              console.warn('[ingest] ⚠️ Media PERDIDA en processMediaUpload. Input:', {
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

            const direction = e.direction ?? (e.type === 'message-in' ? 'in' : 'out')
            if (direction === 'out' && e.text) {
              const since = new Date(Date.now() - 15_000).toISOString()
              const { data: recentOut } = await supabaseAdmin
                .from('messages')
                .select('id, wa_message_id')
                .eq('thread_id', thread.id)
                .eq('direction', 'out')
                .eq('text', e.text)
                .gte('sent_at', since)
                .order('sent_at', { ascending: false })
                .limit(1)
                .maybeSingle()
              if (recentOut?.wa_message_id?.startsWith('pending-')) {
                await supabaseAdmin
                  .from('messages')
                  .update({
                    wa_message_id: e.waMessageId ?? recentOut.wa_message_id,
                    media: (enrichedMedia as any) ?? undefined,
                  })
                  .eq('id', recentOut.id)
                continue
              }
              if (recentOut && e.waMessageId && recentOut.wa_message_id === e.waMessageId) {
                continue
              }
            }

            await supabaseAdmin.from('messages').insert({
              org_id: session.org_id,
              thread_id: thread.id,
              wa_message_id: e.waMessageId ?? null,
              direction: e.direction ?? (e.type === 'message-in' ? 'in' : 'out'),
              text: e.text ?? null,
              media: enrichedMedia as any,
              raw: (e.raw as any) ?? null,
              sent_at: e.sentAt ?? new Date().toISOString(),
            })

            if ((e.direction ?? (e.type === 'message-in' ? 'in' : 'out')) === 'in' && e.text) {
              // Use phone@c.us when we have a real phone (avoids @lid issues)
              const sendChatId = e.contact?.phone
                ? `${e.contact.phone}@c.us`
                : /^\d+$/.test(waId)
                  ? `${waId}@c.us`
                  : e.chatId
              const { aiDisabled } = await maybeAutoReply(session.org_id, session.id, sendChatId, e.text, thread.id, contactId)
              if (!aiDisabled) {
                await maybeAiReply(session.org_id, session.id, sendChatId, contactId, thread.id, e.text)
              }

              // Keyword flow enrollment (wrapped to avoid breaking bridge on DB errors)
              try {
                const { data: keywordFlows } = await dyn()
                  .from('flows')
                  .select('id')
                  .eq('org_id', session.org_id)
                  .eq('trigger_type', 'keyword')
                  .eq('is_active', true);
                for (const flow of keywordFlows ?? []) {
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
                    await dyn()
                      .from('flow_runs')
                      .upsert({
                        org_id: session.org_id,
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

                // Update last_interaction_at for active/wait_node flow runs
                await dyn()
                  .from('flow_runs')
                  .update({ last_interaction_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                  .eq('contact_id', contactId)
                  .in('status', ['active', 'wait_node']);
              } catch (flowErr: any) {
                console.error('[ingest] flow error (non-fatal):', flowErr.message);
              }
            }

          } else if (e.type === 'ack' && e.commandId) {
            const ackStatus = e.ackStatus ?? 'ok';
            const isFailed = ackStatus === 'failed' || ackStatus === 'error';
            await supabaseAdmin
              .from('engine_commands')
              .update({ status: isFailed ? 'failed' : 'acked', ack: ackStatus, acked_at: new Date().toISOString() })
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
        }



        return json(200, { ok: true, processed: parsed.data.events.length })
      },
    },
  },
})
