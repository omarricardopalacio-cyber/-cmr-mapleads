import { createFileRoute } from '@tanstack/react-router'
import { supabaseAdmin } from '@/integrations/supabase/client.server'

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

/** Heartbeat liviano para la extensión (antes caía en el catch-all → Failed to fetch silencioso). */
export const Route = createFileRoute('/api/public/engine/heartbeat')({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const token = request.headers.get('x-session-token')
        if (!token) return json(401, { error: 'Missing session token' })

        const { data: session, error: sErr } = await supabaseAdmin
          .from('wa_sessions')
          .select('id')
          .eq('session_token', token)
          .maybeSingle()
        if (sErr || !session) return json(401, { error: 'Invalid session token' })

        let device: Record<string, unknown> = {}
        try {
          const body = await request.json()
          if (body && typeof body === 'object') device = body as Record<string, unknown>
        } catch {
          /* body opcional */
        }

        const patch: Record<string, unknown> = {
          status: 'connected',
          last_heartbeat_at: new Date().toISOString(),
        }
        if (typeof device.phoneNumber === 'string' && device.phoneNumber.trim()) {
          patch.phone_number = String(device.phoneNumber).replace(/\D/g, '')
        }
        if (typeof device.deviceName === 'string') patch.device_name = device.deviceName
        if (typeof device.platform === 'string') patch.platform = device.platform
        if (typeof device.batteryLevel === 'number') patch.battery_level = device.batteryLevel

        await supabaseAdmin.from('wa_sessions').update(patch as any).eq('id', session.id)

        return json(200, { ok: true, sessionId: session.id })
      },
    },
  },
})
