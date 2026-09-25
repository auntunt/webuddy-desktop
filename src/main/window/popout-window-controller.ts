import { app, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { Store } from '../persistence'
import { isBackgroundLaunch, showWindowWithoutStealingFocus } from './foreground-activation-policy'
import { rectHasVisibleAreaOnAnyDisplay } from './window-bounds-validation'
import { sendToTrustedUIRenderer } from '../ipc/ui'
import { installPrivilegedWindowNavigationPolicy } from './privileged-window-navigation'
import type { UIZoomDirection } from '../../shared/ui-zoom-level'
import type { KeybindingOverrides } from '../../shared/keybindings'
import { installPopoutWindowLocalZoom, zoomPopoutWindow } from './popout-window-zoom'

const MIN_WIDTH = 480
const MIN_HEIGHT = 360
const DEFAULT_WIDTH = 960
const DEFAULT_HEIGHT = 720

type PopoutBounds = { x: number; y: number; width: number; height: number }

export type PopoutWindowConfig = {
  logTag: string
  title: string
  /** Sent to the main renderer whenever the pop-out opens or closes. */
  openChangedChannel: string
  boundsKey: 'dashboardPopoutBounds' | 'sessionCanvasPopoutBounds'
  /** `?surface=` for popout.html; the dashboard is the query-less default. */
  surface?: string
  /**
   * Separate in-memory session: window-local zoom and deny-all permissions. Omit it when
   * the pop-out must share the main window's browser storage (and therefore its zoom).
   */
  partition?: string
}

/** The persisted-UI slice a pop-out needs: restored bounds and the app-wide zoom. */
export type PopoutUIStore = Pick<Store, 'getUI' | 'updateUI' | 'onUIChanged'>

export type PopoutOpenOptions = { getKeybindings?: () => KeybindingOverrides | undefined }

export type PopoutWindowController = {
  getWindow: () => BrowserWindow | null
  /** Identity check against the live window's webContents. */
  isRenderer: (sender: object) => boolean
  /** False when closed, unfocused, or sharing zoom with the main window. */
  zoomIfFocused: (direction: UIZoomDirection) => boolean
  onOpenChanged: (listener: (open: boolean) => void) => () => void
  createOrFocus: (store: PopoutUIStore | null, options?: PopoutOpenOptions) => BrowserWindow
  close: () => void
}

/**
 * Singleton companion window (native frame, shared preload, its own React root in
 * popout.html). A second open request focuses the existing window.
 */
export function createPopoutWindowController(config: PopoutWindowConfig): PopoutWindowController {
  let popoutWindow: BrowserWindow | null = null
  const openListeners = new Set<(open: boolean) => void>()

  const getWindow = (): BrowserWindow | null =>
    popoutWindow && !popoutWindow.isDestroyed() && !popoutWindow.webContents.isDestroyed()
      ? popoutWindow
      : null

  // Why: the main renderer's snapshot publisher only runs while the pop-out is
  // open. Tell that exact window when the state flips, then notify listeners.
  const broadcastOpenChanged = (open: boolean): void => {
    sendToTrustedUIRenderer(config.openChangedChannel, open)
    for (const listener of openListeners) {
      listener(open)
    }
  }

  const load = (window: BrowserWindow): void => {
    // Why: mirror loadMainWindow's dev/prod branch — the dev server serves the
    // second HTML entry, prod loads the emitted file.
    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      const query = config.surface ? `?surface=${encodeURIComponent(config.surface)}` : ''
      void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/popout.html${query}`)
    } else if (config.surface) {
      void window.loadFile(join(__dirname, '../renderer/popout.html'), {
        query: { surface: config.surface }
      })
    } else {
      void window.loadFile(join(__dirname, '../renderer/popout.html'))
    }
  }

  const resolveRestoredBounds = (store: PopoutUIStore | null): PopoutBounds | null => {
    const raw = store?.getUI()[config.boundsKey] ?? null
    if (
      raw &&
      raw.width >= MIN_WIDTH &&
      raw.height >= MIN_HEIGHT &&
      rectHasVisibleAreaOnAnyDisplay(raw, MIN_WIDTH / 2, MIN_HEIGHT / 2)
    ) {
      return raw
    }
    if (raw) {
      console.warn(`[${config.logTag}] Discarding off-screen/near-min popout bounds:`, raw)
    }
    return null
  }

  const installBoundsPersistence = (window: BrowserWindow, store: PopoutUIStore | null): void => {
    // Mirrors the main window's debounced/frozen approach so teardown-time
    // resize/move events can't clobber the remembered size with near-minimum bounds.
    let boundsTimer: ReturnType<typeof setTimeout> | null = null
    let windowClosing = false
    const saveBounds = (): void => {
      if (boundsTimer) {
        clearTimeout(boundsTimer)
      }
      boundsTimer = setTimeout(() => {
        boundsTimer = null
        if (
          windowClosing ||
          window.isDestroyed() ||
          window.isMinimized() ||
          window.isFullScreen()
        ) {
          return
        }
        const bounds = window.getBounds()
        if (bounds.width < MIN_WIDTH || bounds.height < MIN_HEIGHT) {
          return
        }
        store?.updateUI({ [config.boundsKey]: bounds })
      }, 500)
    }
    window.on('resize', saveBounds)
    window.on('move', saveBounds)
    const freezeBounds = (): void => {
      windowClosing = true
      if (boundsTimer) {
        clearTimeout(boundsTimer)
        boundsTimer = null
      }
    }
    window.on('close', freezeBounds)
    app.on('before-quit', freezeBounds)
    window.on('closed', () => app.removeListener('before-quit', freezeBounds))
  }

  const createOrFocus = (
    store: PopoutUIStore | null,
    options: PopoutOpenOptions = {}
  ): BrowserWindow => {
    if (popoutWindow && !popoutWindow.isDestroyed()) {
      if (popoutWindow.isMinimized()) {
        popoutWindow.restore()
      }
      if (!isBackgroundLaunch()) {
        popoutWindow.focus()
      }
      return popoutWindow
    }

    const savedBounds = resolveRestoredBounds(store)
    const window = new BrowserWindow({
      width: savedBounds?.width ?? DEFAULT_WIDTH,
      height: savedBounds?.height ?? DEFAULT_HEIGHT,
      ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      title: config.title,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
      // Why: a standard native frame keeps the pop-out movable/closable on every
      // platform without reimplementing the main window's custom titlebar chrome.
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        // Why: Chromium shares zoom by origin; a separate session keeps pop-out zoom window-local.
        ...(config.partition ? { partition: config.partition } : {}),
        // Why: plain DOM, no <webview> guests — and so deliberately not stamped with
        // the browser-host id: every client-placed page is a mirror to this renderer.
        webviewTag: false
      }
    })
    installPrivilegedWindowNavigationPolicy(window.webContents)
    if (config.partition) {
      // Why: isolated sessions do not inherit the main session's deny-by-default permission policy.
      window.webContents.session.setPermissionRequestHandler(
        (_webContents, _permission, callback) => callback(false)
      )
      window.webContents.session.setPermissionCheckHandler(() => false)
    }
    popoutWindow = window
    broadcastOpenChanged(true)

    // Why: uiZoomLevel is the app-wide UI zoom; without this the pop-out always
    // renders at 100% while the main window honors the persisted level.
    window.webContents.on('dom-ready', () => {
      if (!window.isDestroyed()) {
        window.webContents.setZoomLevel(store?.getUI().uiZoomLevel ?? 0)
      }
    })
    // Compare against the last followed value, not the live level, so a window-local
    // zoom is not snapped back until the app-wide level actually changes.
    let lastFollowedZoomLevel = store?.getUI().uiZoomLevel ?? 0
    const unsubscribeUIChanged = store?.onUIChanged((ui) => {
      const level = ui.uiZoomLevel ?? 0
      if (level === lastFollowedZoomLevel) {
        return
      }
      lastFollowedZoomLevel = level
      if (!window.isDestroyed()) {
        window.webContents.setZoomLevel(level)
      }
    })
    if (config.partition) {
      installPopoutWindowLocalZoom(window, options.getKeybindings)
    }

    window.once('ready-to-show', () => {
      showWindowWithoutStealingFocus(window)
    })
    installBoundsPersistence(window, store)

    window.on('closed', () => {
      unsubscribeUIChanged?.()
      if (popoutWindow === window) {
        popoutWindow = null
      }
      broadcastOpenChanged(false)
    })

    load(window)
    return window
  }

  return {
    getWindow,
    isRenderer: (sender) => getWindow()?.webContents === sender,
    zoomIfFocused: (direction) => {
      const popout = getWindow()
      if (!config.partition || !popout || !popout.isFocused()) {
        return false
      }
      zoomPopoutWindow(popout, direction)
      return true
    },
    onOpenChanged: (listener) => {
      openListeners.add(listener)
      return () => openListeners.delete(listener)
    },
    createOrFocus,
    close: () => {
      if (popoutWindow && !popoutWindow.isDestroyed()) {
        popoutWindow.close()
      }
      popoutWindow = null
    }
  }
}
