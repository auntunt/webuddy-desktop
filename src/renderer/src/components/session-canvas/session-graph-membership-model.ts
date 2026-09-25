import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import {
  getRuntimePathBasename,
  isPathInsideOrEqual,
  normalizeRuntimePathForComparison
} from '../../../../shared/cross-platform-path'
import type { SessionCanvasExternalSession } from '../../../../shared/session-canvas-types'
import { splitWorktreeId, splitWorktreeIdForFilesystem } from '../../../../shared/worktree/id'
import type {
  CanvasSession,
  SessionCanvasFilters,
  SessionCanvasInputs
} from './session-graph-types'

export const SESSION_CANVAS_OTHER_GROUP_ID = 'group:other'
// Why: fallback text only; the UI translates this group by SESSION_CANVAS_OTHER_GROUP_ID.
export const SESSION_CANVAS_OTHER_GROUP_LABEL = '其他'
export const SESSION_CANVAS_EXTERNAL_STATE = 'external'

// Why: live agentType uses TuiAgent ids, AI Vault uses a subset; only variants differ.
const AGENT_ALIASES: Record<string, string> = { 'claude-agent-teams': 'claude' }

export function normalizeCanvasAgent(agent: string | undefined): string {
  const id = (agent ?? '').trim().toLowerCase() || 'unknown'
  return AGENT_ALIASES[id] ?? id
}

export function liveNodeId(paneKey: string): string {
  return `live:${paneKey}`
}

type RepoIndex = {
  repoIdForWorktree: (worktreeId: string | undefined) => string | null
  repoLabel: (repoId: string) => string | null
  /** Repo whose known worktree contains `cwd` (deepest match wins). */
  repoIdForPath: (cwd: string) => string | null
}

function buildRepoIndex(inputs: SessionCanvasInputs): RepoIndex {
  const repoIdForWorktree = (worktreeId: string | undefined): string | null =>
    worktreeId
      ? (inputs.repoIdByWorktree[worktreeId] ?? splitWorktreeId(worktreeId)?.repoId ?? null)
      : null
  const worktreePaths: { repoId: string; path: string }[] = []
  const worktreeIds = new Set(Object.keys(inputs.repoIdByWorktree))
  for (const entry of inputs.liveEntries) {
    if (entry.worktreeId) {
      worktreeIds.add(entry.worktreeId)
    }
  }
  for (const worktreeId of worktreeIds) {
    const repoId = repoIdForWorktree(worktreeId)
    const path = splitWorktreeIdForFilesystem(worktreeId)?.worktreePath
    if (repoId && path) {
      worktreePaths.push({ repoId, path })
    }
  }
  // Why: no repo names are passed in; the shortest checkout path is usually the main one.
  const labelByRepo = new Map<string, { path: string; label: string }>()
  for (const { repoId, path } of worktreePaths) {
    const current = labelByRepo.get(repoId)
    if (!current || path.length < current.path.length) {
      labelByRepo.set(repoId, { path, label: getRuntimePathBasename(path) })
    }
  }
  return {
    repoIdForWorktree,
    repoLabel: (repoId) => labelByRepo.get(repoId)?.label || null,
    repoIdForPath: (cwd) => {
      let best: { repoId: string; path: string } | null = null
      for (const candidate of worktreePaths) {
        if (
          isPathInsideOrEqual(candidate.path, cwd) &&
          (!best || candidate.path.length > best.path.length)
        ) {
          best = candidate
        }
      }
      return best?.repoId ?? null
    }
  }
}

function isDuplicateOfLive(
  session: SessionCanvasExternalSession,
  live: AgentStatusEntry[]
): boolean {
  const agent = normalizeCanvasAgent(session.agent)
  const filePath = normalizeRuntimePathForComparison(session.filePath)
  return live.some((entry) => {
    if (normalizeCanvasAgent(entry.agentType) !== agent || !entry.providerSession) {
      return false
    }
    const { id, transcriptPath } = entry.providerSession
    return (
      (id !== '' && id === session.providerSessionId) ||
      (transcriptPath !== undefined &&
        normalizeRuntimePathForComparison(transcriptPath) === filePath)
    )
  })
}

function matchesQuery(query: string, fields: (string | null | undefined)[]): boolean {
  const needle = query.trim().toLowerCase()
  return !needle || fields.some((field) => field?.toLowerCase().includes(needle))
}

