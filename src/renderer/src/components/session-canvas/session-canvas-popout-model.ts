import type { AppState } from '@/store/types'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { SessionCanvasPopoutSnapshot } from '../../../../shared/session-canvas-popout'

// Cards show one reply line; approval detection needs the numbered options below the ask.
export const SESSION_CANVAS_POPOUT_REPLY_MAX_CHARS = 2000

function capReply(text: string | undefined): string | undefined {
  return text !== undefined && text.length > SESSION_CANVAS_POPOUT_REPLY_MAX_CHARS
    ? text.slice(0, SESSION_CANVAS_POPOUT_REPLY_MAX_CHARS)
    : text
}

const slimEntries = new WeakMap<AgentStatusEntry, AgentStatusEntry>()

/** Only the fields the canvas (cards, lineage, dedupe, same-file edges) reads. */
export function slimPopoutAgentStatusEntry(entry: AgentStatusEntry): AgentStatusEntry {
  const cached = slimEntries.get(entry)
  if (cached) {
    return cached
  }
  const needsYou = entry.state === 'waiting' || entry.state === 'blocked'
  const slim: AgentStatusEntry = {
    state: entry.state,
    prompt: entry.prompt,
    updatedAt: entry.updatedAt,
    stateStartedAt: entry.stateStartedAt,
    paneKey: entry.paneKey,
    stateHistory: [],
    agentType: entry.agentType,
    terminalHandle: entry.terminalHandle,
    worktreeId: entry.worktreeId,
    connectionId: entry.connectionId,
    tabId: entry.tabId,
    terminalTitle: entry.terminalTitle,
    actionHistory: entry.actionHistory,
    toolName: entry.toolName,
    toolInput: entry.toolInput,
    // Why: only a paused session renders its question/approval card.
    interactivePrompt: needsYou ? entry.interactivePrompt : undefined,
    lastAssistantMessage: capReply(entry.lastAssistantMessage),
    lastAssistantMessageIsToolOutput: entry.lastAssistantMessageIsToolOutput,
    lastCompletedAssistantMessage: capReply(entry.lastCompletedAssistantMessage),
    orchestration: entry.orchestration,
    subagents: entry.subagents,
    providerSession: entry.providerSession
  }
  slimEntries.set(entry, slim)
  return slim
}

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

function agentStatusDelta(
  current: Record<string, AgentStatusEntry>,
  previous: Record<string, AgentStatusEntry> | null
): Pick<SessionCanvasPopoutSnapshot, 'agentStatusByPaneKey' | 'removedPaneKeys'> {
  const agentStatusByPaneKey: Record<string, AgentStatusEntry> = {}
  for (const [paneKey, entry] of Object.entries(current)) {
    if (!previous || previous[paneKey] !== entry) {
      agentStatusByPaneKey[paneKey] = slimPopoutAgentStatusEntry(entry)
    }
  }
  if (!previous) {
    return { agentStatusByPaneKey }
  }
  const removedPaneKeys = Object.keys(previous).filter((paneKey) => !(paneKey in current))
  return { agentStatusByPaneKey, removedPaneKeys }
}

/**
 * Plain-data snapshot of slimmed entries. With `previousEntries` (the store map last sent)
 * it is a delta of changed entries plus removals; the worktree map can be omitted too.
 */
export function buildSessionCanvasPopoutSnapshot(
  state: SessionCanvasPopoutSourceState,
  changedFilesByWorktree: Record<string, string[]>,
  includeWorktrees: boolean,
  previousEntries: Record<string, AgentStatusEntry> | null = null
): SessionCanvasPopoutSnapshot {
  return {
    ...agentStatusDelta(state.agentStatusByPaneKey, previousEntries),
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
