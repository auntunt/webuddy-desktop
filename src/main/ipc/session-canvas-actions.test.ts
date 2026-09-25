import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))

import { createSessionCanvasActions, type SessionCanvasActionDeps } from './session-canvas-actions'

const meta = { runtimeId: 'rt' }
const success = (result: unknown) => ({ id: 'x', ok: true as const, result, _meta: meta })
const failure = (message: string) => ({
  id: 'x',
  ok: false as const,
  error: { code: 'terminal_worktree_mismatch', message },
  _meta: meta
})

function makeDeps(overrides: Partial<SessionCanvasActionDeps> = {}) {
  const handles: Record<string, string> = { 'pane-a': 'term_a', 'pane-b': 'term_b' }
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

describe('sessionCanvas supervise', () => {
  const args = { coordinatorPaneKey: 'pane-a', workerPaneKey: 'pane-b', task: 'fix the bug' }

  it('starts B as a worker of A on the existing run and returns the dispatch id', async () => {
    const { deps, callRuntime } = makeDeps()
    callRuntime.mockResolvedValue(success({ dispatchId: 'd1', state: 'ready' }))
    const result = await createSessionCanvasActions(deps).supervise(args)
    expect(result).toEqual({ ok: true, dispatchId: 'd1' })
    expect(callRuntime).toHaveBeenCalledTimes(1)
    expect(callRuntime).toHaveBeenCalledWith('orchestration.workerStart', {
      from: 'term_a',
      terminal: 'term_b',
      spec: 'fix the bug'
    })
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
      { from: 'term_a', objective: 'fix the bug' }
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
})
