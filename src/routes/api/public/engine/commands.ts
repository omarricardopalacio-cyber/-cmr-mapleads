import { createFileRoute } from '@tanstack/react-router'
import { supabaseAdmin } from '@/integrations/supabase/client.server'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token',
  'Access-Control-Max-Age': '86400',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })

const commandTypeMap: Record<string, string> = {
  send_message: 'SEND_MESSAGE',
  send_media: 'SEND_MEDIA',
  send_broadcast: 'SEND_BROADCAST',
  get_chats: 'GET_CHATS',
  get_contacts: 'GET_CONTACTS',
  update_label: 'UPDATE_LABEL',
  ping: 'PING',
}

/**
 * Polling liviano: NO descarga media aquí.
 * Antes se convertía mediaUrl→dataURI en cada poll y eso hacía timeout de Netlify
 * → el SW veía "Failed to fetch" y marcaba DESCONECTADO.
 * La extensión / WhatsApp resuelven la URL al enviar.
 */
export const Route = createFileRoute('/api/public/engine/commands')({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const token = request.headers.get('x-session-token')
        if (!token) return json(401, { error: 'Missing session token' })

        const { data: session, error: sErr } = await supabaseAdmin
          .from('wa_sessions')
          .select('id, org_id')
          .eq('session_token', token)
          .maybeSingle()
        if (sErr || !session) return json(401, { error: 'Invalid session token' })

        const now = new Date().toISOString()

        const [pendingNullResult, pendingDueResult] = await Promise.all([
          supabaseAdmin
            .from('engine_commands')
            .select('id, type, payload, attempts, created_at')
            .eq('session_id', session.id)
            .eq('status', 'pending')
            .is('scheduled_for', null)
            .order('created_at', { ascending: true })
            .limit(10),
          supabaseAdmin
            .from('engine_commands')
            .select('id, type, payload, attempts, created_at')
            .eq('session_id', session.id)
            .eq('status', 'pending')
            .lte('scheduled_for', now)
            .order('created_at', { ascending: true })
            .limit(10),
        ])

        if (pendingNullResult.error || pendingDueResult.error) {
          console.error(
            '[commands] error fetching engine_commands',
            pendingNullResult.error ?? pendingDueResult.error,
          )
          return json(500, { error: 'Failed to fetch engine commands' })
        }

        const commands = [...(pendingNullResult.data ?? []), ...(pendingDueResult.data ?? [])]
          .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
          .slice(0, 10)
          .map(({ created_at: _c, ...command }) => {
            const normalizedType =
              typeof command.type === 'string'
                ? commandTypeMap[command.type] ?? command.type.toUpperCase()
                : command.type
            return { ...command, type: normalizedType }
          })

        if (commands.length > 0) {
          const ids = commands.map((c) => c.id)
          await supabaseAdmin
            .from('engine_commands')
            .update({
              status: 'delivered',
              delivered_at: new Date().toISOString(),
            })
            .in('id', ids)
        }

        return json(200, { commands, serverTime: now })
      },
    },
  },
})
