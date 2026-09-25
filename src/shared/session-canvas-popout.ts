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
