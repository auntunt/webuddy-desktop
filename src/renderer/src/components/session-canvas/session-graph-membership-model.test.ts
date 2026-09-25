import { describe, expect, it, vi } from 'vitest'
import type * as CrossPlatformPath from '../../../../shared/cross-platform-path'

const { normalizeCalls } = vi.hoisted(() => ({ normalizeCalls: { count: 0 } }))

vi.mock('../../../../shared/cross-platform-path', async (importOriginal) => {
  const actual = await importOriginal<typeof CrossPlatformPath>()
  return {
    ...actual,
    normalizeRuntimePathForComparison: (path: string) => {
      normalizeCalls.count += 1
      return actual.normalizeRuntimePathForComparison(path)
    }
  }
})

import { resolveCanvasMembership } from './session-graph-membership-model'
import { makeEntry, makeExternal, makeInputs } from './session-graph-test-fixtures'

describe('resolveCanvasMembership external dedup cost', () => {
  it('normalizes each transcript path once instead of once per external × live pair', () => {
    const liveEntries = Array.from({ length: 50 }, (_, i) =>
      makeEntry(`p${i}`, {
        agentType: 'codex',
        providerSession: {
          key: 'session_id',
          id: `live-${i}`,
          transcriptPath: `/t/live-${i}.jsonl`
        }
      })
    )
    const externalSessions = Array.from({ length: 50 }, (_, i) =>
      makeExternal(`e${i}`, { cwd: null })
    )
    normalizeCalls.count = 0
    const { sessions } = resolveCanvasMembership(makeInputs({ liveEntries, externalSessions }))
    expect(sessions).toHaveLength(100)
    expect(normalizeCalls.count).toBeLessThanOrEqual(liveEntries.length + externalSessions.length)
  })

  it('still drops an external session whose transcript matches a live one', () => {
    const live = makeEntry('p', {
      agentType: 'codex',
      providerSession: { key: 'session_id', id: 'x', transcriptPath: '/t/e1.jsonl' }
    })
    const { sessions } = resolveCanvasMembership(
      makeInputs({
        liveEntries: [live],
        externalSessions: [makeExternal('e1', { filePath: '/t/e1.jsonl' })]
      })
    )
    expect(sessions.map((session) => session.id)).toEqual(['live:p'])
  })
})
