/**
 * Export changed AI Vault sessions as the collector's `scan --manifest` input.
 *
 * AI Vault already parses every agent the app knows about, so the collector
 * no longer rediscovers transcripts itself; it only uploads what we list here.
 */

import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  diffVaultSessions,
  vaultCursorKey,
  vaultCursorValueFor,
  type VaultCursorMap
} from './vault-session-cursor'
import { toManifestEntry } from './vault-session-manifest'
import type { AiVaultSession } from '../../shared/ai-vault-types'
import type { AiVaultConversationResult } from '../ai-vault/session-conversation-window'

export const VAULT_EXPORT_SESSION_LIMIT = 200

export type VaultSessionExportDeps = {
  stateDir: string
  homeDir: string
  timeZone?: string
  limit?: number
  listSessions: () => Promise<AiVaultSession[]>
  listSubagents: (parent: AiVaultSession) => Promise<AiVaultSession[]>
  readConversation: (session: AiVaultSession) => Promise<AiVaultConversationResult>
  loadCursor: () => Promise<VaultCursorMap>
  saveCursor: (entries: VaultCursorMap) => Promise<void>
}

export type VaultSessionExportResult = {
  manifestPath: string | null
  count: number
  /** Persist the cursor; call only after the collector accepted the manifest. */
  commit: () => Promise<void>
}

export function vaultManifestPath(stateDir: string): string {
  return join(stateDir, 'manifest.jsonl')
}

async function changedSubagents(
  deps: VaultSessionExportDeps,
  parent: AiVaultSession,
  cursor: VaultCursorMap,
  limit: number
): Promise<AiVaultSession[]> {
  // Why claude only: AI Vault's main scan skips Claude's subagents/ dir, yet
  // the previous collector uploaded those transcripts.
  if (parent.agent !== 'claude' || parent.subagentTranscriptCount <= 0 || limit <= 0) {
    return []
  }
  try {
    return diffVaultSessions(await deps.listSubagents(parent), cursor, { limit }).changed
  } catch {
    return []
  }
}

export async function exportVaultSessions(
  deps: VaultSessionExportDeps
): Promise<VaultSessionExportResult> {
  const limit = deps.limit ?? VAULT_EXPORT_SESSION_LIMIT
  const cursor = await deps.loadCursor()
  const { changed } = diffVaultSessions(await deps.listSessions(), cursor, { limit })
  const nextCursor: VaultCursorMap = new Map(cursor)
  const commit = (): Promise<void> => deps.saveCursor(nextCursor)
  if (changed.length === 0) {
    return { manifestPath: null, count: 0, commit }
  }

  await mkdir(deps.stateDir, { recursive: true })
  const manifestPath = vaultManifestPath(deps.stateDir)
  const tmpPath = `${manifestPath}.${process.pid}.tmp`
  const out = createWriteStream(tmpPath, { encoding: 'utf8', mode: 0o600 })
  // Why: an unobserved stream 'error' would crash the main process.
  let streamError: unknown = null
  out.on('error', (error) => {
    streamError = error
  })
  const closed = new Promise<void>((resolve) => out.once('close', () => resolve()))
  let count = 0

  const writeSession = async (session: AiVaultSession): Promise<void> => {
    let conversation: AiVaultConversationResult
    try {
      conversation = await deps.readConversation(session)
    } catch {
      // Left out of the cursor, so the next round retries it.
      return
    }
    const line = `${JSON.stringify(
      toManifestEntry(session, conversation, { homeDir: deps.homeDir, timeZone: deps.timeZone })
    )}\n`
    if (streamError) {
      throw streamError
    }
    if (!out.write(line)) {
      await once(out, 'drain')
    }
    nextCursor.set(vaultCursorKey(session), vaultCursorValueFor(session))
    count += 1
  }

  try {
    for (const parent of changed) {
      if (count >= limit) {
        break
      }
      await writeSession(parent)
      for (const child of await changedSubagents(deps, parent, cursor, limit - count)) {
        await writeSession(child)
      }
    }
    out.end()
    await closed
    if (streamError) {
      throw streamError
    }
  } catch (error) {
    out.destroy()
    await rm(tmpPath, { force: true })
    throw error
  }

  if (count === 0) {
    await rm(tmpPath, { force: true })
    return { manifestPath: null, count: 0, commit }
  }
  await rename(tmpPath, manifestPath)
  return { manifestPath, count, commit }
}
