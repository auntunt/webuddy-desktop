import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { durableWriteTempPath, writeFileDurable } from '../durable-file-write'
import type { SessionCanvasMessage } from '../../shared/session-canvas-types'

// Why: local pass-along log lives beside the other per-profile userData state.
const PASS_ALONG_LOG_FILE_NAME = 'session-canvas-pass-along-log.json'
export const PASS_ALONG_LOG_MAX_ENTRIES = 200

type PassAlongLogEntry = { fromPaneKey: string; toPaneKey: string; at: number }

export function passAlongLogPath(userDataDir: string): string {
  return join(userDataDir, PASS_ALONG_LOG_FILE_NAME)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPassAlongLogEntry(value: unknown): value is PassAlongLogEntry {
  return (
    isRecord(value) &&
    typeof value.fromPaneKey === 'string' &&
    typeof value.toPaneKey === 'string' &&
    typeof value.at === 'number'
  )
}

async function readPassAlongLog(filePath: string): Promise<PassAlongLogEntry[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf-8'))
    return Array.isArray(parsed) ? parsed.filter(isPassAlongLogEntry) : []
  } catch {
    // Why: missing/corrupt log reads as empty — the log is a best-effort trail, not a source of truth.
    return []
  }
}

/** Appends one entry, keeping only the newest `PASS_ALONG_LOG_MAX_ENTRIES`; write is tmp-file + rename. */
export async function appendPassAlongLogEntry(
  filePath: string,
  entry: PassAlongLogEntry
): Promise<void> {
  const next = [...(await readPassAlongLog(filePath)), entry].slice(-PASS_ALONG_LOG_MAX_ENTRIES)
  await writeFileDurable(durableWriteTempPath(filePath), filePath, JSON.stringify(next))
}

export async function readPassAlongMessages(filePath: string): Promise<SessionCanvasMessage[]> {
  return (await readPassAlongLog(filePath)).map((entry) => ({
    fromPaneKey: entry.fromPaneKey,
    toPaneKey: entry.toPaneKey,
    fromHandle: null,
    toHandle: null,
    at: entry.at,
    kind: 'pass-along' as const
  }))
}
