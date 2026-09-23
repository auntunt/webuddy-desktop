/**
 * Local state for the collector: device identity, config, and per-file cursors.
 *
 * The cursor is keyed by absolute transcript path and stores the file's size,
 * mtime and content hash. A file is re-emitted only when its content hash
 * changes, so an append-only session log uploads its metadata once per change
 * rather than once per run.
 */

import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const STATE_DIR = process.env.WEBUDDY_AGENT_HOME || join(homedir(), '.webuddy-agent')
export const STATE_VERSION = 1

export const paths = {
  dir: STATE_DIR,
  config: join(STATE_DIR, 'config.json'),
  device: join(STATE_DIR, 'device.json'),
  state: join(STATE_DIR, 'state.json'),
  outbox: join(STATE_DIR, 'outbox'),
  lastPush: join(STATE_DIR, 'last-push.json')
}

export const DEFAULT_CONFIG = {
  /** Server ingest endpoint. Empty = local-only; nothing is ever pushed. */
  endpoint: '',
  token: '',
  userId: '',
  deviceLabel: '',
  /**
   * Transcript bodies always ship. These records exist so the team can see and
   * reuse how work was actually done — a metadata-only record answers "someone
   * worked" without answering "what was done". Not a per-machine choice.
   */
  consentScope: 'transcript-full',
  /** Restrict collection to these cwd prefixes. Empty = all workspaces. */
  includeWorkspaces: [],
  excludeWorkspaces: [],
  maxTranscriptBytes: 32 * 1024 * 1024
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

/** Atomic write: a crash mid-save must not leave a truncated cursor file. */
async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(tmp, path)
}

export async function loadConfig() {
  const fromFile = await readJson(paths.config, {})
  const config = { ...DEFAULT_CONFIG, ...fromFile }
  // Env wins so CI and one-off runs can override without editing the file.
  config.endpoint = process.env.WEBUDDY_ENDPOINT || config.endpoint
  config.token = process.env.WEBUDDY_TOKEN || config.token
  config.userId = process.env.WEBUDDY_USER_ID || config.userId
  config.consentScope = process.env.WEBUDDY_CONSENT_SCOPE || config.consentScope
  // Last resort so a never-configured machine still attributes its sessions to
  // somebody. Explicit config (file or env) always outranks this.
  if (!config.userId) {
    try {
      config.userId = userInfo().username
    } catch {
      /* leave empty; scan refuses rather than uploading anonymously */
    }
  }
  return config
}

export async function saveConfig(config) {
  await writeJson(paths.config, config)
}

export async function ensureDeviceId() {
  const existing = await readJson(paths.device, null)
  if (existing?.deviceId) {
    return existing.deviceId
  }
  const deviceId = randomUUID()
  await writeJson(paths.device, { deviceId, createdAt: new Date().toISOString() })
  return deviceId
}

export async function loadState() {
  const state = await readJson(paths.state, null)
  if (state?.version === STATE_VERSION && state.files) {
    return state
  }
  return { version: STATE_VERSION, files: {} }
}

export async function saveState(state) {
  await writeJson(paths.state, state)
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  const { createReadStream } = await import('node:fs')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

export function queueFileFor(record) {
  const safe = `${record.session.localDate}-${record.agent.id}-${record.session.id}`.replace(
    /[^A-Za-z0-9._-]/g,
    '_'
  )
  return join(paths.outbox, `${safe}.json`)
}

export { existsSync, readFile, writeFile, writeJson, readJson }
