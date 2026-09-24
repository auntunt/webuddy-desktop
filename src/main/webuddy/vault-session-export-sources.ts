/** Production wiring for `exportVaultSessions`: AI Vault's local scan + background readers. */

import { homedir } from 'node:os'
import { collectorStateDir } from './collector-config'
import { loadVaultExportFailures, saveVaultExportFailures } from './vault-export-failures'
import { loadVaultCursor, saveVaultCursor } from './vault-session-cursor'
import type { VaultSessionExportDeps } from './vault-session-export'
import { listAiVaultSessions } from '../ai-vault/cached-session-list'
import {
  listAiVaultSubagentSessionsInBackground,
  readAiVaultConversationInBackground
} from '../ai-vault/session-scanner-background'

export function productionVaultSessionExportDeps(
  env: NodeJS.ProcessEnv = process.env
): VaultSessionExportDeps {
  return {
    stateDir: collectorStateDir(env),
    homeDir: homedir(),
    // Host-local scan (incl. WSL on Windows); the IPC variant fans out to remote hosts.
    listSessions: async () => (await listAiVaultSessions({ unlimited: true })).sessions,
    listSubagents: async (parent) =>
      (
        await listAiVaultSubagentSessionsInBackground({
          agent: 'claude',
          parentFilePath: parent.filePath
        })
      ).sessions,
    readConversation: (session) =>
      readAiVaultConversationInBackground({
        agent: session.agent,
        filePath: session.filePath,
        sessionId: session.sessionId,
        executionHostId: session.executionHostId,
        codexHome: session.codexHome
      }),
    loadCursor: () => loadVaultCursor(env),
    saveCursor: (entries) => saveVaultCursor(entries, env),
    loadFailures: () => loadVaultExportFailures(env),
    saveFailures: (failures) => saveVaultExportFailures(failures, env)
  }
}
