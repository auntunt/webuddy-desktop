/**
 * Redaction for anything leaving the device.
 *
 * Two different jobs, deliberately separate:
 *   - `maskPath` runs always, including on metadata. Absolute paths leak the OS
 *     username and directory layout, and metadata is uploaded by default.
 *   - `redactTranscript` runs only for consent scope `transcript-full`, on a line
 *     at a time, so a single huge line cannot force the whole file into memory.
 *
 * Secret patterns are intentionally narrow and anchored: a broad "anything that
 * looks random" rule corrupts ordinary code (hashes, base64 fixtures) and hides
 * the real leaks among false positives.
 */

export const SECRET_RULES = [
  { id: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { id: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}/g },
  { id: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g },
  { id: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'slack-token', re: /\bxox[abpsr]-[A-Za-z0-9-]{10,}/g },
  {
    id: 'private-key-block',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{0,8000}?-----END [A-Z ]*PRIVATE KEY-----/g
  },
  { id: 'bearer-header', re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi },
  { id: 'basic-auth-url', re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi }
]

/** Placeholder keeps the field's presence visible without keeping the value. */
export function maskPlaceholder(ruleId) {
  return `[redacted:${ruleId}]`
}

const WINDOWS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/

export function maskPath(value, homeDir) {
  if (typeof value !== 'string' || !value) {
    return value ?? null
  }
  const normalizedHome = homeDir?.replace(/[\\/]+$/, '')
  if (!normalizedHome) {
    return value
  }
  // Why fold case and separators on Windows: NTFS paths compare case-insensitively.
  const windows = WINDOWS_PATH.test(normalizedHome)
  const fold = (path) => (windows ? path.replaceAll('\\', '/').toLowerCase() : path)
  const home = fold(normalizedHome)
  const candidate = fold(value)
  if (candidate === home || candidate.startsWith(`${home}/`)) {
    return `~${value.slice(normalizedHome.length)}`
  }
  return value
}

// Linux home inside a WSL distro, seen either natively or through the Windows UNC share.
const WSL_HOME = [
  /^\/home\/[^/]+(?=\/|$)/,
  /^\/root(?=\/|$)/,
  /^(?:\\\\|\/\/)wsl(?:\.localhost|\$)[\\/][^\\/]+[\\/]home[\\/][^\\/]+(?=[\\/]|$)/i,
  /^(?:\\\\|\/\/)wsl(?:\.localhost|\$)[\\/][^\\/]+[\\/]root(?=[\\/]|$)/i
]

/** Masks the WSL user's home; used for entries whose relPath carries the `wsl:` prefix. */
export function maskWslPath(value) {
  if (typeof value !== 'string' || !value) {
    return value ?? null
  }
  for (const re of WSL_HOME) {
    const match = re.exec(value)
    if (match) {
      return `~${value.slice(match[0].length)}`
    }
  }
  return value
}

export function redactLine(line) {
  let output = line
  const applied = []
  for (const rule of SECRET_RULES) {
    rule.re.lastIndex = 0
    if (rule.re.test(output)) {
      rule.re.lastIndex = 0
      output = output.replace(rule.re, maskPlaceholder(rule.id))
      applied.push(rule.id)
    }
  }
  return { line: output, applied }
}

/**
 * Line-delimited redaction. Keeps the caller's framing (newlines) so the file
 * stays valid JSONL for downstream consumers.
 */
export function redactTranscript(text) {
  const applied = new Set()
  const lines = text.split('\n')
  const out = lines.map((line) => {
    if (!line) {
      return line
    }
    const result = redactLine(line)
    for (const id of result.applied) {
      applied.add(id)
    }
    return result.line
  })
  return { text: out.join('\n'), rulesApplied: [...applied].sort() }
}
