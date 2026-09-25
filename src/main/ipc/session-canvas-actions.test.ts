import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))

import {
  SUPERVISE_IN_FLIGHT_REASON,
  createSessionCanvasActions,
  parseClosePaneArgs,
  parseSendPromptArgs,
  parseSuperviseArgs,
  type SessionCanvasActionDeps
} from './session-canvas-actions'

const meta = { runtimeId: 'rt' }
const success = (result: unknown) => ({ id: 'x', ok: true as const, result, _meta: meta })
const failure = (message: string) => ({
  id: 'x',
  ok: false as const,
  error: { code: 'terminal_worktree_mismatch', message },
  _meta: meta
})

function makeDeps(overrides: Partial<SessionCanvasActionDeps> = {}) {
  const handles: Record<string, string> = {
    'pane-a': 'term_a',
    'pane-b': 'term_b',
    'pane-c': 'term_c'
  }
  const callRuntime = vi.fn<SessionCanvasActionDeps['callRuntime']>()
  const deps: SessionCanvasActionDeps = {
    resolveTerminalHandle: (paneKey) => handles[paneKey] ?? null,
    hasCurrentRun: () => true,
    callRuntime,
    ...overrides
  }
  return { deps, callRuntime }
}

describe('sessionCanvas sendPrompt', () => {
  it('sends the prompt through terminal.send as an agent prompt', async () => {
    const { deps, callRuntime } = makeDeps()
    callRuntime.mockResolvedValue(success({ send: { handle: 'term_a', accepted: true } }))
    const result = await createSessionCanvasActions(deps).sendPrompt({
      paneKey: 'pane-a',
      text: 'hello'
    })
    expect(result).toEqual({ ok: true })
    expect(callRuntime).toHaveBeenCalledWith('terminal.send', {
      terminal: 'term_a',
      text: 'hello',
      enter: true,
      agentPrompt: true,
      client: { id: 'session-canvas', type: 'desktop' }
    })
  })

  it('writes approval keys raw, without paste wrapping or Enter', async () => {
    const { deps, callRuntime } = makeDeps()
    callRuntime.mockResolvedValue(success({ send: { handle: 'term_a', accepted: true } }))
    const result = await createSessionCanvasActions(deps).sendPrompt({
      paneKey: 'pane-a',
      text: '\x1b',
      keys: true
    })
    expect(result).toEqual({ ok: true })
    expect(callRuntime).toHaveBeenCalledWith('terminal.send', {
      terminal: 'term_a',
      text: '\x1b',
      client: { id: 'session-canvas', type: 'desktop' }
    })
  })

  it('parses the optional keys flag', () => {
    expect(parseSendPromptArgs({ paneKey: 'p', text: '1', keys: true })).toEqual({
      paneKey: 'p',
      text: '1',
      keys: true
    })
    expect(parseSendPromptArgs({ paneKey: 'p', text: 'hi', keys: 'yes' })).toEqual({
      paneKey: 'p',
      text: 'hi'
    })
  })

  it('refuses empty text without touching the runtime', async () => {
    const { deps, callRuntime } = makeDeps()
    const result = await createSessionCanvasActions(deps).sendPrompt({
      paneKey: 'pane-a',
      text: '   '
    })
    expect(result.ok).toBe(false)
    expect(callRuntime).not.toHaveBeenCalled()
  })

  it('refuses an unknown paneKey', async () => {
    const { deps, callRuntime } = makeDeps()
    const result = await createSessionCanvasActions(deps).sendPrompt({
      paneKey: 'pane-z',
      text: 'hi'
    })
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('pane-z') })
    expect(callRuntime).not.toHaveBeenCalled()
  })

  it('reports a refused send with its reason', async () => {
    const { deps, callRuntime } = makeDeps()
    callRuntime.mockResolvedValue(
      success({ send: { accepted: false, bytesWritten: 0, refusedReason: 'permission_prompt' } })
    )
    const result = await createSessionCanvasActions(deps).sendPrompt({
      paneKey: 'pane-a',
      text: 'hi'
    })
    expect(result).toEqual({ ok: false, reason: 'permission_prompt' })
  })

  it('passes an RPC error message through', async () => {
    const { deps, callRuntime } = makeDeps()
    callRuntime.mockResolvedValue(failure('terminal_handle_stale'))
    const result = await createSessionCanvasActions(deps).sendPrompt({
      paneKey: 'pane-a',
      text: 'hi'
    })
    expect(result).toEqual({ ok: false, reason: 'terminal_handle_stale' })
  })
})

