/**
 * Consecutive conversation-read failures per vault cursor key, so a session
 * that can never be parsed stops being retried every pass until it changes.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { collectorStateDir } from './collector-config'
import {
  isVaultCursorValue,
  vaultCursorKey,
  vaultCursorValueFor,
  vaultCursorValuesEqual,
  type VaultCursorValue
} from './vault-session-cursor'
import type { AiVaultSession } from '../../shared/ai-vault-types'

export const VAULT_EXPORT_MAX_FAILURES = 3

/** `value` is the session's cursor value when it failed; a different value means it changed. */
export type VaultExportFailure = { value: VaultCursorValue; count: number }
export type VaultExportFailureMap = Map<string, VaultExportFailure>

export function vaultExportFailuresPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(collectorStateDir(env), 'vault-export-failures.json')
}

function isVaultExportFailure(raw: unknown): raw is VaultExportFailure {
  if (typeof raw !== 'object' || raw === null) {
    return false
  }
  const fields = new Map(Object.entries(raw))
  return typeof fields.get('count') === 'number' && isVaultCursorValue(fields.get('value'))
}

export async function loadVaultExportFailures(
  env: NodeJS.ProcessEnv = process.env
): Promise<VaultExportFailureMap> {
  try {
    const raw: unknown = JSON.parse(await readFile(vaultExportFailuresPath(env), 'utf8'))
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return new Map()
    }
    return new Map(
      Object.entries(raw).filter((pair): pair is [string, VaultExportFailure] =>
        isVaultExportFailure(pair[1])
      )
    )
  } catch {
    return new Map()
  }
}

export async function saveVaultExportFailures(
  failures: VaultExportFailureMap,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const path = vaultExportFailuresPath(env)
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(Object.fromEntries(failures), null, 2)}\n`, {
    mode: 0o600
  })
  await rename(tmp, path)
}

export function isVaultExportGivenUp(
  failures: VaultExportFailureMap,
  session: AiVaultSession
): boolean {
  const failure = failures.get(vaultCursorKey(session))
  return (
    failure !== undefined &&
    failure.count >= VAULT_EXPORT_MAX_FAILURES &&
    vaultCursorValuesEqual(failure.value, vaultCursorValueFor(session))
  )
}

export function recordVaultExportFailure(
  failures: VaultExportFailureMap,
  session: AiVaultSession
): void {
  const key = vaultCursorKey(session)
  const value = vaultCursorValueFor(session)
  const previous = failures.get(key)
  const count = previous && vaultCursorValuesEqual(previous.value, value) ? previous.count + 1 : 1
  failures.set(key, { value, count })
}