function passesAgentFilter(filters: SessionCanvasFilters, agent: string): boolean {
  return (
    filters.agents.length === 0 || filters.agents.some((a) => normalizeCanvasAgent(a) === agent)
  )
}

function isLiveVisible(
  entry: AgentStatusEntry,
  repoLabel: string | null,
  inputs: SessionCanvasInputs
): boolean {
  const { filters } = inputs
  if (filters.states.length > 0 && !filters.states.includes(entry.state)) {
    return false
  }
  // Why: only finished sessions count as idle; working/blocked/waiting stay visible however old.
  if (
    filters.hideIdleOlderThanMs !== null &&
    entry.state === 'done' &&
    inputs.now - entry.updatedAt > filters.hideIdleOlderThanMs
  ) {
    return false
  }
  const agent = normalizeCanvasAgent(entry.agentType)
  return (
    passesAgentFilter(filters, agent) &&
    matchesQuery(filters.query, [
      entry.terminalTitle,
      entry.prompt,
      entry.orchestration?.taskTitle,
      entry.orchestration?.displayName,
      agent,
      repoLabel
    ])
  )
}

function isExternalVisible(
  session: SessionCanvasExternalSession,
  repoLabel: string | null,
  inputs: SessionCanvasInputs
): boolean {
  const { filters } = inputs
  if (!filters.showExternal) {
    return false
  }
  if (filters.states.length > 0 && !filters.states.includes(SESSION_CANVAS_EXTERNAL_STATE)) {
    return false
  }
  const updatedAt = session.updatedAt ? Date.parse(session.updatedAt) : Number.NaN
  if (
    filters.hideIdleOlderThanMs !== null &&
    Number.isFinite(updatedAt) &&
    inputs.now - updatedAt > filters.hideIdleOlderThanMs
  ) {
    return false
  }
  return (
    passesAgentFilter(filters, normalizeCanvasAgent(session.agent)) &&
    matchesQuery(filters.query, [
      session.title,
      session.agentLabel,
      session.agent,
      session.cwd,
      repoLabel
    ])
  )
}

export type CanvasMembership = {
  sessions: CanvasSession[]
  groupLabels: Map<string, string>
}

/** Resolves which sessions appear on the canvas and the group each belongs to. */
export function resolveCanvasMembership(inputs: SessionCanvasInputs): CanvasMembership {
  const repos = buildRepoIndex(inputs)
  const sessions: CanvasSession[] = []
  const groupLabels = new Map<string, string>()
  const addGroup = (groupId: string, label: string | null): void => {
    if (!groupLabels.has(groupId)) {
      groupLabels.set(groupId, label ?? SESSION_CANVAS_OTHER_GROUP_LABEL)
    }
  }

  for (const entry of inputs.liveEntries) {
    const repoId = repos.repoIdForWorktree(entry.worktreeId)
    const repoLabel = repoId ? repos.repoLabel(repoId) : null
    if (!isLiveVisible(entry, repoLabel, inputs)) {
      continue
    }
    const groupId = repoId ? `group:${repoId}` : SESSION_CANVAS_OTHER_GROUP_ID
    addGroup(groupId, repoId ? (repoLabel ?? repoId) : null)
    sessions.push({
      id: liveNodeId(entry.paneKey),
      groupId,
      repoId,
      data: { kind: 'live', entry, repoLabel }
    })
  }

  for (const session of inputs.externalSessions) {
    if (isDuplicateOfLive(session, inputs.liveEntries)) {
      continue
    }
    const repoId = session.cwd ? repos.repoIdForPath(session.cwd) : null
    const folderLabel = session.cwd ? getRuntimePathBasename(session.cwd) || null : null
    const repoLabel = repoId ? repos.repoLabel(repoId) : folderLabel
    if (!isExternalVisible(session, repoLabel, inputs)) {
      continue
    }
    const groupId = repoId
      ? `group:${repoId}`
      : session.cwd
        ? `group:path:${normalizeRuntimePathForComparison(session.cwd)}`
        : SESSION_CANVAS_OTHER_GROUP_ID
    addGroup(groupId, repoId ? (repoLabel ?? repoId) : folderLabel)
    sessions.push({
      id: `ext:${session.key}`,
      groupId,
      repoId,
      data: { kind: 'external', session, repoLabel }
    })
  }
  return { sessions, groupLabels }
}
