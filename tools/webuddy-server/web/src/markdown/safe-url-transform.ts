/**
 * Explicit allowlist for link/image URLs in model-produced markdown, independent of
 * react-markdown's own default (which already blocks js/data URIs, but that's an
 * implementation detail we don't want this dashboard's XSS protection to rest on).
 * Only http:, https:, mailto: and protocol-relative/relative/hash URLs pass through;
 * anything else (javascript:, data:, vbscript:, ...) becomes '' so react-markdown
 * drops the attribute instead of rendering a live link or image.
 */
const ALLOWED_PROTOCOLS = new Set(['http', 'https', 'mailto'])

export function safeUrlTransform(value: string): string {
  const trimmed = value.trim()
  const colon = trimmed.indexOf(':')
  const questionMark = trimmed.indexOf('?')
  const numberSign = trimmed.indexOf('#')
  const slash = trimmed.indexOf('/')
  const isRelative =
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign)
  if (isRelative) {
    return value
  }
  const protocol = trimmed.slice(0, colon).toLowerCase()
  return ALLOWED_PROTOCOLS.has(protocol) ? value : ''
}
