import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, popout, openListeners, isTrustedMock, sendToTrustedMock, revealMock } =
  vi.hoisted(() => {
    const listeners = new Set<(open: boolean) => void>()
    return {
      handlers: new Map<string, (...args: unknown[]) => unknown>(),
      openListeners: listeners,
      popout: {
        getWindow: vi.fn((): unknown => null),
        isRenderer: vi.fn((_sender: unknown) => false),
        createOrFocus: vi.fn(),
        close: vi.fn(),
        onOpenChanged: vi.fn((listener: (open: boolean) => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        })
      },
      isTrustedMock: vi.fn((_sender: unknown) => false),
      sendToTrustedMock: vi.fn(),
      revealMock: vi.fn()
    }
  })

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: vi.fn(),
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)
  }
}))
vi.mock('../window/session-canvas-popout-window', () => ({ sessionCanvasPopout: popout }))
vi.mock('./ui', () => ({
  isTrustedUIRenderer: isTrustedMock,
  sendToTrustedUIRenderer: sendToTrustedMock
}))
vi.mock('./main-window-reveal-relay', () => ({ revealMainWindowWith: revealMock }))

import { registerSessionCanvasPopoutHandlers } from './session-canvas-popout'

const mainSender = { send: vi.fn() }
const popoutSender = { send: vi.fn() }
const strangerSender = { send: vi.fn() }
const store = { getUI: vi.fn(), updateUI: vi.fn(), onUIChanged: vi.fn() }

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    agentStatusByPaneKey: {
      'tab-1:leaf-1': { paneKey: 'tab-1:leaf-1', actionHistory: [{ kind: 'tool' }] }
    },
    worktreesByRepo: { repo: [{ id: 'repo::/wt' }] },
    sshConnectionStates: {},
    sshTargetLabels: {},
    changedFilesByWorktree: { 'repo::/wt': ['a.ts'] },
    ...overrides
  }
}

function invoke(channel: string, sender: unknown, arg?: unknown): unknown {
  return handlers.get(channel)!({ sender }, arg)
}

describe('registerSessionCanvasPopoutHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    openListeners.clear()
    isTrustedMock.mockImplementation((sender) => sender === mainSender)
    popout.isRenderer.mockImplementation((sender) => sender === popoutSender)
    popout.getWindow.mockReturnValue({ webContents: popoutSender })
    registerSessionCanvasPopoutHandlers(store)
  })
  afterEach(() => vi.clearAllMocks())

  it('opens only for the trusted main renderer', () => {
    invoke('sessionCanvasPopout:open', strangerSender)
    invoke('sessionCanvasPopout:open', popoutSender)
    expect(popout.createOrFocus).not.toHaveBeenCalled()
    invoke('sessionCanvasPopout:open', mainSender)
    expect(popout.createOrFocus).toHaveBeenCalledWith(store)
  })

  it('forwards only valid snapshots from the main renderer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    invoke('sessionCanvas:publishSnapshot', strangerSender, snapshot())
    invoke('sessionCanvas:publishSnapshot', mainSender, snapshot({ sshTargetLabels: { a: 1 } }))
    expect(popoutSender.send).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()

    const valid = snapshot()
    invoke('sessionCanvas:publishSnapshot', mainSender, valid)
    expect(popoutSender.send).toHaveBeenCalledWith('sessionCanvas:snapshot', valid)
    warn.mockRestore()
  })

  it('replays the cache (keeping the last worktree map) and nudges the main renderer', () => {
    const first = snapshot()
    invoke('sessionCanvas:publishSnapshot', mainSender, first)
    const { worktreesByRepo: _omitted, ...slim } = snapshot({ changedFilesByWorktree: {} })
    invoke('sessionCanvas:publishSnapshot', mainSender, slim)
    popoutSender.send.mockClear()

    invoke('sessionCanvas:requestSnapshot', strangerSender)
    expect(strangerSender.send).not.toHaveBeenCalled()
    expect(sendToTrustedMock).not.toHaveBeenCalled()

    invoke('sessionCanvas:requestSnapshot', popoutSender)
    expect(popoutSender.send).toHaveBeenCalledWith('sessionCanvas:snapshot', {
      ...slim,
      worktreesByRepo: first.worktreesByRepo
    })
    expect(sendToTrustedMock).toHaveBeenCalledWith('sessionCanvas:snapshotRequested', null)
  })

  it('folds delta publishes into the replay cache', () => {
    invoke('sessionCanvas:publishSnapshot', mainSender, snapshot())
    const delta = snapshot({
      agentStatusByPaneKey: { 'tab-2:leaf-1': { paneKey: 'tab-2:leaf-1' } },
      removedPaneKeys: ['tab-1:leaf-1']
    })
    invoke('sessionCanvas:publishSnapshot', mainSender, delta)
    expect(popoutSender.send).toHaveBeenLastCalledWith('sessionCanvas:snapshot', delta)
    popoutSender.send.mockClear()
    invoke('sessionCanvas:requestSnapshot', popoutSender)
    const replayed = popoutSender.send.mock.calls[0]?.[1]
    expect(Object.keys(replayed.agentStatusByPaneKey)).toEqual(['tab-2:leaf-1'])
    expect(replayed.removedPaneKeys).toBeUndefined()
  })

  it('drops the cache when the pop-out closes so a reopen never shows a stale canvas', () => {
    invoke('sessionCanvas:publishSnapshot', mainSender, snapshot())
    for (const listener of openListeners) {
      listener(false)
    }
    popoutSender.send.mockClear()
    invoke('sessionCanvas:requestSnapshot', popoutSender)
    expect(popoutSender.send).not.toHaveBeenCalled()
    expect(sendToTrustedMock).toHaveBeenCalledWith('sessionCanvas:snapshotRequested', null)
  })

  it('reports open state only to the main renderer', () => {
    expect(invoke('sessionCanvas:getPopoutOpen', mainSender)).toBe(true)
    expect(invoke('sessionCanvas:getPopoutOpen', strangerSender)).toBe(false)
    popout.getWindow.mockReturnValue(null)
    expect(invoke('sessionCanvas:getPopoutOpen', mainSender)).toBe(false)
  })

  it('relays reveal requests from the pop-out to the main window', () => {
    const args = { repoId: 'repo', worktreeId: 'repo::/wt', tabId: 'tab-1', leafId: 'leaf-1' }
    invoke('sessionCanvasPopout:revealAgent', mainSender, args)
    invoke('sessionCanvasPopout:revealAgent', popoutSender, { tabId: 'tab-1' })
    expect(revealMock).not.toHaveBeenCalled()
    invoke('sessionCanvasPopout:revealAgent', popoutSender, args)
    expect(revealMock).toHaveBeenCalledWith('ui:revealSessionCanvasAgent', args)
  })
})
