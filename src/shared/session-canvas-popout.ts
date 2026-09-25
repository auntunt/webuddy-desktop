import type { AgentStatusEntry } from './agent-status-types'
import type { SshConnectionState } from './ssh-types'
import type { Worktree } from './worktree/types'

/**
 * What the main window relays (through the main process) to the pop-out session canvas.
 * The main renderer's store owns this data — notably `actionHistory`, which it derives —
 * so the pop-out mirrors it rather than subscribing to agent status itself.
 * Every field must be structured-clone-safe.
 */
export type SessionCanvasPopoutSnapshot = {
  agentStatusByPaneKey: Record<string, AgentStatusEntry>
  /** Present on a delta: `agentStatusByPaneKey` then holds only changed entries, and these
   *  pane keys were removed. Receivers merge it with `mergeSessionCanvasPopoutSnapshot`. */
  removedPaneKeys?: string[]
  /** Omitted when unchanged since the previous publish; receivers keep the last one. */
  worktreesByRepo?: Record<string, Worktree[]>
  sshConnectionStates: Record<string, SshConnectionState>
  sshTargetLabels: Record<string, string>
  /** Git status is polled by the main window (it owns the host-aware runtime settings). */
  changedFilesByWorktree: Record<string, string[]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRecordOf(value: unknown, item: (entry: unknown) => boolean): boolean {
  return isRecord(value) && Object.values(value).every(item)
}

/** Shape check at the relay; the sender is the trusted main renderer. */
export function isSessionCanvasPopoutSnapshot(
  value: unknown
): value is SessionCanvasPopoutSnapshot {
  if (!isRecord(value)) {
    return false
  }
  return (
    isRecordOf(value.agentStatusByPaneKey, isRecord) &&
    (value.removedPaneKeys === undefined ||
      (Array.isArray(value.removedPaneKeys) &&
        value.removedPaneKeys.every((key) => typeof key === 'string'))) &&
    (value.worktreesByRepo === undefined ||
      isRecordOf(value.worktreesByRepo, (worktrees) => Array.isArray(worktrees))) &&
    isRecordOf(value.sshConnectionStates, isRecord) &&
    isRecordOf(value.sshTargetLabels, (label) => typeof label === 'string') &&
    isRecordOf(
      value.changedFilesByWorktree,
      (files) => Array.isArray(files) && files.every((file) => typeof file === 'string')
    )
  )
}

/** Folds a (possibly delta, possibly worktree-less) snapshot onto the last complete one. */
export function mergeSessionCanvasPopoutSnapshot(
  previous: SessionCanvasPopoutSnapshot | null,
  next: SessionCanvasPopoutSnapshot
): SessionCanvasPopoutSnapshot {
  const { removedPaneKeys, worktreesByRepo: nextWorktrees, ...rest } = next
  let agentStatusByPaneKey = next.agentStatusByPaneKey
  if (removedPaneKeys) {
    const merged = { ...previous?.agentStatusByPaneKey, ...next.agentStatusByPaneKey }
    for (const paneKey of removedPaneKeys) {
      delete merged[paneKey]
    }
    agentStatusByPaneKey = merged
  }
  const worktreesByRepo = nextWorktrees ?? previous?.worktreesByRepo
  return { ...rest, agentStatusByPaneKey, ...(worktreesByRepo ? { worktreesByRepo } : {}) }
}
