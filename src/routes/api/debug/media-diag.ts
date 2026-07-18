import { createFileRoute } from '@tanstack/react-router'
import { supabaseAdmin } from '@/integrations/supabase/client.server'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })

export const Route = createFileRoute('/api/debug/media-diag')({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const token = url.searchParams.get('token')
        const threadId = url.searchParams.get('thread')

        if (token !== 'diag2024') {
          return json(401, { error: 'Invalid token' })
        }

        if (!threadId) {
          return json(400, { error: 'Missing thread parameter' })
        }

        // Fetch the last 20 messages with media for this thread
        const { data: messages, error } = await supabaseAdmin
          .from('messages')
          .select('id, direction, sent_at, text, media, wa_message_id')
          .eq('thread_id', threadId)
          .not('media', 'is', null)
          .order('sent_at', { ascending: false })
          .limit(20)

        if (error) {
          return json(500, { error: error.message })
        }

        const diagnostics = (messages ?? []).map((msg: any) => {
          const media = msg.media
          const mediaKeys = media && typeof media === 'object' ? Object.keys(media) : []

          const rawMimeType = media?.mimeType ?? media?.mime_type ?? media?.mimetype ?? null
          const hasUrl = !!(media?.url)
          const urlPreview = media?.url ? String(media.url).substring(0, 120) : null
          const hasBase64 = !!(media?.base64 || media?.body || media?.data)
          const hasMissingMedia = !!(media?.missing_media)
          const hasError = !!(media?.error)

          // Check what the frontend would compute
          const mime = (rawMimeType ?? '').toLowerCase()
          const isImage = mime.startsWith('image/') || !!(media?.url && /\.(jpg|jpeg|png|gif|webp)$/i.test(media.url))
          const isVideo = mime.startsWith('video/')
          const isAudio = mime.startsWith('audio/')
          const isDoc = !isImage && !isVideo && !isAudio && hasUrl
          const wouldRender = hasUrl && (isImage || isVideo || isAudio || isDoc)

          return {
            id: msg.id,
            direction: msg.direction,
            sent_at: msg.sent_at,
            wa_message_id: msg.wa_message_id,
            text_preview: msg.text ? String(msg.text).substring(0, 60) : null,
            media_diagnosis: {
              media_null: media === null,
              media_keys: mediaKeys,
              has_url: hasUrl,
              url_preview: urlPreview,
              has_base64_in_db: hasBase64,
              missing_media: hasMissingMedia,
              has_error: hasError,
              error_msg: media?.error ?? null,
              raw_mime_type: rawMimeType,
              normalized_mime: mime,
              frontend_computed: {
                isImage,
                isVideo,
                isAudio,
                isDoc,
                would_render_media: wouldRender,
                root_cause: !hasUrl
                  ? hasMissingMedia
                    ? 'MISSING_MEDIA: extension did not send base64'
                    : hasError
                    ? `ERROR: ${media?.error}`
                    : 'NO_URL: media exists but no URL was saved'
                  : !wouldRender
                  ? `BAD_MIME: mimeType="${rawMimeType}" not detected as image/video/audio`
                  : 'OK: should render correctly',
              },
            },
          }
        })

        return json(200, {
          thread_id: threadId,
          total_messages_with_media: messages?.length ?? 0,
          messages: diagnostics,
          summary: {
            would_render: diagnostics.filter((d) => d.media_diagnosis.frontend_computed.would_render_media).length,
            missing_media: diagnostics.filter((d) => d.media_diagnosis.missing_media).length,
            has_error: diagnostics.filter((d) => d.media_diagnosis.has_error).length,
            no_url: diagnostics.filter((d) => !d.media_diagnosis.has_url && !d.media_diagnosis.missing_media && !d.media_diagnosis.has_error).length,
            bad_mime: diagnostics.filter(
              (d) =>
                d.media_diagnosis.has_url &&
                !d.media_diagnosis.frontend_computed.would_render_media,
            ).length,
          },
        })
      },
    },
  },
})
