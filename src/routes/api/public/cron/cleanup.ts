// @ts-nocheck
import { createFileRoute } from '@tanstack/react-router'
import { supabaseAdmin } from '@/integrations/supabase/client.server'
import { storagePathFromMediaUrl } from '@/lib/media'

const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

/**
 * Limpieza / retencion para controlar el consumo de espacio.
 * - Borra filas de auditoria/logs mas antiguas que AUDIT_RETENTION_DAYS (def. 30).
 * - Si MEDIA_RETENTION_DAYS > 0, borra del Storage el media de mensajes mas
 *   antiguos que ese umbral y limpia la referencia (def. 0 = desactivado).
 * Protegido con CRON_SECRET (igual que /cron/dispatch). Agendar 1 vez al dia.
 */
async function handler({ request }: { request: Request }) {
  const CRON_SECRET = process.env.CRON_SECRET || process.env.SUPABASE_ANON_KEY
  if (!CRON_SECRET) return json(500, { error: 'server not configured: CRON_SECRET/SUPABASE_ANON_KEY missing' })
  const raw = request.headers.get('apikey') ?? request.headers.get('authorization') ?? ''
  const apikey = raw.replace(/^Bearer\s+/i, '').trim()
  if (!apikey || !timingSafeStringEqual(apikey, CRON_SECRET)) {
    return json(401, { error: 'invalid apikey' })
  }

  const auditDays = Number(process.env.AUDIT_RETENTION_DAYS ?? '30')
  const mediaDays = Number(process.env.MEDIA_RETENTION_DAYS ?? '0')
  const auditCutoff = new Date(Date.now() - auditDays * 86400000).toISOString()
  const result: Record<string, unknown> = { auditRetentionDays: auditDays, mediaRetentionDays: mediaDays }

  // ---- Retencion de logs/auditoria en la BD ----
  try {
    const { count } = await supabaseAdmin
      .from('events')
      .delete({ count: 'exact' })
      .lt('created_at', auditCutoff)
    result.events_deleted = count ?? 0
  } catch (e) { result.events_deleted = 'skip' }

  try {
    const { count } = await supabaseAdmin
      .from('engine_commands')
      .delete({ count: 'exact' })
      .in('status', ['acked', 'failed', 'delivered'])
      .lt('created_at', auditCutoff)
    result.engine_commands_deleted = count ?? 0
  } catch (e) { result.engine_commands_deleted = 'skip' }

  try {
    const { count } = await supabaseAdmin
      .from('ai_actions_log')
      .delete({ count: 'exact' })
      .lt('created_at', auditCutoff)
    result.ai_actions_log_deleted = count ?? 0
  } catch (e) { result.ai_actions_log_deleted = 'skip' }

  // ---- Retencion de media en Storage (opcional) ----
  if (mediaDays > 0) {
    const mediaCutoff = new Date(Date.now() - mediaDays * 86400000).toISOString()
    const { data: oldMsgs } = await supabaseAdmin
      .from('messages')
      .select('id, media')
      .not('media', 'is', null)
      .lt('sent_at', mediaCutoff)
      .limit(1000)

    const paths: string[] = []
    const ids: string[] = []
    for (const row of (oldMsgs ?? []) as Array<{ id: string; media: unknown }>) {
      let media = row.media as Record<string, unknown> | string | null
      if (typeof media === 'string') { try { media = JSON.parse(media) } catch { media = null } }
      if (media && typeof media === 'object') {
        const m = media as Record<string, unknown>
        const p = (typeof m.storagePath === 'string' && m.storagePath) ||
          (typeof m.url === 'string' ? storagePathFromMediaUrl(m.url) : null)
        if (p) paths.push(p)
      }
      ids.push(row.id)
    }

    let removedFiles = 0
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100)
      const { error } = await supabaseAdmin.storage.from('media').remove(chunk)
      if (!error) removedFiles += chunk.length
    }
    // Limpiar la referencia de media en los mensajes procesados
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      await supabaseAdmin
        .from('messages')
        .update({ media: { url: null, expired: true } })
        .in('id', chunk)
    }
    result.media_files_deleted = removedFiles
    result.media_messages_cleared = ids.length
  }

  return json(200, { ok: true, ...result })
}

export const Route = createFileRoute('/api/public/cron/cleanup')({
  server: {
    handlers: {
      POST: handler,
      GET: handler,
    },
  },
})
