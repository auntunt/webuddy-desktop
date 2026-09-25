// Why: split out of agent-status-live-entry-builder.ts (already near the 300-line cap)
// so the append/dedupe/cap rules for the action feed have one tested home.
import {
  AGENT_ACTION_HISTORY_INPUT_MAX_LENGTH,
  AGENT_ACTION_HISTORY_MAX,
  type AgentActionHistoryEntry
} from './agent-status-types'

export { AGENT_ACTION_HISTORY_MAX }

function truncateActionHistoryInput(toolInput: string | undefined): string | null {
  if (toolInput === undefined) {
    return null
  }
  return toolInput.length > AGENT_ACTION_HISTORY_INPUT_MAX_LENGTH
    ? toolInput.slice(0, AGENT_ACTION_HISTORY_INPUT_MAX_LENGTH)
    : toolInput
}

/**
 * Compute the next `actionHistory` for an agent status entry: appends the
 * current tool call, collapsing an immediate repeat of the same
 * toolName+toolInput into one entry, and caps the list at
 * AGENT_ACTION_HISTORY_MAX (dropping the oldest). A session boundary (new
 * session landing) clears the feed. `existing` may be undefined — an old
 * snapshot or a remote host that predates this field — and is treated as [].
 * Positional args (not an options object): the sole call site is a single
 * field in a large entry-builder literal, where a multi-line object argument
 * would push that file over its line cap.
 */
export function nextAgentActionHistory(
  existing: AgentActionHistoryEntry[] | undefined,
  toolName: string | undefined,
  toolInput: string | undefined,
  at: number,
  sessionBoundary: boolean
): AgentActionHistoryEntry[] | undefined {
  if (sessionBoundary) {
    return []
  }
  if (toolName === undefined) {
    return existing
  }
  const truncatedInput = truncateActionHistoryInput(toolInput)
  const history = existing ?? []
  const last = history.at(-1)
  if (last && last.toolName === toolName && last.toolInput === truncatedInput) {
    return history
  }
  const next = [...history, { toolName, toolInput: truncatedInput, at }]
  return next.length > AGENT_ACTION_HISTORY_MAX
    ? next.slice(next.length - AGENT_ACTION_HISTORY_MAX)
    : next
}
