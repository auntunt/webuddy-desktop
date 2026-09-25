import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { installPopoutSnapshotPublisher } from '@/lib/popout-snapshot-publisher'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { revealDashboardAgent } from '../dashboard/reveal-dashboard-agent'
import { fetchChangedFilesForWorktrees } from './session-canvas-git-status'
import { indexRepoIdByWorktree, selectGitStatusTargets } from './session-canvas-git-targets-model'
import {
  buildSessionCanvasPopoutSnapshot,
  sessionCanvasPopoutInputsChanged
} from './session-canvas-popout-model'

// Same cadence as the dashboard relay: status pings burst, the canvas is glanceable.
const PUBLISH_THROTTLE_MS = 250

function watchCanvasInputs(onChanged: () => void): () => void {
  return useAppStore.subscribe((state, previous) => {
    if (sessionCanvasPopoutInputsChanged(state, previous)) {
      onChanged()
    }
  })
}

/**
 * MAIN-window side of the pop-out canvas. This store derives `actionHistory` and resolves
 * each worktree's git host, so it publishes what the canvas reads rather than letting the
 * pop-out rebuild it; it also runs terminal reveals the pop-out asks for.
 */
export function installSessionCanvasPopoutBridge(): () => void {
  const api = window.api.sessionCanvas
  let changedFilesByWorktree: Record<string, string[]> = {}
  let lastWorktrees: AppState['worktreesByRepo'] | null = null
  let lastEntries: AppState['agentStatusByPaneKey'] | null = null
  let gitInFlight = false
  let disposed = false

  const publish = (full: boolean): void => {
    const state = useAppStore.getState()
    const includeWorktrees = full || state.worktreesByRepo !== lastWorktrees
    lastWorktrees = state.worktreesByRepo
    // Why: a full publish may seed a pop-out starting from nothing; later ones ship diffs.
    const previousEntries = full ? null : lastEntries
    lastEntries = state.agentStatusByPaneKey
    void api.publishSnapshot(
      buildSessionCanvasPopoutSnapshot(
        state,
        changedFilesByWorktree,
        includeWorktrees,
        previousEntries
      )
    )
  }

  // Why on request: the pop-out asks on its own visible-only 15 s poll, so git status
  // follows the window the user is actually looking at.
  const refreshGitStatus = (): void => {
    if (gitInFlight) {
      return
    }
    gitInFlight = true
    const state = useAppStore.getState()
    const targets = selectGitStatusTargets(
      Object.values(state.agentStatusByPaneKey),
      indexRepoIdByWorktree(state.worktreesByRepo)
    )
    void (targets.length > 0 ? fetchChangedFilesForWorktrees(targets) : Promise.resolve({}))
      .then((next) => {
        if (disposed || JSON.stringify(next) === JSON.stringify(changedFilesByWorktree)) {
          return
        }
        changedFilesByWorktree = next
        publish(false)
      })
      .catch(() => {})
      .finally(() => {
        gitInFlight = false
      })
  }

  const stopPublisher = installPopoutSnapshotPublisher({
    throttleMs: PUBLISH_THROTTLE_MS,
    publish,
    watch: watchCanvasInputs,
    onPopoutOpenChanged: (callback) => api.onPopoutOpenChanged(callback),
    onSnapshotRequested: (callback) => api.onSnapshotRequested(callback),
    getPopoutOpen: () => api.getPopoutOpen()
  })
  const offGitRequests = api.onSnapshotRequested(refreshGitStatus)
  const offReveal = api.onRevealAgent((args) => {
    if (!revealDashboardAgent(args)) {
      toast.error(translate('sessionCanvas.card.revealFailed', '无法打开这个终端。'))
    }
  })

  return () => {
    disposed = true
    stopPublisher()
    offGitRequests()
    offReveal()
  }
}
