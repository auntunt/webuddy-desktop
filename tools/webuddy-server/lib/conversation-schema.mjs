/**
 * sessions.conversation_json 列；老库在 openDb 时幂等补齐。
 *
 * 存放脱敏后的规范化对话（{role, text, timestamp}[]），与截断标记打包在一起，
 * 这样只加一列就能同时回答"对话是什么"和"是否被截断过"，不必再加一列。
 */

export function ensureConversationSchema(db) {
  const hasColumn = db
    .prepare('PRAGMA table_info(sessions)')
    .all()
    .some((column) => column.name === 'conversation_json')
  if (!hasColumn) {
    db.exec('ALTER TABLE sessions ADD COLUMN conversation_json TEXT')
  }
}

/** payload.conversation（已按 2MB 上限校验过）→ 待写入的 JSON 文本，没有就是 null。 */
export function conversationJsonOf(payload) {
  const conversation = payload?.conversation
  if (!Array.isArray(conversation)) {
    return null
  }
  const truncated = Boolean(payload.record?.transcript?.conversationTruncated)
  return JSON.stringify({ messages: conversation, truncated })
}

/** conversation_json 列的文本 → { conversation, truncated }，供 getSession 展开。 */
export function parseConversationColumn(text) {
  if (!text) {
    return { conversation: null, truncated: false }
  }
  try {
    const parsed = JSON.parse(text)
    return { conversation: parsed.messages ?? null, truncated: Boolean(parsed.truncated) }
  } catch (error) {
    console.warn('conversation_json failed to parse:', error?.message ?? error)
    return { conversation: null, truncated: false }
  }
}
