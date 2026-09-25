import { ipcMain } from 'electron'
import {
  isSessionCanvasPopoutSnapshot,
  type SessionCanvasPopoutSnapshot
} from '../../shared/session-canvas-popout'
import type { PopoutUIStore } from '../window/popout-window-controller'
import { sessionCanvasPopout } from '../window/session-canvas-popout-window'
import { isDashboardRevealAgentArgs } from './dashboard-payload-validation'
import { revealMainWindowWith } from './main-window-reveal-relay'
import { isTrustedUIRenderer, sendToTrustedUIRenderer } from './ui'

const CHANNELS = [
  'sessionCanvasPopout:open',
  'sessionCanvas:publishSnapshot',
  'sessionCanvas:requestSnapshot',
  'sessionCanvas:getPopoutOpen',
  'sessionCanvasPopout:revealAgent'
] as const

// Replayed to the pop-out the instant it mounts; cleared on close so a reopened
// window never flashes a previous session.
let lastSnapshot: SessionCanvasPopoutSnapshot | null = null

/** Relay between the main renderer (which owns the canvas data) and the pop-out canvas. */
export function registerSessionCanvasPopoutHandlers(store: PopoutUIStore): void {
  for (const channel of CHANNELS) {
    ipcMain.removeHandler(channel)
  }
  lastSnapshot = null
  sessionCanvasPopout.onOpenChanged((open) => {
    if (!open) {
      lastSnapshot = null
    }
  })

  ipcMain.handle('sessionCanvasPopout:open', (event): void => {
    if (isTrustedUIRenderer(event.sender)) {
      sessionCanvasPopout.createOrFocus(store)
    }
  })

  ipcMain.handle('sessionCanvas:publishSnapshot', (event, snapshot: unknown): void => {
    if (!isTrustedUIRenderer(event.sender)) {
      return
    }
    if (!isSessionCanvasPopoutSnapshot(snapshot)) {
      console.warn('[session-canvas] rejected malformed popout snapshot')
      return
    }
    // The renderer omits an unchanged worktree map; the cache keeps the last one so a
    // pop-out mounting mid-session is still replayed a complete snapshot.
    lastSnapshot =
      snapshot.worktreesByRepo === undefined && lastSnapshot?.worktreesByRepo
        ? { ...snapshot, worktreesByRepo: lastSnapshot.worktreesByRepo }
        : snapshot
    sessionCanvasPopout.getWindow()?.webContents.send('sessionCanvas:snapshot', snapshot)
  })

  // Replay the cache immediately, then ask the main renderer for a fresh one (it also
  // refreshes git status then, so the pop-out's visible-only poll drives that cadence).
  ipcMain.handle('sessionCanvas:requestSnapshot', (event): void => {
    if (!sessionCanvasPopout.isRenderer(event.sender)) {
      return
    }
    if (lastSnapshot) {
      event.sender.send('sessionCanvas:snapshot', lastSnapshot)
    }
    sendToTrustedUIRenderer('sessionCanvas:snapshotRequested', null)
  })

  ipcMain.handle('sessionCanvas:getPopoutOpen', (event): boolean =>
    isTrustedUIRenderer(event.sender) ? sessionCanvasPopout.getWindow() !== null : false
  )

  ipcMain.handle('sessionCanvasPopout:revealAgent', (event, args: unknown): void => {
    if (sessionCanvasPopout.isRenderer(event.sender) && isDashboardRevealAgentArgs(args)) {
      revealMainWindowWith('ui:revealSessionCanvasAgent', args)
    }
  })
}
