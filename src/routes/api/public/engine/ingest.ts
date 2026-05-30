import { createFileRoute } from '@tanstack/react-router'
import { supabaseAdmin } from '@/integrations/supabase/client.server'
import { generateReply } from '@/lib/ai.server'
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

function normalizeEvent(e: z.infer<typeof EventSchema>, meWaId?: string | null): NormalizedEvent {
  const rawType = String(e.type || '')
  const type: NormalizedEvent['type'] = TYPE_MAP[rawType] ?? 'status'
  const p: Record<string, any> = (e.payload as any) || {}

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

  const text = e.text ?? p.text ?? p.body ?? p.content
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

async function maybeAiReply(
  orgId: string,
  sessionId: string,
  chatId: string,
  contactId: string,
  threadId: string,
  text: string,
) {
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
    .map((m: any) => ({
      role: (m.direction === 'out' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: String(m.text),
    }))

  try {
    const reply = await generateReply(cfg as any, text, history)
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
          .select('id, org_id, me_wa_id')
          .eq('session_token', token)
          .maybeSingle()
        if (sErr || !session) return json(401, { error: 'Invalid session token' })

        await supabaseAdmin
          .from('wa_sessions')
          .update({ status: 'connected', last_heartbeat_at: new Date().toISOString() })
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
            const phone = e.contact?.phone ?? null

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
              media: (e.media as any) ?? null,
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
              await maybeAutoReply(session.org_id, session.id, sendChatId, e.text)
              await maybeAiReply(session.org_id, session.id, sendChatId, contactId, thread.id, e.text)
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
