export function normalizeDedupText(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export function buildInboundDedupKey({ sessionId, chatId, waMessageId, direction, text, sentAt, waId }) {
  const normalizedText = normalizeDedupText(text).slice(0, 180)
  const normalizedChatId = String(chatId ?? waId ?? '').trim().toLowerCase()
  const normalizedSentAt = sentAt ? String(sentAt).trim() : ''
  const normalizedWaMessageId = String(waMessageId ?? '').trim().toLowerCase()

  return [
    'inbound',
    String(sessionId ?? ''),
    normalizedChatId,
    String(direction ?? ''),
    normalizedWaMessageId || 'no-wa-id',
    normalizedText || 'no-text',
    normalizedSentAt || 'no-time',
  ].join('|')
}

export function buildAiReplyDedupKey({ sessionId, threadId, text, waMessageId }) {
  const normalizedText = normalizeDedupText(text).slice(0, 180)
  const normalizedWaMessageId = String(waMessageId ?? '').trim().toLowerCase()
  return [
    'ai-reply',
    String(sessionId ?? ''),
    String(threadId ?? ''),
    normalizedWaMessageId || 'no-wa-id',
    normalizedText || 'no-text',
  ].join('|')
}

export function createDedupTracker(ttlMs = 45_000) {
  const store = new Map()

  return {
    shouldProcess(key) {
      const now = Date.now()
      const previous = store.get(key)
      if (previous && now - previous < ttlMs) {
        return false
      }
      store.set(key, now)
      return true
    },
    clear(key) {
      store.delete(key)
    },
  }
}
