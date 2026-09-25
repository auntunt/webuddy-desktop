import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type {
  SessionCanvasExternalSession,
  SessionCanvasMessage
} from '../../../../shared/session-canvas-types'
import type { SessionCanvasInputs } from './session-graph-types'

export const NOW = 1_800_000_000_000
export const WT_A = 'repo-1::/work/app'
export const WT_B = 'repo-1::/work/app-feature'
export const WT_C = 'repo-2::/work/lib'

export function makeEntry(
  paneKey: string,
  overrides: Partial<AgentStatusEntry> = {}
): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: NOW,
    stateStartedAt: NOW,
    paneKey,
    stateHistory: [],
    agentType: 'claude',
    worktreeId: WT_A,
    ...overrides
  }
}

export function makeExternal(
  key: string,
  overrides: Partial<SessionCanvasExternalSession> = {}
): SessionCanvasExternalSession {
  return {
    key,
    agent: 'codex',
    agentLabel: 'Codex',
    title: `外部 ${key}`,
    cwd: '/elsewhere/tool',
    updatedAt: new Date(NOW).toISOString(),
    filePath: `/home/u/.codex/sessions/${key}.jsonl`,
    providerSessionId: `sid-${key}`,
    preview: [],
    ...overrides
  }
}

export function makeMessage(overrides: Partial<SessionCanvasMessage>): SessionCanvasMessage {
  return {
    fromPaneKey: null,
    toPaneKey: null,
    fromHandle: null,
    toHandle: null,
    at: NOW,
    kind: 'mailbox',
    ...overrides
  }
}

export function makeInputs(overrides: Partial<SessionCanvasInputs> = {}): SessionCanvasInputs {
  return {
    liveEntries: [],
    externalSessions: [],
    changedFilesByWorktree: {},
    repoIdByWorktree: { [WT_A]: 'repo-1', [WT_B]: 'repo-1', [WT_C]: 'repo-2' },
    messages: [],
    savedPositions: {},
    previousPositions: {},
    filters: {
      query: '',
      agents: [],
      states: [],
      projects: [],
      showExternal: true,
      hideIdleOlderThanMs: null
    },
    now: NOW,
    ...overrides
  }
}
