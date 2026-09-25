import type { AppState } from '@/store/types'
import type { SessionCanvasPopoutSnapshot } from '../../../../shared/session-canvas-popout'

/** Store slices the canvas (graph + cards) reads, mirrored into the pop-out's own store. */
export type SessionCanvasPopoutSourceState = Pick<
  AppState,
  'agentStatusByPaneKey' | 'worktreesByRepo' | 'sshConnectionStates' | 'sshTargetLabels'
>

export function sessionCanvasPopoutInputsChanged(
  state: SessionCanvasPopoutSourceState,
  previous: SessionCanvasPopoutSourceState
): boolean {
  return (
    state.agentStatusByPaneKey !== previous.agentStatusByPaneKey ||
    state.worktreesByRepo !== previous.worktreesByRepo ||
    state.sshConnectionStates !== previous.sshConnectionStates ||
    state.sshTargetLabels !== previous.sshTargetLabels
  )
}

/** Plain-data snapshot; the worktree map is the only bulky field, so it can be omitted. */
export function buildSessionCanvasPopoutSnapshot(
  state: SessionCanvasPopoutSourceState,
  changedFilesByWorktree: Record<string, string[]>,
  includeWorktrees: boolean
): SessionCanvasPopoutSnapshot {
  return {
    agentStatusByPaneKey: state.agentStatusByPaneKey,
    ...(includeWorktrees ? { worktreesByRepo: state.worktreesByRepo } : {}),
    sshConnectionStates: Object.fromEntries(state.sshConnectionStates),
    sshTargetLabels: Object.fromEntries(state.sshTargetLabels),
    changedFilesByWorktree
  }
}

/** The pop-out store write for one snapshot; an omitted worktree map keeps `retained`. */
export function sessionCanvasPopoutStorePatch(
  snapshot: SessionCanvasPopoutSnapshot,
  retainedWorktrees: SessionCanvasPopoutSourceState['worktreesByRepo']
): SessionCanvasPopoutSourceState {
  return {
    agentStatusByPaneKey: snapshot.agentStatusByPaneKey,
    worktreesByRepo: snapshot.worktreesByRepo ?? retainedWorktrees,
    sshConnectionStates: new Map(Object.entries(snapshot.sshConnectionStates)),
    sshTargetLabels: new Map(Object.entries(snapshot.sshTargetLabels))
  }
}
