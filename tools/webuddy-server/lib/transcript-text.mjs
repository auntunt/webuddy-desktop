/**
 * 把原始 transcript JSONL 还原成可读对话（用户/助手的文字），喂给 skill 提炼。
 *
 * Why：Claude Code 的 JSONL 开头几千字几乎全是元数据和系统注入文本，
 * 按字符截前 N 字，模型看不到真正干了什么。工具调用/结果、思考过程也不要。
 */

const PER_MESSAGE_CAP = 600
const INJECTED_BLOCKS =
  /<(system-reminder|environment_context|user_instructions|local-command-stdout|bash-input|bash-stdout|bash-stderr)>[\s\S]*?<\/\1>/g

function clean(text) {
  return String(text)
    .replace(INJECTED_BLOCKS, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('<command-'))
    .join('\n')
    .trim()
}

function textParts(content) {
  if (typeof content === 'string') {
    return [content]
  }
  if (!Array.isArray(content)) {
    return []
  }
  return content
    .filter((part) => ['text', 'input_text', 'output_text'].includes(part?.type))
    .map((part) => String(part.text ?? ''))
}

/** 一行 JSONL → { role, text }；不认识或不是对话正文就返回 null。 */
function messageOf(entry) {
  const claudeTurn = entry?.type === 'user' || entry?.type === 'assistant'
  // 压缩摘要是模型自己写的回顾，子代理对话不是本人的做法。
  if (claudeTurn && (entry.isMeta || entry.isCompactSummary || entry.isSidechain)) {
    return { role: entry.type, parts: [] }
  }
  if (claudeTurn && entry.message) {
    return { role: entry.type, parts: textParts(entry.message.content) }
  }
  // webuddy.conversation.v1：数据库型 agent 由采集端转成的 {role, text} 行。
  if ((entry?.role === 'user' || entry?.role === 'assistant') && typeof entry.text === 'string') {
    return { role: entry.role, parts: [entry.text] }
  }
  const payload = entry?.payload
  if (payload?.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
    return { role: payload.role, parts: textParts(payload.content) }
  }
  return null
}

function parseLine(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

export function readableTranscript(body, cap = 3000) {
  if (!body) {
    return ''
  }
  const raw = String(body)
  const lines = []
  let recognised = false
  let used = 0
  for (const line of raw.split('\n')) {
    const message = line.trim() ? messageOf(parseLine(line)) : null
    if (!message) {
      continue
    }
    recognised = true
    const text = clean(message.parts.join('\n')).slice(0, PER_MESSAGE_CAP)
    if (!text) {
      continue
    }
    const entry = `${message.role === 'user' ? '用户' : '助手'}：${text}`
    lines.push(entry)
    used += entry.length + 1
    if (used >= cap) {
      break
    }
  }
  // 认得格式但全是噪音时返回空，别退回原文把元数据又塞回去。
  return recognised ? lines.join('\n').slice(0, cap) : raw.slice(0, cap)
}
