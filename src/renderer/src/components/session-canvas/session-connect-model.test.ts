import { describe, expect, it } from 'vitest'
import { buildSessionGraph } from './session-graph-model'
import { makeEntry, makeExternal, makeInputs } from './session-graph-test-fixtures'
import {
  PASS_ALONG_PREVIEW_MAX_CHARS,
  isLiveSessionConnection,
  latestSessionResult,
  previewPassAlongText,
  resolveSessionConnection
} from './session-connect-model'

describe('isLiveSessionConnection', () => {
  it('accepts live → live between different cards', () => {
    expect(isLiveSessionConnection({ source: 'live:a', target: 'live:b' })).toBe(true)
  })

  it('rejects self, external and group endpoints', () => {
    expect(isLiveSessionConnection({ source: 'live:a', target: 'live:a' })).toBe(false)
    expect(isLiveSessionConnection({ source: 'live:a', target: 'ext:e1' })).toBe(false)
    expect(isLiveSessionConnection({ source: 'ext:e1', target: 'live:a' })).toBe(false)
    expect(isLiveSessionConnection({ source: 'group:repo-1', target: 'live:a' })).toBe(false)
  })
})

describe('resolveSessionConnection', () => {
  const graph = buildSessionGraph(
    makeInputs({
      liveEntries: [
        makeEntry('a', { terminalTitle: 'Coordinator' }),
        makeEntry('b', { terminalTitle: 'Worker' })
      ],
      externalSessions: [makeExternal('e1', { cwd: null })]
    })
  )

  it('returns both live entries in drag direction', () => {
    const resolved = resolveSessionConnection(graph, { source: 'live:a', target: 'live:b' })
    expect(resolved?.from.paneKey).toBe('a')
    expect(resolved?.to.paneKey).toBe('b')
  })

  it('returns null for unknown, external or self connections', () => {
    expect(resolveSessionConnection(graph, { source: 'live:a', target: 'live:zz' })).toBeNull()
    expect(resolveSessionConnection(graph, { source: 'live:a', target: 'ext:e1' })).toBeNull()
    expect(resolveSessionConnection(graph, { source: 'live:a', target: 'live:a' })).toBeNull()
  })
})

describe('previewPassAlongText', () => {
  it('keeps short text as-is', () => {
    expect(previewPassAlongText('hello')).toBe('hello')
  })

  it('clips long text with an ellipsis', () => {
    const preview = previewPassAlongText('字'.repeat(PASS_ALONG_PREVIEW_MAX_CHARS + 10))
    expect(Array.from(preview)).toHaveLength(PASS_ALONG_PREVIEW_MAX_CHARS + 1)
    expect(preview.endsWith('…')).toBe(true)
  })
})

describe('latestSessionResult', () => {
  it('uses the live message of a finished turn', () => {
    expect(
      latestSessionResult(
        makeEntry('a', {
          state: 'done',
          lastAssistantMessage: '刚完成',
          lastCompletedAssistantMessage: '上一轮'
        })
      )
    ).toBe('刚完成')
  })

  it('falls back to the last completed turn while working or for tool output', () => {
    expect(
      latestSessionResult(
        makeEntry('a', {
          state: 'working',
          lastAssistantMessage: '进行中',
          lastCompletedAssistantMessage: '上一轮'
        })
      )
    ).toBe('上一轮')
    expect(
      latestSessionResult(
        makeEntry('a', {
          state: 'done',
          lastAssistantMessage: 'npm ERR!',
          lastAssistantMessageIsToolOutput: true,
          lastCompletedAssistantMessage: '上一轮'
        })
      )
    ).toBe('上一轮')
    expect(latestSessionResult(makeEntry('a'))).toBeNull()
  })
})
