/**
 * 解析模型返回的 skill JSON 数组。
 *
 * Why 要能"抢救"：回复被 max_tokens 截断时整段 JSON 非法，以前直接当 0 条，
 * token 白花。数组里已经写完的对象是完整可用的，逐个捞出来。
 */

const TRUNCATED = new Set(['length', 'max_tokens'])

const isSkill = (s) => Boolean(s && typeof s === 'object' && s.title && s.body)

/** 只剥首尾锚定的围栏 —— skill 正文里常有 ```bash 代码块，懒匹配会在那里截断。 */
function unfence(text) {
  return text.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '')
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

function parseArray(text) {
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseWhole(raw) {
  const direct = parseArray(raw)
  if (direct) {
    return direct
  }
  const candidate = unfence(raw)
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  return start === -1 || end < start ? null : parseArray(candidate.slice(start, end + 1))
}

/**
 * `skills: null` 表示没能解析出任何可用 skill（区别于模型明确返回的 `[]`）。
 * `salvaged` 表示结果来自截断回复的抢救。
 */
export function parseSkillReply(text, finishReason = null) {
  const raw = String(text ?? '').trim()
  if (!TRUNCATED.has(finishReason)) {
    const whole = parseWhole(raw)
    if (whole) {
      const skills = whole.filter(isSkill)
      // 非空数组却一条都不合格（比如用了 name 而不是 title）是格式错，不是"没内容"。
      return { skills: whole.length > 0 && skills.length === 0 ? null : skills, salvaged: false }
    }
  }
  const rescued = completeArrayObjects(raw).filter(isSkill)
  return rescued.length > 0
    ? { skills: rescued, salvaged: true }
    : { skills: null, salvaged: false }
}
