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

/**
 * Drops an oversized `conversation` rather than rejecting the whole record —
 * the transcript/metadata are still worth keeping even if the conversation
 * blew past the cap (a bad truncation on the collector side, say).
 */
export function sanitizeConversation(conversation) {
  if (!Array.isArray(conversation)) {
    return null
  }
  const bytes = Buffer.byteLength(JSON.stringify(conversation), 'utf8')
  return bytes > MAX_CONVERSATION_BYTES ? null : conversation
}
