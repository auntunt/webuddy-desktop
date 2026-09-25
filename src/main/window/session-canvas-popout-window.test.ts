import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { instances, FakeWindow, sendToTrustedUIRendererMock, isMock } = vi.hoisted(() => {
  const created: FakeWindowType[] = []
  type Handler = (...args: unknown[]) => void

  class FakeWindowType {
    options: Electron.BrowserWindowConstructorOptions
    private handlers: Record<string, Handler[]> = {}
    destroyed = false
    minimized = false
    focused = false
    webContents = {
      send: vi.fn(),
      isDestroyed: () => this.destroyed,
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
      on: vi.fn(),
      setZoomLevel: vi.fn(),
      getZoomLevel: vi.fn(() => 0)
    }
    bounds = { x: 100, y: 100, width: 960, height: 720 }
    focus = vi.fn()
    show = vi.fn()
    showInactive = vi.fn()
    restore = vi.fn()
    loadURL = vi.fn()
    loadFile = vi.fn()
    close = vi.fn(() => {
      this.destroyed = true
      this.emit('close')
      this.emit('closed')
    })
    constructor(options: Electron.BrowserWindowConstructorOptions) {
      this.options = options
      created.push(this)
    }
    on(event: string, cb: Handler): this {
      ;(this.handlers[event] ||= []).push(cb)
      return this
    }
    once(event: string, cb: Handler): this {
      return this.on(event, cb)
    }
    emit(event: string, ...args: unknown[]): void {
      for (const cb of this.handlers[event] ?? []) {
        cb(...args)
      }
    }
    isDestroyed = (): boolean => this.destroyed
    isFocused = (): boolean => this.focused
    isMinimized = (): boolean => this.minimized
    isFullScreen = (): boolean => false
    getBounds = (): typeof this.bounds => this.bounds
  }

  return {
    instances: created,
    FakeWindow: FakeWindowType,
    sendToTrustedUIRendererMock: vi.fn(),
    isMock: { dev: false }
  }
})

vi.mock('electron', () => ({
  app: { on: vi.fn(), removeListener: vi.fn() },
  BrowserWindow: FakeWindow,
  nativeTheme: { shouldUseDarkColors: false },
  screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: isMock }))
vi.mock('../ipc/ui', () => ({ sendToTrustedUIRenderer: sendToTrustedUIRendererMock }))
vi.mock('./privileged-window-navigation', () => ({
  installPrivilegedWindowNavigationPolicy: vi.fn()
}))

import { sessionCanvasPopout } from './session-canvas-popout-window'
import { getDefaultUIState } from '../../shared/constants'
import type { PersistedUIState } from '../../shared/persisted-ui-state-types'

type Fake = InstanceType<typeof FakeWindow>

function makeStore(ui: Partial<PersistedUIState> = {}) {
  return {
    getUI: (): PersistedUIState => ({ ...getDefaultUIState(), ...ui }),
    updateUI: vi.fn(),
    onUIChanged: vi.fn(() => vi.fn())
  }
}

function lastWindow(): Fake {
  return instances.at(-1)!
}

describe('sessionCanvasPopout window', () => {
  beforeEach(() => {
    instances.length = 0
    isMock.dev = false
    // Why: never reveal a real window from a test run (AGENTS.md Electron UI rules).
    vi.stubEnv('ORCA_BACKGROUND_LAUNCH', '1')
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
  })
  afterEach(() => {
    sessionCanvasPopout.close()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('opens on the shared session so card positions match the main window', () => {
    sessionCanvasPopout.createOrFocus(makeStore())
    const win = instances[0]!
    expect(win.options.webPreferences?.partition).toBeUndefined()
    expect(win.options.webPreferences?.sandbox).toBe(true)
    // Why: the default session's permission policy belongs to the main window.
    expect(win.webContents.session.setPermissionRequestHandler).not.toHaveBeenCalled()
    expect(sendToTrustedUIRendererMock).toHaveBeenCalledWith(
      'sessionCanvas:popoutOpenChanged',
      true
    )
  })

  it('loads popout.html with the session-canvas surface in prod and dev', () => {
    sessionCanvasPopout.createOrFocus(makeStore())
    const [file, options] = instances[0]!.loadFile.mock.calls[0]!
    expect(String(file)).toMatch(/renderer[\\/]popout\.html$/)
    expect(options).toEqual({ query: { surface: 'session-canvas' } })
    sessionCanvasPopout.close()

    isMock.dev = true
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    sessionCanvasPopout.createOrFocus(makeStore())
    expect(instances[1]!.loadURL).toHaveBeenCalledWith(
      'http://localhost:5173/popout.html?surface=session-canvas'
    )
  })

  it('focuses (restoring if minimized) instead of opening a second window', () => {
    vi.stubEnv('ORCA_BACKGROUND_LAUNCH', undefined)
    vi.stubEnv('ORCA_E2E_HEADLESS', undefined)
    vi.stubEnv('ORCA_E2E_HEADFUL', undefined)
    const store = makeStore()
    sessionCanvasPopout.createOrFocus(store)
    const first = lastWindow()
    first.minimized = true
    const second: unknown = sessionCanvasPopout.createOrFocus(store)
    expect(instances).toHaveLength(1)
    expect(second).toBe(instances[0])
    expect(first.restore).toHaveBeenCalledTimes(1)
    expect(first.focus).toHaveBeenCalledTimes(1)
  })

  it('does not focus the existing window during a background launch', () => {
    const store = makeStore()
    sessionCanvasPopout.createOrFocus(store)
    const first = lastWindow()
    sessionCanvasPopout.createOrFocus(store)
    expect(first.focus).not.toHaveBeenCalled()
  })

  it('trusts only the live window and reports close to the main renderer', () => {
    const listener = vi.fn()
    const off = sessionCanvasPopout.onOpenChanged(listener)
    sessionCanvasPopout.createOrFocus(makeStore())
    const win = lastWindow()
    expect(sessionCanvasPopout.isRenderer(win.webContents)).toBe(true)
    expect(sessionCanvasPopout.getWindow()).toBe(win)

    sessionCanvasPopout.close()
    expect(win.close).toHaveBeenCalledTimes(1)
    expect(sessionCanvasPopout.getWindow()).toBeNull()
    expect(sessionCanvasPopout.isRenderer(win.webContents)).toBe(false)
    expect(listener.mock.calls).toEqual([[true], [false]])
    expect(sendToTrustedUIRendererMock).toHaveBeenLastCalledWith(
      'sessionCanvas:popoutOpenChanged',
      false
    )
    off()
  })

  it('restores and persists its own bounds key', () => {
    vi.useFakeTimers()
    try {
      const store = makeStore({
        sessionCanvasPopoutBounds: { x: 20, y: 30, width: 1000, height: 800 }
      })
      sessionCanvasPopout.createOrFocus(store)
      const win = lastWindow()
      expect(win.options).toMatchObject({ x: 20, y: 30, width: 1000, height: 800 })
      win.bounds = { x: 5, y: 5, width: 1100, height: 900 }
      win.emit('resize')
      vi.advanceTimersByTime(500)
      expect(store.updateUI).toHaveBeenCalledWith({
        sessionCanvasPopoutBounds: { x: 5, y: 5, width: 1100, height: 900 }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves zoom to the app-wide level (shared session)', () => {
    sessionCanvasPopout.createOrFocus(makeStore())
    const win = lastWindow()
    win.focused = true
    expect(sessionCanvasPopout.zoomIfFocused('in')).toBe(false)
    expect(win.webContents.on).not.toHaveBeenCalledWith('before-input-event', expect.anything())
  })
})
