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

async function deleteRowsInBatches(
  table: string,
  buildSelect: () => any,
  batchSize = 500,
  maxRounds = 4,
) {
  let total = 0
  for (let i = 0; i < maxRounds; i++) {
    const { data, error: selectError } = await buildSelect().limit(batchSize)
    if (selectError) throw selectError
    const ids = (data ?? []).map((r: { id: string }) => r.id)
    if (!ids.length) break
    const { count, error: deleteError } = await supabaseAdmin
      .from(table)
      .delete({ count: 'exact' })
      .in('id', ids)
    if (deleteError) throw deleteError
    total += count ?? ids.length
    if (ids.length < batchSize) break
  }
  return total
}

const deleteEventsBefore = (cutoff: string) =>
  deleteRowsInBatches('events', () =>
    supabaseAdmin.from('events').select('id').lt('created_at', cutoff),
  )

/**
 * Limpieza / retencion para controlar el consumo de espacio.
 * - Borra filas de auditoria/logs mas antiguas que AUDIT_RETENTION_DAYS (def. 7).
 * - Si MEDIA_RETENTION_DAYS > 0, borra del Storage el media de mensajes mas
 *   antiguos que ese umbral y limpia la referencia (def. 5 dias; resto en PC).
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

  const auditDays = Number(process.env.AUDIT_RETENTION_DAYS ?? '7')
  // Limpiar Storage es costoso; solo hacerlo cuando el operador lo habilite.
  const mediaDays = Number(process.env.MEDIA_RETENTION_DAYS ?? '0')
  const auditCutoff = new Date(Date.now() - auditDays * 86400000).toISOString()
  const result: Record<string, unknown> = { auditRetentionDays: auditDays, mediaRetentionDays: mediaDays }

  try {
    result.events_deleted = await deleteEventsBefore(auditCutoff)
  } catch (e) {
    result.events_deleted = 'skip'
  }

  try {
    result.engine_commands_deleted = await deleteRowsInBatches(
      'engine_commands',
      () =>
        supabaseAdmin
          .from('engine_commands')
          .select('id')
          .in('status', ['acked', 'failed'])
          .lt('created_at', auditCutoff),
    )
  } catch (e) {
    result.engine_commands_deleted = 'skip'
  }

  try {
    result.ai_reply_pending_deleted = await deleteRowsInBatches(
      'ai_reply_pending',
      () =>
        supabaseAdmin
          .from('ai_reply_pending')
          .select('id')
          .or('processed_at.not.is.null,cancelled_at.not.is.null')
          .lt('created_at', auditCutoff),
    )
  } catch {
    result.ai_reply_pending_deleted = 'skip'
  }

  try {
    result.inbound_claims_deleted = await deleteRowsInBatches(
      'inbound_automation_claims',
      () =>
        supabaseAdmin
          .from('inbound_automation_claims')
          .select('id')
          .lt('created_at', auditCutoff),
    )
  } catch {
    result.inbound_claims_deleted = 'skip'
  }

  try {
    result.no_response_pending_deleted = await deleteRowsInBatches(
      'no_response_pending',
      () =>
        supabaseAdmin
          .from('no_response_pending')
          .select('id')
          .or('fired_at.not.is.null,cancelled_at.not.is.null')
          .lt('created_at', auditCutoff),
    )
  } catch {
    result.no_response_pending_deleted = 'skip'
  }

  try {
    const { count } = await supabaseAdmin
      .from('ai_actions_log')
      .delete({ count: 'exact' })
      .lt('created_at', auditCutoff)
    result.ai_actions_log_deleted = count ?? 0
  } catch (e) {
    result.ai_actions_log_deleted = 'skip'
  }

  if (mediaDays > 0) {
    const mediaCutoff = new Date(Date.now() - mediaDays * 86400000).toISOString()
    let removedFiles = 0
    let clearedMsgs = 0

    for (let round = 0; round < 20; round++) {
      const { data: oldMsgs } = await supabaseAdmin
        .from('messages')
        .select('id, media')
        .not('media', 'is', null)
        .lt('sent_at', mediaCutoff)
        .limit(500)

      if (!oldMsgs?.length) break

      const paths: string[] = []
      const ids: string[] = []
      for (const row of oldMsgs as Array<{ id: string; media: unknown }>) {
        let media = row.media as Record<string, unknown> | string | null
        if (typeof media === 'string') {
          try {
            media = JSON.parse(media)
          } catch {
            media = null
          }
        }
        if (media && typeof media === 'object') {
          const m = media as Record<string, unknown>
          const p =
            (typeof m.storagePath === 'string' && m.storagePath) ||
            (typeof m.url === 'string' ? storagePathFromMediaUrl(m.url) : null)
          if (p) paths.push(p)
        }
        ids.push(row.id)
      }

      for (let i = 0; i < paths.length; i += 100) {
        const chunk = paths.slice(i, i + 100)
        const { error } = await supabaseAdmin.storage.from('media').remove(chunk)
        if (!error) removedFiles += chunk.length
      }
      for (let i = 0; i < ids.length; i += 200) {
        await supabaseAdmin
          .from('messages')
          .update({ media: { url: null, expired: true } })
          .in('id', ids.slice(i, i + 200))
      }
      clearedMsgs += ids.length
    }

    result.media_files_deleted = removedFiles
    result.media_messages_cleared = clearedMsgs
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
