/** Shared fakes for the vault-session-export test files. */
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VaultSessionExportDeps } from './vault-session-export'
import type { VaultCursorMap } from './vault-session-cursor'
import type { VaultExportFailureMap } from './vault-export-failures'
import type { AiVaultSession } from '../../shared/ai-vault-types'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { AiVaultConversationResult } from '../ai-vault/session-conversation-window'

export function session(overrides: Partial<AiVaultSession> = {}): AiVaultSession {
  return {
    id: 'row',
    executionHostId: LOCAL_EXECUTION_HOST_ID,
    executionHostPlatform: 'darwin',
    agent: 'codex',
    sessionId: 'sess-1',
    title: 't',
    cwd: null,
    branch: null,
    model: null,
    filePath: '/Users/lina/.codex/sessions/a.jsonl',
    codexHome: null,
    createdAt: null,
    updatedAt: null,
    modifiedAt: '2026-09-20T10:00:00.000Z',
    messageCount: 1,
    totalTokens: 10,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: '',
    subagent: null,
    ...overrides
  }
}

export const conversation: AiVaultConversationResult = {
  messages: [{ role: 'user', text: 'hi', timestamp: '2026-09-20T10:00:00.000Z' }],
  truncated: false,
  totalMessages: 1
}

export async function setup(
  sessions: AiVaultSession[],
  overrides: Partial<VaultSessionExportDeps> = {}
): Promise<{
  deps: VaultSessionExportDeps
  saved: VaultCursorMap[]
  savedFailures: VaultExportFailureMap[]
  stateDir: string
}> {
  const stateDir = await mkdtemp(join(tmpdir(), 'wbs-vault-export-'))
  const saved: VaultCursorMap[] = []
  const savedFailures: VaultExportFailureMap[] = []
  const deps: VaultSessionExportDeps = {
    stateDir,
    homeDir: '/Users/lina',
    timeZone: 'UTC',
    listSessions: async () => sessions,
    listSubagents: async () => [],
    readConversation: async () => conversation,
    loadCursor: async () => new Map(),
    saveCursor: async (entries) => {
      saved.push(entries)
    },
    loadFailures: async () => new Map(),
    saveFailures: async (failures) => {
      savedFailures.push(new Map(failures))
    },
    ...overrides
  }
  return { deps, saved, savedFailures, stateDir }
}

export async function manifestLines(path: string | null): Promise<Record<string, unknown>[]> {
  if (!path) {
    return []
  }
  const raw = await readFile(path, 'utf8')
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parsed: unknown = JSON.parse(line)
      return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {}
    })
}
