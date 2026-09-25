import { describe, expect, it } from 'vitest'
import { AGENT_ACTION_HISTORY_MAX, nextAgentActionHistory } from './agent-status-action-history'

describe('nextAgentActionHistory', () => {
  it('appends a new entry for a new tool call', () => {
    const result = nextAgentActionHistory(undefined, 'Edit', '/src/config.ts', 1_000, false)
    expect(result).toEqual([{ toolName: 'Edit', toolInput: '/src/config.ts', at: 1_000 }])
  })

  it('treats an undefined existing history (old snapshot / remote without the field) as empty', () => {
    const result = nextAgentActionHistory(undefined, 'Read', 'a.md', 1, false)
    expect(result).toHaveLength(1)
  })

  it('returns the existing history unchanged when the payload carries no tool', () => {
    const existing = [{ toolName: 'Edit', toolInput: 'a.ts', at: 1 }]
    const result = nextAgentActionHistory(existing, undefined, undefined, 2, false)
    expect(result).toBe(existing)
  })

  it('collapses a consecutive repeat of the same toolName + toolInput into one entry', () => {
    const first = nextAgentActionHistory(undefined, 'Bash', 'pnpm test', 1, false)
    const second = nextAgentActionHistory(first, 'Bash', 'pnpm test', 2, false)
    expect(second).toHaveLength(1)
    expect(second?.[0].at).toBe(1)
  })

  it('does not collapse when toolInput differs for the same toolName', () => {
    const first = nextAgentActionHistory(undefined, 'Bash', 'pnpm test', 1, false)
    const second = nextAgentActionHistory(first, 'Bash', 'pnpm lint', 2, false)
    expect(second).toHaveLength(2)
  })

  it('drops the oldest entry once the cap is exceeded', () => {
    let history: ReturnType<typeof nextAgentActionHistory> = undefined
    for (let i = 0; i < AGENT_ACTION_HISTORY_MAX + 5; i++) {
      history = nextAgentActionHistory(history, 'Bash', `cmd-${i}`, i, false)
    }
    expect(history).toHaveLength(AGENT_ACTION_HISTORY_MAX)
    expect(history?.[0].toolInput).toBe(`cmd-${5}`)
    expect(history?.at(-1)?.toolInput).toBe(`cmd-${AGENT_ACTION_HISTORY_MAX + 4}`)
  })

  it('truncates toolInput to 200 characters', () => {
    const longInput = 'x'.repeat(250)
    const result = nextAgentActionHistory(undefined, 'Bash', longInput, 1, false)
    expect(result?.[0].toolInput).toHaveLength(200)
  })

  it('stores null toolInput when the payload omits it', () => {
    const result = nextAgentActionHistory(undefined, 'Read', undefined, 1, false)
    expect(result?.[0].toolInput).toBeNull()
  })

  it('clears history on a session boundary', () => {
    const existing = [{ toolName: 'Edit', toolInput: 'a.ts', at: 1 }]
    const result = nextAgentActionHistory(existing, undefined, undefined, 2, true)
    expect(result).toEqual([])
  })
})
