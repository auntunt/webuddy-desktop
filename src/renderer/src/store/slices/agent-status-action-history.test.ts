import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_ACTION_HISTORY_MAX } from '../../../../shared/agent-status-action-history'
import type { AppState } from '../types'
import { createTestStore } from './store-test-helpers'

describe('agent status actionHistory', () => {
  // Why: setAgentStatus schedules a real freshness setTimeout via queueMicrotask;
  // without fake timers those handles leak past the test.
  afterEach(() => {
    vi.useRealTimers()
  })

  it('appends a tool call onto actionHistory', () => {
    vi.useFakeTimers()
    const store = createTestStore()
    store.getState().setAgentStatus('tab-1:1', {
      state: 'working',
      prompt: 'p',
      agentType: 'claude',
      toolName: 'Edit',
      toolInput: '/src/config.ts'
    })
    const entry = store.getState().agentStatusByPaneKey['tab-1:1']
    expect(entry.actionHistory).toEqual([
      { toolName: 'Edit', toolInput: '/src/config.ts', at: entry.updatedAt }
    ])
  })

  it('collapses an immediate repeat of the same toolName + toolInput', () => {
    vi.useFakeTimers()
    const store = createTestStore()
    store
      .getState()
      .setAgentStatus(
        'tab-1:1',
        { state: 'working', prompt: 'p', agentType: 'claude', toolName: 'Bash', toolInput: 'ls' },
        'claude',
        { updatedAt: 1_000, stateStartedAt: 1_000 }
      )
    store
      .getState()
      .setAgentStatus(
        'tab-1:1',
        { state: 'working', prompt: 'p', agentType: 'claude', toolName: 'Bash', toolInput: 'ls' },
        'claude',
        { updatedAt: 1_100, stateStartedAt: 1_000 }
      )
    expect(store.getState().agentStatusByPaneKey['tab-1:1'].actionHistory).toHaveLength(1)
  })

  it('caps actionHistory at AGENT_ACTION_HISTORY_MAX', () => {
    vi.useFakeTimers()
    const store = createTestStore()
    for (let i = 0; i < AGENT_ACTION_HISTORY_MAX + 5; i++) {
      store.getState().setAgentStatus(
        'tab-1:1',
        {
          state: 'working',
          prompt: 'p',
          agentType: 'claude',
          toolName: 'Bash',
          toolInput: `cmd-${i}`
        },
        'claude',
        { updatedAt: 1_000 + i, stateStartedAt: 1_000 }
      )
    }
    expect(store.getState().agentStatusByPaneKey['tab-1:1'].actionHistory).toHaveLength(
      AGENT_ACTION_HISTORY_MAX
    )
  })

  it('truncates a long toolInput to 200 characters', () => {
    vi.useFakeTimers()
    const store = createTestStore()
    store.getState().setAgentStatus('tab-1:1', {
      state: 'working',
      prompt: 'p',
      agentType: 'claude',
      toolName: 'Bash',
      toolInput: 'x'.repeat(400)
    })
    expect(
      store.getState().agentStatusByPaneKey['tab-1:1'].actionHistory?.[0].toolInput
    ).toHaveLength(200)
  })

  it('clears actionHistory on a session boundary', () => {
    vi.useFakeTimers()
    const store = createTestStore()
    store.getState().setAgentStatus('tab-1:1', {
      state: 'working',
      prompt: 'p',
      agentType: 'claude',
      toolName: 'Edit',
      toolInput: 'a.ts'
    })
    store.getState().setAgentStatus('tab-1:1', {
      state: 'done',
      prompt: '',
      agentType: 'claude',
      sessionBoundary: true
    })
    expect(store.getState().agentStatusByPaneKey['tab-1:1'].actionHistory).toEqual([])
  })

  it('handles a prior entry with no actionHistory field (old snapshot / remote host) without crashing', () => {
    vi.useFakeTimers()
    const store = createTestStore()
    store.setState({
      agentStatusByPaneKey: {
        'tab-1:1': {
          state: 'working',
          prompt: 'p',
          updatedAt: 1_000,
          stateStartedAt: 1_000,
          paneKey: 'tab-1:1',
          stateHistory: []
          // Why: intentionally no `actionHistory` — simulates a pre-field snapshot.
        }
      }
    } satisfies Partial<AppState>)
    store
      .getState()
      .setAgentStatus(
        'tab-1:1',
        { state: 'working', prompt: 'p', agentType: 'claude', toolName: 'Read', toolInput: 'a.md' },
        'claude',
        { updatedAt: 1_100, stateStartedAt: 1_000 }
      )
    expect(store.getState().agentStatusByPaneKey['tab-1:1'].actionHistory).toEqual([
      { toolName: 'Read', toolInput: 'a.md', at: 1_100 }
    ])
  })
})
