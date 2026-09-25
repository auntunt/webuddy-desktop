import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { formatAgentTypeLabel } from '../../../../shared/agent-type-label'
import type { DashboardRevealAgentArgs } from '../../../../shared/dashboard-snapshot'
import type { SshConnectionStatus } from '../../../../shared/ssh-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'

/** SSH-boundary vocabulary: a local row, a reachable host, or a host we cannot reach. */
export type LiveSessionHostVerdict = 'local' | 'live' | 'unverifiable'

export function liveSessionHostVerdict(
  connectionId: string | null | undefined,
  sshStatus: SshConnectionStatus | null
): LiveSessionHostVerdict {
  if (!connectionId) {
    return 'local'
  }
  // Why: losing the host is never evidence the agent ended (ssh-execution-boundary.md).
  return sshStatus === 'connected' ? 'live' : 'unverifiable'
}

export function liveSessionTitle(entry: AgentStatusEntry): string {
  return entry.terminalTitle?.trim() || entry.prompt.trim() || formatAgentTypeLabel(entry.agentType)
}

export function liveSessionTabId(entry: AgentStatusEntry): string | null {
  return entry.tabId ?? parsePaneKey(entry.paneKey)?.tabId ?? null
}

export function liveSessionRevealArgs(entry: AgentStatusEntry): DashboardRevealAgentArgs | null {
  const tabId = liveSessionTabId(entry)
  if (!entry.worktreeId || !tabId) {
    return null
  }
  return {
    repoId: getRepoIdFromWorktreeId(entry.worktreeId),
    worktreeId: entry.worktreeId,
    tabId,
    leafId: parsePaneKey(entry.paneKey)?.leafId ?? null
  }
}
