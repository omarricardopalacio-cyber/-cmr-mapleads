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

const EventSchema = z.object({
  type: z.enum(['message-in', 'message-out', 'heartbeat', 'status', 'ack']),
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
  sentAt: z.string().datetime().optional(),
  commandId: z.string().uuid().optional(),
  ackStatus: z.string().max(32).optional(),
})

const PayloadSchema = z.object({
  events: z.array(EventSchema).min(1).max(50),
})

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
          .update({ status: 'online', last_heartbeat_at: new Date().toISOString() })
          .eq('id', session.id)

        const eventRows = parsed.data.events.map((e) => ({
          org_id: session.org_id,
          session_id: session.id,
          type: e.type,
          payload: e as unknown as Record<string, unknown>,
        }))
        await supabaseAdmin.from('events').insert(eventRows)

        for (const e of parsed.data.events) {
          if ((e.type === 'message-in' || e.type === 'message-out') && e.chatId) {
            const waId = e.contact?.waId ?? e.chatId
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
                { onConflict: 'org_id,session_id,contact_id' },
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
