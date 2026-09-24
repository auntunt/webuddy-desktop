/**
 * Cursor over AI Vault sessions already handed to the collector, so each
 * collection round only re-exports sessions that actually changed.
 *
 * Lives beside `collector-config.ts` (`~/.webuddy-agent/vault-cursor.json`)
 * so one machine keeps one collector state directory.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { collectorStateDir } from './collector-config'
import type { AiVaultSession } from '../../shared/ai-vault-types'

export type VaultCursorValue = {
  modifiedAt: string
  updatedAt: string | null
  messageCount: number
  totalTokens: number
}

export type VaultCursorMap = Map<string, VaultCursorValue>

export function vaultCursorPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(collectorStateDir(env), 'vault-cursor.json')
}

/** `agent\0filePath\0sessionId`, per constraints.md. */
export function vaultCursorKey(
  session: Pick<AiVaultSession, 'agent' | 'filePath' | 'sessionId'>
): string {
  return `${session.agent}\0${session.filePath}\0${session.sessionId}`
}

export function vaultCursorValueFor(session: AiVaultSession): VaultCursorValue {
  return {
    modifiedAt: session.modifiedAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    totalTokens: session.totalTokens
  }
}

function cursorValuesEqual(a: VaultCursorValue, b: VaultCursorValue): boolean {
  return (
    a.modifiedAt === b.modifiedAt &&
    a.updatedAt === b.updatedAt &&
    a.messageCount === b.messageCount &&
    a.totalTokens === b.totalTokens
  )
}

function isVaultCursorValue(value: unknown): value is VaultCursorValue {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const fields = new Map(Object.entries(value))
  return (
    typeof fields.get('modifiedAt') === 'string' &&
    (fields.get('updatedAt') === null || typeof fields.get('updatedAt') === 'string') &&
    typeof fields.get('messageCount') === 'number' &&
    typeof fields.get('totalTokens') === 'number'
  )
}

/** A missing or corrupt cursor file is treated as "nothing seen yet", not an error. */
export async function loadVaultCursor(
  env: NodeJS.ProcessEnv = process.env
): Promise<VaultCursorMap> {
  try {
    const raw: unknown = JSON.parse(await readFile(vaultCursorPath(env), 'utf8'))
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return new Map()
    }
    const entries = Object.entries(raw).filter((pair): pair is [string, VaultCursorValue] =>
      isVaultCursorValue(pair[1])
    )
    return new Map(entries)
  } catch {
    return new Map()
  }
}

export async function saveVaultCursor(
  entries: VaultCursorMap,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const path = vaultCursorPath(env)
  await mkdir(dirname(path), { recursive: true })
  // Atomic write: a crash mid-save must never leave a truncated cursor file,
  // which would look like "nothing seen" and re-export everything.
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`, {
    mode: 0o600
  })
  await rename(tmp, path)
}

export type DiffVaultSessionsOptions = { limit: number }

export type DiffVaultSessionsResult = {
  /** Newest-first, capped at `limit`; leftovers are picked up next round. */
  changed: AiVaultSession[]
  /** The cursor to persist once the caller's export/scan of `changed` succeeds. */
  nextCursorEntries: VaultCursorMap
}

export function diffVaultSessions(
  sessions: readonly AiVaultSession[],
  cursor: VaultCursorMap,
  options: DiffVaultSessionsOptions
): DiffVaultSessionsResult {
  const candidates = sessions
    .map((session) => ({ session, key: vaultCursorKey(session) }))
    .filter(({ session, key }) => {
      const existing = cursor.get(key)
      return !existing || !cursorValuesEqual(existing, vaultCursorValueFor(session))
    })
    .sort((a, b) =>
      a.session.modifiedAt < b.session.modifiedAt
        ? 1
        : a.session.modifiedAt > b.session.modifiedAt
          ? -1
          : 0
    )

  const limit = Math.max(0, options.limit)
  const taken = candidates.slice(0, limit)

  const nextCursorEntries: VaultCursorMap = new Map(cursor)
  for (const { session, key } of taken) {
    nextCursorEntries.set(key, vaultCursorValueFor(session))
  }

  return { changed: taken.map(({ session }) => session), nextCursorEntries }
}
