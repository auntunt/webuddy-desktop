/** Shape check for an uploaded session record before it touches the database. */

export const REQUIRED = ['schema', 'actor', 'agent', 'session', 'transcript', 'consent']
export const REQUIRED_PATHS = [
  'actor.userId',
  'actor.deviceId',
  'agent.id',
  'session.id',
  'session.localDate',
  'transcript.sha256'
]

export function validate(record) {
  const errors = []
  for (const key of REQUIRED) {
    if (!record?.[key]) {
      errors.push(`missing ${key}`)
    }
  }
  for (const path of REQUIRED_PATHS) {
    const value = path.split('.').reduce((node, key) => node?.[key], record)
    if (typeof value !== 'string' || !value) {
      errors.push(`missing ${path}`)
    }
  }
  return errors
}

const MAX_CONVERSATION_BYTES = 2 * 1024 * 1024

function messageOf(item) {
  if (typeof item?.role !== 'string' || typeof item.text !== 'string') {
    return null
  }
  const timestamp = item.timestamp ?? null
  return timestamp === null || typeof timestamp === 'string'
    ? { role: item.role, text: item.text, timestamp }
    : null
}

/**
 * Drops an oversized `conversation` rather than rejecting the whole record —
 * the transcript/metadata are still worth keeping even if the conversation
 * blew past the cap (a bad truncation on the collector side, say). Malformed
 * messages are dropped one by one; the web view assumes this exact shape.
 */
export function sanitizeConversation(conversation) {
  if (!Array.isArray(conversation)) {
    return null
  }
  const messages = conversation.map(messageOf).filter(Boolean)
  const bytes = Buffer.byteLength(JSON.stringify(messages), 'utf8')
  return bytes > MAX_CONVERSATION_BYTES ? null : messages
}
