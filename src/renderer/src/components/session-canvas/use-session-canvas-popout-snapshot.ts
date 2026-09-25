import { useEffect, useState } from 'react'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { useAppStore } from '@/store'
import { sessionCanvasPopoutStorePatch } from './session-canvas-popout-model'
import { SESSION_CANVAS_GIT_POLL_MS } from './use-session-canvas-sources'

export type SessionCanvasPopoutView = {
  /** False until the first snapshot lands, so the canvas never flashes "no sessions". */
  ready: boolean
  changedFilesByWorktree: Record<string, string[]>
}

const EMPTY_CHANGED: Record<string, string[]> = {}

/**
 * Pop-out side of the canvas relay: mirror each snapshot into this window's store (the
 * cards read it exactly as they do in the main window) and keep asking while visible —
 * each request also makes the main window refresh git status.
 */
export function useSessionCanvasPopoutSnapshot(): SessionCanvasPopoutView {
  const [view, setView] = useState<SessionCanvasPopoutView>({
    ready: false,
    changedFilesByWorktree: EMPTY_CHANGED
  })

  useEffect(() => {
    const api = window.api.sessionCanvas
    const offSnapshot = api.onSnapshot((snapshot) => {
      useAppStore.setState(
        sessionCanvasPopoutStorePatch(snapshot, useAppStore.getState().worktreesByRepo)
      )
      setView((current) =>
        current.ready &&
        JSON.stringify(current.changedFilesByWorktree) ===
          JSON.stringify(snapshot.changedFilesByWorktree)
          ? current
          : { ready: true, changedFilesByWorktree: snapshot.changedFilesByWorktree }
      )
    })
    // Why unconditional: a window opened in the background may never report visible, and
    // the replay is its only copy of the data.
    void api.requestSnapshot()
    const stopPolling = installWindowVisibilityInterval({
      run: () => void api.requestSnapshot(),
      intervalMs: SESSION_CANVAS_GIT_POLL_MS
    })
    return () => {
      offSnapshot()
      stopPolling()
    }
  }, [])

  return view
}
