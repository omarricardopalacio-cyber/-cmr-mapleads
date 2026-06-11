import { createFileRoute } from '@tanstack/react-router'
import { supabaseAdmin } from '@/integrations/supabase/client.server'
import { runAiAgent } from '@/lib/ai.server'
import { getPendingRetryRequests, updateFailedRequest } from '@/lib/retry-manager.server'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Service-Token',
  'Access-Control-Max-Age': '86400',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })

/**
 * Procesa reintentos automáticos de solicitudes de IA fallidas
 * Llamado por: cron job o trigger de Supabase cada 1-5 minutos
 */
async function processRetries() {
  try {
    const requests = await getPendingRetryRequests()

    if (requests.length === 0) {
      return json(200, { success: true, processed: 0 })
    }

    let processed = 0
    let succeeded = 0

    for (const req of requests) {
      try {
        // Actualizar estado a "retrying"
        await updateFailedRequest(req.id!, { status: 'retrying' })

        // Obtener configuración de IA
        const { data: cfg } = await supabaseAdmin
          .from('ai_configs')
          .select('*')
          .eq('org_id', req.org_id)
          .maybeSingle()

        if (!cfg || !cfg.enabled) {
          await updateFailedRequest(req.id!, { status: 'failed' })
          processed++
          continue
        }
        // Si el cliente ya respondió después del fallo, no reintentamos en silencio.
        if (req.created_at) {
          const { data: laterUserMsgs, error: laterError } = await supabaseAdmin
            .from('messages')
            .select('id')
            .eq('thread_id', req.thread_id)
            .eq('direction', 'in')
            .gt('sent_at', req.created_at.toISOString())
            .limit(1)

          if (laterError) {
            console.warn('[retry-processor] failed to check newer user messages', {
              requestId: req.id,
              error: laterError.message,
            })
          } else if (laterUserMsgs?.length) {
            console.info('[retry-processor] skipping retry because user already responded', {
              requestId: req.id,
              threadId: req.thread_id,
            })
            await updateFailedRequest(req.id!, { status: 'resolved' })
            processed++
            continue
          }
        }
        // Recuperar historial de mensajes
        const { data: prior } = await supabaseAdmin
          .from('messages')
          .select('direction, text, sent_at')
          .eq('thread_id', req.thread_id)
          .not('text', 'is', null)
          .order('sent_at', { ascending: false })
          .limit(20)

        const priorMsgs = ((prior ?? []) as any[])
          .filter((m: any) => typeof m.text === 'string' && m.text.trim().length > 0)
          .reverse()
          .map((m: any) => ({
            role: (m.direction === 'out' ? 'assistant' : 'user') as 'assistant' | 'user',
            content: String(m.text).trim(),
          }))

        // Agregar mensaje original al historial
        const history =
          priorMsgs.length > 0
            ? priorMsgs
            : [{ role: 'user' as const, content: req.original_message }]

        // Obtener info de contacto
        const { data: contact } = await supabaseAdmin
          .from('contacts')
          .select('id')
          .eq('wa_id', req.chat_id)
          .maybeSingle()

        // Intentar ejecutar el agente de IA nuevamente
        console.info('[retry-processor] attempting retry', {
          requestId: req.id,
          threadId: req.thread_id,
          retryCount: req.retry_count + 1,
          maxRetries: req.max_retries,
        })

        const cfgFast = { ...(cfg as Record<string, unknown>) }
        const provider = (cfgFast.selected_provider as string) || (cfgFast.provider as string) || 'lovable'
        if (provider === 'lovable' && (!cfgFast.model || String(cfgFast.model).startsWith('gpt-'))) {
          cfgFast.model = 'google/gemini-2.5-flash'
        }

        const { reply, actions } = await runAiAgent({
          orgId: req.org_id,
          threadId: req.thread_id,
          contactId: contact?.id,
          sessionId: req.session_id,
          chatId: req.chat_id,
          messages: [
            ...history,
            {
              role: 'system' as const,
              content: 'Este es un reintento automático de tu respuesta anterior que falló. Contesta brevemente y directamente la pregunta del cliente.',
            },
          ],
          cfg: cfgFast,
        })

        let finalReply = reply?.trim() || ''
        if (!finalReply) {
          const sentImage = actions?.includes('send_product_image') || actions?.includes('send_product_video')
          if (sentImage) {
            finalReply = '¿Cuál te gusta más? Cuéntame y avanzamos con tu pedido.'
          } else {
            finalReply = 'Un momento por favor… ¿me confirmas qué producto te interesa?'
          }
        }

        // Enviar respuesta al usuario
        await supabaseAdmin.from('engine_commands').insert({
          org_id: req.org_id,
          session_id: req.session_id,
          type: 'SEND_MESSAGE',
          payload: { chatId: req.chat_id, text: finalReply },
          status: 'pending',
        })

        // Marcar como resuelto
        await updateFailedRequest(req.id!, {
          status: 'resolved',
          retry_count: req.retry_count + 1,
        })

        succeeded++
        processed++

        console.info('[retry-processor] retry succeeded', {
          requestId: req.id,
          threadId: req.thread_id,
        })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.warn('[retry-processor] retry failed', {
          requestId: req.id,
          error: errMsg,
          retryCount: req.retry_count + 1,
          maxRetries: req.max_retries,
        })

        // Incrementar counter de reintentos
        if (req.retry_count + 1 < req.max_retries) {
          // Programar siguiente reintento en 3 minutos
          const nextRetry = new Date(Date.now() + 3 * 60 * 1000)
          await updateFailedRequest(req.id!, {
            retry_count: req.retry_count + 1,
            next_retry_at: nextRetry,
            status: 'pending',
          })
        } else {
          // Máximo de reintentos agotados
          await updateFailedRequest(req.id!, {
            status: 'failed',
            retry_count: req.retry_count + 1,
          })

          // Enviar mensaje final de error
          await supabaseAdmin.from('engine_commands').insert({
            org_id: req.org_id,
            session_id: req.session_id,
            type: 'SEND_MESSAGE',
            payload: {
              chatId: req.chat_id,
              text: 'Lo sentimos, estamos teniendo dificultades técnicas. Por favor, intenta más tarde o contáctanos directamente.',
            },
            status: 'pending',
          })
        }

        processed++
      }
    }

    console.info('[retry-processor] cycle complete', {
      processed,
      succeeded,
      failed: processed - succeeded,
    })

    return json(200, { success: true, processed, succeeded })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[retry-processor] fatal error:', errMsg)
    return json(500, { success: false, error: errMsg })
  }
}

export const Route = createFileRoute('/api/public/engine/retry-processor')({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        // Validar token de servicio (si existe)
        const serviceToken = request.headers.get('x-service-token')
        const validTokens = (process.env.SERVICE_TOKEN || '').split(',').filter(Boolean)

        if (validTokens.length > 0 && !validTokens.includes(serviceToken || '')) {
          return json(401, { error: 'Invalid service token' })
        }

        return processRetries()
      },
    },
  },
})