describe('sessionCanvas closePane', () => {
  it('closes only that pane through terminal.close', async () => {
    const { deps, callRuntime } = makeDeps()
    callRuntime.mockResolvedValue(success({ close: { handle: 'term_b' } }))
    const result = await createSessionCanvasActions(deps).closePane({ paneKey: 'pane-b' })
    expect(result).toEqual({ ok: true })
    expect(callRuntime).toHaveBeenCalledWith('terminal.close', { terminal: 'term_b' })
  })

  it('refuses an unknown paneKey', async () => {
    const { deps, callRuntime } = makeDeps()
    const result = await createSessionCanvasActions(deps).closePane({ paneKey: 'pane-z' })
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('pane-z') })
    expect(callRuntime).not.toHaveBeenCalled()
  })

  it('passes an RPC error message through', async () => {
    const { deps, callRuntime } = makeDeps()
    callRuntime.mockResolvedValue(failure('terminal_handle_stale'))
    const result = await createSessionCanvasActions(deps).closePane({ paneKey: 'pane-a' })
    expect(result).toEqual({ ok: false, reason: 'terminal_handle_stale' })
  })

  it('parses only a string paneKey', () => {
    expect(parseClosePaneArgs({ paneKey: 'p' })).toEqual({ paneKey: 'p' })
    expect(parseClosePaneArgs({ paneKey: 1 })).toBeNull()
    expect(parseClosePaneArgs(null)).toBeNull()
  })
})

