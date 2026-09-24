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
import type { Writable } from 'node:stream'
import {
  isVaultExportGivenUp,
  recordVaultExportFailure,
  type VaultExportFailureMap
} from './vault-export-failures'
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
export const VAULT_EXPORT_READ_TIMEOUT_MS = 60_000

export type VaultSessionExportDeps = {
  stateDir: string
  homeDir: string
  timeZone?: string
  limit?: number
  readTimeoutMs?: number
  listSessions: () => Promise<AiVaultSession[]>
  listSubagents: (parent: AiVaultSession) => Promise<AiVaultSession[]>
  readConversation: (session: AiVaultSession) => Promise<AiVaultConversationResult>
  loadCursor: () => Promise<VaultCursorMap>
  saveCursor: (entries: VaultCursorMap) => Promise<void>
  loadFailures: () => Promise<VaultExportFailureMap>
  saveFailures: (failures: VaultExportFailureMap) => Promise<void>
  openManifestStream?: (path: string) => Writable
}

export type VaultSessionExportResult = {
  manifestPath: string | null
  count: number
  /** Persist the cursor; call only after the collector accepted the manifest. */
  commit: () => Promise<void>
  /** Delete the manifest: it holds pre-redaction transcript text. */
  dispose: () => Promise<void>
}

export function vaultManifestPath(stateDir: string): string {
  return join(stateDir, 'manifest.jsonl')
}

type SubagentGroup = { children: AiVaultSession[]; complete: boolean }

async function changedSubagents(
  deps: VaultSessionExportDeps,
  parent: AiVaultSession,
  cursor: VaultCursorMap,
  failures: VaultExportFailureMap
): Promise<SubagentGroup> {
  // Why claude only: AI Vault's main scan skips Claude's subagents/ dir, yet
  // the previous collector uploaded those transcripts.
  if (parent.agent !== 'claude' || parent.subagentTranscriptCount <= 0) {
    return { children: [], complete: true }
  }
  try {
    const listed = (await deps.listSubagents(parent)).filter(
      (child) => !isVaultExportGivenUp(failures, child)
    )
    return {
      children: diffVaultSessions(listed, cursor, {
        limit: Number.POSITIVE_INFINITY
      }).changed,
      complete: true
    }
  } catch {
    return { children: [], complete: false }
  }
}

type ManifestWriter = {
  write: (line: string) => Promise<void>
  finish: () => Promise<void>
}

function openManifestWriter(stream: Writable): ManifestWriter {
  // Why: an unobserved stream 'error' would crash the main process.
  let streamError: unknown = null
  stream.on('error', (error) => {
    streamError = error
  })
  const settled = new Promise<void>((resolve) => {
    stream.once('close', () => resolve())
    stream.once('finish', () => resolve())
    stream.once('error', () => resolve())
  })
  const throwIfFailed = (): void => {
    if (streamError) {
      throw streamError
    }
  }
  return {
    write: async (line) => {
      throwIfFailed()
      if (!stream.write(line)) {
        await Promise.race([once(stream, 'drain'), settled])
      }
      throwIfFailed()
    },
    finish: async () => {
      throwIfFailed()
      stream.end()
      await settled
      throwIfFailed()
    }
  }
}

/** Rejects after `ms`; the underlying read is abandoned, not cancelled. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('vault_conversation_read_timeout')), ms)
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export async function exportVaultSessions(
  deps: VaultSessionExportDeps
): Promise<VaultSessionExportResult> {
  const limit = deps.limit ?? VAULT_EXPORT_SESSION_LIMIT
  const manifestPath = vaultManifestPath(deps.stateDir)
  // Fixed name: passes are single-flight, so a crashed pass's tmp is just overwritten.
  const tmpPath = `${manifestPath}.tmp`
  // Why: a pass killed mid-scan leaves pre-redaction transcript text on disk.
  await Promise.all([rm(manifestPath, { force: true }), rm(tmpPath, { force: true })])
  const [cursor, failures] = await Promise.all([deps.loadCursor(), deps.loadFailures()])
  const listed = (await deps.listSessions()).filter((s) => !isVaultExportGivenUp(failures, s))
  const { changed } = diffVaultSessions(listed, cursor, { limit })
  const nextCursor: VaultCursorMap = new Map(cursor)
  const commit = (): Promise<void> => deps.saveCursor(nextCursor)
  const dispose = (): Promise<void> => rm(manifestPath, { force: true })
  if (changed.length === 0) {
    return { manifestPath: null, count: 0, commit, dispose }
  }

  await mkdir(deps.stateDir, { recursive: true })
  const stream =
    deps.openManifestStream?.(tmpPath) ??
    createWriteStream(tmpPath, { encoding: 'utf8', mode: 0o600 })
  const writer = openManifestWriter(stream)
  let count = 0
  let failuresDirty = false

  const writeSession = async (session: AiVaultSession): Promise<boolean> => {
    let conversation: AiVaultConversationResult
    try {
      // Why: a hung read would stall every later pass; a timeout counts toward the give-up limit.
      conversation = await withTimeout(
        deps.readConversation(session),
        deps.readTimeoutMs ?? VAULT_EXPORT_READ_TIMEOUT_MS
      )
    } catch {
      recordVaultExportFailure(failures, session)
      failuresDirty = true
      return false
    }
    failuresDirty = failures.delete(vaultCursorKey(session)) || failuresDirty
    const entry = toManifestEntry(session, conversation, {
      homeDir: deps.homeDir,
      timeZone: deps.timeZone
    })
    await writer.write(`${JSON.stringify(entry)}\n`)
    count += 1
    return true
  }

  try {
    for (const parent of changed) {
      const remaining = limit - count
      if (remaining <= 0) {
        break
      }
      const group = await changedSubagents(deps, parent, cursor, failures)
      const fits = 1 + group.children.length <= remaining
      // Why defer: a parent's cursor may only advance with all of its subagents,
      // so a group that doesn't fit waits for a pass where it's first.
      if (!fits && count > 0) {
        continue
      }
      const parentWritten = await writeSession(parent)
      let allChildrenWritten = group.complete && fits
      for (const child of group.children.slice(0, Math.max(0, remaining - 1))) {
        if (await writeSession(child)) {
          nextCursor.set(vaultCursorKey(child), vaultCursorValueFor(child))
        } else {
          allChildrenWritten = false
        }
      }
      if (parentWritten && allChildrenWritten) {
        nextCursor.set(vaultCursorKey(parent), vaultCursorValueFor(parent))
      }
    }
    await writer.finish()
  } catch (error) {
    stream.destroy()
    await rm(tmpPath, { force: true })
    throw error
  } finally {
    if (failuresDirty) {
      await deps.saveFailures(failures).catch(() => {})
    }
  }

  if (count === 0) {
    await rm(tmpPath, { force: true })
    return { manifestPath: null, count: 0, commit, dispose }
  }
  await rename(tmpPath, manifestPath)
  return { manifestPath, count, commit, dispose }
}
