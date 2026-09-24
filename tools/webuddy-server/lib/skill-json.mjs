/**
 * 解析模型返回的 skill JSON 数组。
 *
 * Why 要能"抢救"：回复被 max_tokens 截断时整段 JSON 非法，以前直接当 0 条，
 * token 白花。数组里已经写完的对象是完整可用的，逐个捞出来。
 */

const TRUNCATED = new Set(['length', 'max_tokens'])

const isSkill = (s) => Boolean(s && typeof s === 'object' && s.title && s.body)

/** 去掉 ```json 围栏；截断的回复可能只有开头的围栏。 */
function unfence(text) {
  const closed = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (closed) {
    return closed[1]
  }
  return text.replace(/^[\s\S]*?```(?:json)?\s*/, '')
}

/** 扫描第一个 `[` 之后，返回所有闭合的顶层对象；字符串内的括号和转义都跳过。 */
export function completeArrayObjects(text) {
  const start = text.indexOf('[')
  if (start === -1) {
    return []
  }
  const found = []
  let depth = 0
  let objectStart = -1
  let inString = false
  let escaped = false
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{' || ch === '[') {
      if (depth === 0 && ch === '{') {
        objectStart = i
      }
      depth++
    } else if (ch === '}' || ch === ']') {
      if (depth === 0) {
        break // 数组本身闭合了
      }
      depth--
      if (depth === 0 && ch === '}' && objectStart !== -1) {
        try {
          found.push(JSON.parse(text.slice(objectStart, i + 1)))
        } catch {
          // 单个对象坏了不影响其它的
        }
        objectStart = -1
      }
    }
  }
  return found
}

function parseWhole(candidate) {
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start === -1 || end < start) {
    return null
  }
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * `skills: null` 表示没能解析出任何东西（区别于模型明确返回的 `[]`）。
 * `salvaged` 表示结果来自截断回复的抢救。
 */
export function parseSkillReply(text, finishReason = null) {
  const candidate = unfence(String(text ?? '')).trim()
  if (!TRUNCATED.has(finishReason)) {
    const whole = parseWhole(candidate)
    if (whole) {
      return { skills: whole.filter(isSkill), salvaged: false }
    }
  }
  const rescued = completeArrayObjects(candidate).filter(isSkill)
  return rescued.length > 0
    ? { skills: rescued, salvaged: true }
    : { skills: null, salvaged: false }
}
