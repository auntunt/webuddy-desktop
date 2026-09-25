import { app } from 'electron'
import { safelyRevealWindow } from '../window/focus-existing-window'
import { isBackgroundLaunch } from '../window/foreground-activation-policy'
import { getTrustedUIRendererWindow } from './ui'

/** Raise the main window and hand it a reveal request that only its store can act on. */
export function revealMainWindowWith(channel: string, args: unknown): void {
  const mainWindow = getTrustedUIRendererWindow()
  if (!mainWindow) {
    return
  }
  safelyRevealWindow(mainWindow)
  mainWindow.webContents.send(channel, args)
  if (!isBackgroundLaunch()) {
    try {
      app.focus({ steal: true })
    } catch {
      // Best-effort; the per-window focus above may still bring it forward.
    }
  }
}
