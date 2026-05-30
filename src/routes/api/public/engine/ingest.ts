import { createFileRoute } from '@tanstack/react-router'
import { supabaseAdmin } from '@/integrations/supabase/client.server'
import { z } from 'zod'

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

function normalizeEvent(e: z.infer<typeof EventSchema>): NormalizedEvent {
  const rawType = String(e.type || '')
  const type: NormalizedEvent['type'] = TYPE_MAP[rawType] ?? 'status'
  const p: Record<string, any> = (e.payload as any) || {}

  const chatId = e.chatId ?? p.chatId ?? p.from ?? p.to
  const waMessageId = e.waMessageId ?? p.waMessageId ?? p.messageId ?? p.message_id ?? p.id
  let direction: 'in' | 'out' | undefined = e.direction ?? p.direction
  if (!direction) {
    if (typeof p.fromMe === 'boolean') direction = p.fromMe ? 'out' : 'in'
    else if (type === 'message-in') direction = 'in'
    else if (type === 'message-out') direction = 'out'
  }
  const text = e.text ?? p.text ?? p.body ?? p.content
  const sentAt = toIso(e.sentAt) ?? toIso(p.sentAt) ?? toIso(p.timestamp) ?? toIso(p.t)

  let contact = e.contact
  if (!contact) {
    const waSource: string | undefined =
      (direction === 'out' ? p.to : p.from) ?? p.from ?? p.to ?? (chatId as string | undefined)
    if (waSource) {
      const waId = String(waSource).split('@')[0]
      if (waId) contact = { waId, displayName: p.notifyName ?? p.pushname, phone: p.phone }
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

async function maybeAutoReply(orgId: string, sessionId: string, chatId: string, text: string) {
  const { data: rules } = await supabaseAdmin
    .from('auto_replies')
    .select('id, match_type, match_value, reply_text, cooldown_seconds, last_triggered_at, session_id')
    .eq('org_id', orgId)
    .eq('is_active', true)
  if (!rules?.length) return
  const lower = text.toLowerCase()
  for (const r of rules) {
    if (r.session_id && r.session_id !== sessionId) continue
    const v = (r.match_value || '').toLowerCase()
    let hit = false
    try {
      if (r.match_type === 'equals') hit = lower === v
      else if (r.match_type === 'starts') hit = lower.startsWith(v)
      else if (r.match_type === 'regex') hit = new RegExp(r.match_value, 'i').test(text)
      else hit = lower.includes(v)
    } catch {
      hit = false
    }
    if (!hit) continue
    if (r.last_triggered_at) {
      const diff = (Date.now() - new Date(r.last_triggered_at).getTime()) / 1000
      if (diff < (r.cooldown_seconds ?? 0)) continue
    }
    await supabaseAdmin.from('engine_commands').insert({
      org_id: orgId,
      session_id: sessionId,
      type: 'send_message',
      payload: { chatId, text: r.reply_text },
      status: 'pending',
    })
    await supabaseAdmin
      .from('auto_replies')
      .update({ last_triggered_at: new Date().toISOString() })
      .eq('id', r.id)
    return // one rule per message
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
          .select('id, org_id')
          .eq('session_token', token)
          .maybeSingle()
        if (sErr || !session) return json(401, { error: 'Invalid session token' })

        await supabaseAdmin
          .from('wa_sessions')
          .update({ status: 'connected', last_heartbeat_at: new Date().toISOString() })
          .eq('id', session.id)

        const normalized = parsed.data.events.map(normalizeEvent)

        const eventRows = normalized.map((e, i) => ({
          org_id: session.org_id,
          session_id: session.id,
          type: e.type,
          payload: parsed.data.events[i] as unknown as never,
        }))
        await supabaseAdmin.from('events').insert(eventRows)

        for (const e of normalized) {
          if ((e.type === 'message-in' || e.type === 'message-out') && e.chatId) {
            const waId = e.contact?.waId ?? String(e.chatId).split('@')[0]
            const { data: contact } = await supabaseAdmin
              .from('contacts')
              .upsert(
                {
                  org_id: session.org_id,
                  wa_id: waId,
                  display_name: e.contact?.displayName ?? null,
                  phone: e.contact?.phone ?? null,
                },
                { onConflict: 'org_id,wa_id' },
              )
              .select('id')
              .single()
            if (!contact) continue

            const { data: thread } = await supabaseAdmin
              .from('threads')
              .upsert(
                {
                  org_id: session.org_id,
                  session_id: session.id,
                  contact_id: contact.id,
                  last_message_at: e.sentAt ?? new Date().toISOString(),
                },
                { onConflict: 'session_id,contact_id' },
              )
              .select('id')
              .single()
            if (!thread) continue
            await supabaseAdmin.from('messages').insert({
              org_id: session.org_id,
              thread_id: thread.id,
              wa_message_id: e.waMessageId ?? null,
              direction: e.direction ?? (e.type === 'message-in' ? 'in' : 'out'),
              text: e.text ?? null,
              media: e.media ?? null,
              raw: e.raw ?? null,
              sent_at: e.sentAt ?? new Date().toISOString(),
            })

            if ((e.direction ?? (e.type === 'message-in' ? 'in' : 'out')) === 'in' && e.text) {
              await maybeAutoReply(session.org_id, session.id, e.chatId, e.text)
            }
          } else if (e.type === 'ack' && e.commandId) {
            await supabaseAdmin
              .from('engine_commands')
              .update({ status: 'acked', ack: e.ackStatus ?? 'ok', acked_at: new Date().toISOString() })
              .eq('id', e.commandId)
              .eq('session_id', session.id)
          }
        }



        return json(200, { ok: true, processed: parsed.data.events.length })
      },
    },
  },
})
