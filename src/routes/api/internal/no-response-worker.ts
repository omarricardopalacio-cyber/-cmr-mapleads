// @ts-nocheck
/**
 * Worker: No-Response Trigger
 * Se ejecuta cada 5 minutos vía pg_cron (Supabase).
 * 
 * Lógica:
 * 1. Cuando llega un mensaje INBOUND del cliente, el ingest.ts programa
 *    un "pending" en no_response_pending si hay reglas activas de tipo no_response.
 * 2. Este worker revisa qué pendings han expirado (fires_at <= now) y aún
 *    no han sido disparados ni cancelados, y les encola los mensajes.
 * 3. Si el cliente respondió después, el ingest.ts cancela el pending.
 */
import { createFileRoute } from '@tanstack/react-router'
import { supabaseAdmin } from '@/integrations/supabase/client.server'

export const Route = createFileRoute('/api/internal/no-response-worker')({
  async loader({ request }) {
    // Protección: sólo llamadas internas con el secret
    const authHeader = request.headers.get('Authorization') ?? ''
    const cronSecret = process.env.CRON_SECRET ?? ''
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return new Response('Unauthorized', { status: 401 })
    }

    try {
      const result = await runNoResponseWorker()
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (err: any) {
      console.error('[no-response-worker] error:', err)
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  },
})

async function runNoResponseWorker(): Promise<{ fired: number; skipped: number }> {
  const now = new Date().toISOString()
  let fired = 0
  let skipped = 0

  // Obtener todos los pendings vencidos
  const { data: pendings, error } = await supabaseAdmin
    .from('no_response_pending')
    .select(`
      id, org_id, rule_id, thread_id, contact_id, session_id, chat_id,
      auto_replies!rule_id (
        id, name, no_response_ai_scope, no_response_tag_id,
        action_add_tags, action_remove_tags, action_ai_behavior
      )
    `)
    .lte('fires_at', now)
    .is('fired_at', null)
    .is('cancelled_at', null)

  if (error) throw new Error(`Error fetching pendings: ${error.message}`)
  if (!pendings?.length) return { fired: 0, skipped: 0 }

  for (const pending of pendings) {
    try {
      const rule = pending.auto_replies as any
      if (!rule) { skipped++; continue }

      const threadId = pending.thread_id
      const orgId = pending.org_id
      const sessionId = pending.session_id
      const chatId = pending.chat_id
      const contactId = pending.contact_id

      // Verificar que el cliente NO haya respondido desde que se programó este pending
      const { data: pendingRow } = await supabaseAdmin
        .from('no_response_pending')
        .select('created_at')
        .eq('id', pending.id)
        .single()

      const { count: clientResponseCount } = await supabaseAdmin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', threadId)
        .eq('direction', 'in')
        .gte('sent_at', pendingRow?.created_at ?? now)

      if ((clientResponseCount ?? 0) > 0) {
        // El cliente respondió → cancelar
        await supabaseAdmin
          .from('no_response_pending')
          .update({ cancelled_at: now })
          .eq('id', pending.id)
        skipped++
        continue
      }

      // Verificar scope de IA
      const aiScope = rule.no_response_ai_scope ?? 'always'
      if (aiScope !== 'always') {
        const { data: thread } = await supabaseAdmin
          .from('threads')
          .select('ai_enabled')
          .eq('id', threadId)
          .maybeSingle()
        const aiEnabled = thread?.ai_enabled ?? false
        if (aiScope === 'ai_active' && !aiEnabled) { skipped++; continue }
        if (aiScope === 'ai_inactive' && aiEnabled) { skipped++; continue }
      }

      // Obtener steps de la regla
      const { data: steps } = await supabaseAdmin
        .from('auto_reply_steps')
        .select('*')
        .eq('rule_id', rule.id)
        .order('step_order', { ascending: true })

      // Encolar cada paso con su delay acumulado
      if (steps?.length && sessionId && chatId) {
        let delayAccum = 0
        for (const step of steps) {
          delayAccum += step.cooldown_seconds ?? 0
          const scheduleAt = new Date(Date.now() + delayAccum * 1000).toISOString()

          if (step.media_url) {
            await supabaseAdmin.from('engine_commands').insert({
              org_id: orgId,
              session_id: sessionId,
              type: 'send_media',
              payload: {
                chatId,
                mediaUrl: step.media_url,
                mimeType: step.mime_type,
                caption: step.text_content,
              },
              status: 'pending',
              scheduled_for: scheduleAt,
            })
          } else if (step.text_content) {
            await supabaseAdmin.from('engine_commands').insert({
              org_id: orgId,
              session_id: sessionId,
              type: 'send_message',
              payload: { chatId, text: step.text_content },
              status: 'pending',
              scheduled_for: scheduleAt,
            })
          }
        }
      }

      // Aplicar etiqueta de no-respuesta si está configurada
      if (rule.no_response_tag_id && contactId) {
        await supabaseAdmin.from('contact_tags').upsert(
          [{ contact_id: contactId, tag_id: rule.no_response_tag_id }],
          { onConflict: 'contact_id,tag_id' }
        )
      }

      // Acciones adicionales (agregar/quitar etiquetas, comportamiento IA)
      if (rule.action_add_tags?.length && contactId) {
        const inserts = rule.action_add_tags.map((tagId: string) => ({
          contact_id: contactId,
          tag_id: tagId,
        }))
        await supabaseAdmin.from('contact_tags').upsert(inserts, { onConflict: 'contact_id,tag_id' })
      }
      if (rule.action_remove_tags?.length && contactId) {
        await supabaseAdmin.from('contact_tags')
          .delete()
          .eq('contact_id', contactId)
          .in('tag_id', rule.action_remove_tags)
      }
      if (rule.action_ai_behavior === 'disable_ai') {
        await supabaseAdmin.from('threads').update({ ai_enabled: false }).eq('id', threadId)
      } else if (rule.action_ai_behavior === 'enable_ai') {
        await supabaseAdmin.from('threads').update({ ai_enabled: true }).eq('id', threadId)
      }

      // Marcar como disparado
      await supabaseAdmin
        .from('no_response_pending')
        .update({ fired_at: now })
        .eq('id', pending.id)

      fired++
    } catch (err: any) {
      console.error(`[no-response-worker] error processing pending ${pending.id}:`, err)
      skipped++
    }
  }

  return { fired, skipped }
}
