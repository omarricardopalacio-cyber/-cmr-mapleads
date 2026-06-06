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

        await supabaseAdmin
          .from('wa_sessions')
          .update({ status: 'connected', last_heartbeat_at: new Date().toISOString() })
          .eq('id', session.id)

        const now = new Date().toISOString()
        console.log('[commands] polling pending engine_commands', { sessionId: session.id, now })
        const { data: pending, error: queryError } = await supabaseAdmin
          .from('engine_commands')
          .select('id, type, payload, attempts')
          .eq('session_id', session.id)
          .eq('status', 'pending')
          .or(`scheduled_for.is.null,scheduled_for.lte.${now}`)
          .order('created_at', { ascending: true })
          .limit(20)

        if (queryError) {
          console.error('[commands] error fetching engine_commands', queryError)
          return json(500, { error: 'Failed to fetch engine commands' })
        }

        let commands = pending ?? []

        // Normalize command types so extension receives uppercase names.
        const commandTypeMap: Record<string, string> = {
          send_message: 'SEND_MESSAGE',
          send_media: 'SEND_MEDIA',
          send_broadcast: 'SEND_BROADCAST',
          get_chats: 'GET_CHATS',
          get_contacts: 'GET_CONTACTS',
          update_label: 'UPDATE_LABEL',
          ping: 'PING',
        };

        // If a command is send_media and mediaUrl is a relative path in our bucket, sign it
        commands = await Promise.all(
          commands.map(async (c) => {
            const normalizedType = typeof c.type === 'string' ? commandTypeMap[c.type] ?? c.type.toUpperCase() : c.type;
            if (normalizedType === 'SEND_MEDIA' && c.payload && typeof c.payload === 'object') {
              const p = c.payload as any;
              if (p.mediaUrl && typeof p.mediaUrl === 'string' && !p.mediaUrl.startsWith('http')) {
                try {
                  const { data: signed } = await supabaseAdmin.storage
                    .from('auto-reply-media')
                    .createSignedUrl(p.mediaUrl, 3600);
                  if (signed?.signedUrl) {
                    const res = await fetch(signed.signedUrl);
                    if (res.ok) {
                      const arrayBuffer = await res.arrayBuffer();
                      const base64 = Buffer.from(arrayBuffer).toString('base64');
                      const mimeType = res.headers.get("content-type") || p.mimeType;
                      const dataUri = `data:${mimeType};base64,${base64}`;
                      return { ...c, type: normalizedType, payload: { ...p, mediaUrl: dataUri } };
                    }
                  }
                } catch (err) {
                  console.error('[commands] error signing/fetching url:', err);
                }
              }
            }

            return { ...c, type: normalizedType };
          })
        );

        console.log('[commands] pending commands count', { count: commands.length })
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

        return json(200, { commands })
      },
    },
  },
})