describe('sessionCanvas supervise', () => {
  const args = { coordinatorPaneKey: 'pane-a', workerPaneKey: 'pane-b', task: 'fix the bug' }

  it('starts B as a worker of A on the existing run and returns the dispatch id', async () => {
    const { deps, callRuntime } = makeDeps()
    callRuntime.mockResolvedValue(success({ dispatchId: 'd1', state: 'ready' }))
    const result = await createSessionCanvasActions(deps).supervise(args)
    expect(result).toEqual({ ok: true, dispatchId: 'd1' })
    expect(callRuntime).toHaveBeenCalledTimes(1)
    expect(callRuntime).toHaveBeenCalledWith(
      'orchestration.workerStart',
      { from: 'term_a', terminal: 'term_b', spec: 'fix the bug' },
      { requestId: expect.stringMatching(/^session-canvas-start-/) }
    )
  })

  it('creates a run for the coordinator when none is bound', async () => {
    const { deps, callRuntime } = makeDeps({ hasCurrentRun: () => false })
    callRuntime
      .mockResolvedValueOnce(success({ run: { id: 'run_1' } }))
      .mockResolvedValueOnce(success({ dispatchId: 'd2', state: 'ready' }))
    const result = await createSessionCanvasActions(deps).supervise(args)
    expect(result).toEqual({ ok: true, dispatchId: 'd2' })
    expect(callRuntime.mock.calls[0]).toEqual([
      'orchestration.runCreate',
      { from: 'term_a', objective: 'fix the bug' },
      { requestId: expect.stringMatching(/^session-canvas-run-/) }
    ])
    expect(callRuntime.mock.calls[1]?.[0]).toBe('orchestration.workerStart')
  })

  it('passes the worker-terminal validation message through verbatim', async () => {
    const { deps, callRuntime } = makeDeps()
    const message = 'Terminal term_b does not belong to worktree wt1.'
    callRuntime.mockResolvedValue(failure(message))
    const result = await createSessionCanvasActions(deps).supervise(args)
    expect(result).toEqual({ ok: false, reason: message })
  })

  it('reports a failed start receipt using its lastError', async () => {
    const { deps, callRuntime } = makeDeps()
    callRuntime.mockResolvedValue(
      success({ dispatchId: 'd3', state: 'failed', lastError: 'Agent did not become ready.' })
    )
    const result = await createSessionCanvasActions(deps).supervise(args)
    expect(result).toEqual({ ok: false, reason: 'Agent did not become ready.' })
  })

  it('refuses an empty task and unknown panes', async () => {
    const { deps, callRuntime } = makeDeps()
    const actions = createSessionCanvasActions(deps)
    expect((await actions.supervise({ ...args, task: ' ' })).ok).toBe(false)
    expect((await actions.supervise({ ...args, workerPaneKey: 'pane-z' })).ok).toBe(false)
    expect((await actions.supervise({ ...args, coordinatorPaneKey: 'pane-z' })).ok).toBe(false)
    expect(callRuntime).not.toHaveBeenCalled()
  })

  it('reports outcome_unknown as a failure that keeps the dispatch id', async () => {
    const { deps, callRuntime } = makeDeps()
    callRuntime.mockResolvedValue(
      success({ dispatchId: 'd4', state: 'outcome_unknown', lastError: 'turn not observed' })
    )
    const result = await createSessionCanvasActions(deps).supervise(args)
    expect(result).toEqual({ ok: false, reason: 'turn not observed', dispatchId: 'd4' })
  })

  it('refuses a concurrent second supervise of the same pair and creates at most one run', async () => {
    let hasRun = false
    const { deps, callRuntime } = makeDeps({ hasCurrentRun: () => hasRun })
    callRuntime.mockImplementation(async (method) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (method === 'orchestration.runCreate') {
        hasRun = true
        return success({ run: { id: 'run_1' } })
      }
      return success({ dispatchId: 'd5', state: 'ready' })
    })
    const actions = createSessionCanvasActions(deps)
    const [first, second] = await Promise.all([actions.supervise(args), actions.supervise(args)])
    expect(first).toEqual({ ok: true, dispatchId: 'd5' })
    expect(second).toEqual({ ok: false, reason: SUPERVISE_IN_FLIGHT_REASON })
    const methods = callRuntime.mock.calls.map((call) => call[0])
    expect(methods.filter((m) => m === 'orchestration.runCreate')).toHaveLength(1)
    expect(methods.filter((m) => m === 'orchestration.workerStart')).toHaveLength(1)
  })

  it('serializes run creation across different workers of one coordinator', async () => {
    let hasRun = false
    const { deps, callRuntime } = makeDeps({ hasCurrentRun: () => hasRun })
    callRuntime.mockImplementation(async (method) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (method === 'orchestration.runCreate') {
        hasRun = true
        return success({ run: { id: 'run_1' } })
      }
      return success({ dispatchId: 'd6', state: 'ready' })
    })
    const actions = createSessionCanvasActions(deps)
    const results = await Promise.all([
      actions.supervise(args),
      actions.supervise({ ...args, workerPaneKey: 'pane-c' })
    ])
    expect(results.every((r) => r.ok)).toBe(true)
    const methods = callRuntime.mock.calls.map((call) => call[0])
    expect(methods.filter((m) => m === 'orchestration.runCreate')).toHaveLength(1)
    expect(methods.filter((m) => m === 'orchestration.workerStart')).toHaveLength(2)
    const requestIds = callRuntime.mock.calls.map((call) => call[2]?.requestId)
    expect(new Set(requestIds).size).toBe(requestIds.length)
  })
})

describe('sessionCanvas IPC argument parsing', () => {
  it('accepts well-typed args and rejects anything else', () => {
    expect(parseSendPromptArgs({ paneKey: 'p', text: 't' })).toEqual({ paneKey: 'p', text: 't' })
    expect(parseSendPromptArgs({ paneKey: 'p', text: 3 })).toBeNull()
    expect(parseSendPromptArgs(null)).toBeNull()
    expect(parseSuperviseArgs({ coordinatorPaneKey: 'a', workerPaneKey: 'b', task: 't' })).toEqual({
      coordinatorPaneKey: 'a',
      workerPaneKey: 'b',
      task: 't'
    })
    expect(parseSuperviseArgs({ coordinatorPaneKey: 'a', workerPaneKey: 'b' })).toBeNull()
    expect(parseSuperviseArgs('x')).toBeNull()
  })
})
