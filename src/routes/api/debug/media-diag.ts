import { createFileRoute } from '@tanstack/react-router'
import { supabaseAdmin } from '@/integrations/supabase/client.server'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })

export const Route = createFileRoute('/api/debug/media-diag')({
  async loader({ request }) {
    // Solo GET, token de seguridad mínimo
    const url = new URL(request.url)
    const token = url.searchParams.get('token')
    if (token !== 'diag2024') {
      return json(403, { error: 'Forbidden - pasa ?token=diag2024' })
    }

    const threadId = url.searchParams.get('thread')
    if (!threadId) {
      return json(400, { error: 'Falta ?thread=<uuid>' })
    }

    const { data: messages, error } = await supabaseAdmin
      .from('messages')
      .select('id, direction, text, sent_at, wa_message_id, media, raw')
      .eq('thread_id', threadId)
      .order('sent_at', { ascending: false })
      .limit(15)

    if (error) return json(500, { error: error.message })

    const analysis = (messages ?? []).map((m: any) => {
      const media = m.media as any
      return {
        id: m.id,
        direction: m.direction,
        time: m.sent_at,
        wa_message_id: m.wa_message_id,
        text_preview: m.text?.substring(0, 50),
        media_null: !media,
        media_keys: media ? Object.keys(media) : [],
        media_url: media?.url || null,
        media_mimeType: media?.mimeType || media?.mime_type || media?.mimetype || null,
        media_missing: media?.missing_media || false,
        media_error: media?.error || null,
        media_has_base64: !!(media?.base64),
        media_has_body: !!(media?.body),
        media_has_data: !!(media?.data),
        media_base64_len: (media?.base64 || '').length,
        media_body_len: (media?.body || '').length,
        // Raw event keys para ver qué mandó la extensión
        raw_media_keys: m.raw?.media ? Object.keys(m.raw.media) : (m.raw ? ['(raw existe, no tiene .media)'] : ['(no hay raw)']),
        diagnosis: !media
          ? '✅ Sin media (mensaje de texto)'
          : media.url
          ? '✅ Tiene URL - debería verse'
          : media.missing_media
          ? '⚠️ missing_media - extensión no envió archivo'
          : media.error
          ? `❌ Error: ${media.error}`
          : '🤔 Media sin URL, sin error, sin missing_media',
      }
    })

    return json(200, {
      thread_id: threadId,
      total: analysis.length,
      messages: analysis,
      summary: {
        incoming_with_media: analysis.filter(m => m.direction === 'in' && !m.media_null).length,
        incoming_with_url: analysis.filter(m => m.direction === 'in' && m.media_url).length,
        incoming_missing: analysis.filter(m => m.direction === 'in' && m.media_missing).length,
        outgoing_with_url: analysis.filter(m => m.direction === 'out' && m.media_url).length,
      }
    })
  }
})
