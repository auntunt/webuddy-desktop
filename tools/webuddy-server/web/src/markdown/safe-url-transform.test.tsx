import { describe, expect, it } from 'vitest'
import { safeUrlTransform } from './safe-url-transform'

describe('safeUrlTransform', () => {
  it('blocks javascript:, data: and vbscript: URLs, case- and whitespace-insensitively', () => {
    expect(safeUrlTransform('javascript:alert(1)')).toBe('')
    expect(safeUrlTransform('  JaVaScRiPt:alert(1)')).toBe('')
    expect(safeUrlTransform('data:text/html,<script>alert(1)</script>')).toBe('')
    expect(safeUrlTransform('vbscript:msgbox(1)')).toBe('')
  })

  it('allows http, https and mailto', () => {
    expect(safeUrlTransform('https://example.com')).toBe('https://example.com')
    expect(safeUrlTransform('http://example.com')).toBe('http://example.com')
    expect(safeUrlTransform('mailto:a@example.com')).toBe('mailto:a@example.com')
  })

  it('allows relative and hash URLs', () => {
    expect(safeUrlTransform('/sessions/abc')).toBe('/sessions/abc')
    expect(safeUrlTransform('#section')).toBe('#section')
    expect(safeUrlTransform('./file.md')).toBe('./file.md')
  })
})
