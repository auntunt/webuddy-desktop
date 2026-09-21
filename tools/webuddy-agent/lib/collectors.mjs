/**
 * Per-agent transcript discovery and parsing.
 *
 * Each collector's only job is to answer the same questions for its own format:
 * which session, which workspace, which model/agent version, and when it ran.
 * Everything downstream consumes the normalized shape, never the raw file.
 *
 * All parsing is streaming (`readline`) because a single Codex rollout can be
 * tens of megabytes and the collector runs on developer machines.
 */

import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createInterface } from 'node:readline'

import { AGENTS } from './schema.mjs'

const JSONL_MAX_LINE = 8 * 1024 * 1024

async function walk(dir, onFile, depth = 0) {
  if (depth > 6) {
    return
  }
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') {
        continue
      }
      await walk(full, onFile, depth + 1)
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      await onFile(full)
    }
  }
}

async function eachLine(path, onLine) {
  const stream = createReadStream(path, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (!line || line.length > JSONL_MAX_LINE) {
        continue
      }
      onLine(line)
    }
  } finally {
    rl.close()
    stream.close()
  }
}

function parseJson(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function trackTimestamps(acc, iso) {
  if (typeof iso !== 'string' || !iso) {
    return
  }
  if (!acc.startedAt || iso < acc.startedAt) {
    acc.startedAt = iso
  }
  if (!acc.endedAt || iso > acc.endedAt) {
    acc.endedAt = iso
  }
}

/** Claude Code: one JSONL per session, JSON objects with role/timestamp/cwd. */
export const claudeCodeCollector = {
  id: 'claude-code',
  async parse(path, { homeDir: _homeDir }) {
    const acc = {
      startedAt: null,
      endedAt: null,
      cwd: null,
      branch: null,
      agentVersion: null,
      sessionId: null,
      model: null,
      messageCount: 0,
      turnCount: 0,
      tokens: null
    }
    await eachLine(path, (line) => {
      const entry = parseJson(line)
      if (!entry) {
        return
      }
      trackTimestamps(acc, entry.timestamp)
      if (!acc.cwd && typeof entry.cwd === 'string') {
        acc.cwd = entry.cwd
      }
      if (!acc.branch && typeof entry.gitBranch === 'string') {
        acc.branch = entry.gitBranch
      }
      if (!acc.agentVersion && typeof entry.version === 'string') {
        acc.agentVersion = entry.version
      }
      if (!acc.sessionId && typeof entry.sessionId === 'string') {
        acc.sessionId = entry.sessionId
      }
      if (entry.type === 'user' && entry.origin?.kind === 'human') {
        acc.turnCount += 1
      }
      const role = entry.message?.role
      if (role === 'user' || role === 'assistant') {
        acc.messageCount += 1
        if (!acc.model && typeof entry.message?.model === 'string') {
          acc.model = entry.message.model
        }
      }
    })
    return acc
  }
}

/** Codex: rollout-*.jsonl under YYYY/MM/DD, events under payload. */
export const codexCollector = {
  id: 'codex',
  async parse(path, { homeDir: _homeDir }) {
    const acc = {
      startedAt: null,
      endedAt: null,
      cwd: null,
      branch: null,
      agentVersion: null,
      sessionId: null,
      model: null,
      messageCount: 0,
      turnCount: 0,
      tokens: null
    }
    await eachLine(path, (line) => {
      const entry = parseJson(line)
      if (!entry) {
        return
      }
      trackTimestamps(acc, entry.timestamp)
      const payload = entry.payload ?? {}
      if (entry.type === 'session_meta') {
        acc.sessionId ??= payload.session_id ?? payload.id ?? null
        acc.cwd ??= payload.cwd ?? null
        acc.agentVersion ??= payload.cli_version ?? null
      }
      if (entry.type === 'turn_context') {
        acc.cwd ??= payload.cwd ?? null
        acc.model ??= payload.model ?? payload.model_name ?? null
      }
      if (entry.type === 'response_item' && payload.type === 'message') {
        if (payload.role === 'user' || payload.role === 'assistant') {
          acc.messageCount += 1
        }
        if (payload.role === 'user') {
          acc.turnCount += 1
        }
      }
      if (entry.type === 'token_usage_record' || payload.type === 'token_count') {
        const total = payload.info?.total_token_usage ?? payload.total_token_usage
        if (total && typeof total === 'object') {
          acc.tokens = {
            input: total.input_tokens ?? null,
            output: total.output_tokens ?? null,
            total: total.total_tokens ?? null
          }
        }
      }
    })
    return acc
  }
}

const COLLECTORS = new Map([
  [claudeCodeCollector.id, claudeCodeCollector],
  [codexCollector.id, codexCollector]
])

/** Generic fallback: enough to be useful, never claims fields it cannot read. */
const genericCollector = {
  id: 'generic',
  async parse(path) {
    const acc = {
      startedAt: null,
      endedAt: null,
      cwd: null,
      branch: null,
      agentVersion: null,
      sessionId: null,
      model: null,
      messageCount: 0,
      turnCount: 0,
      tokens: null
    }
    await eachLine(path, (line) => {
      const entry = parseJson(line)
      if (entry) {
        trackTimestamps(acc, entry.timestamp)
      }
    })
    return acc
  }
}

/** Discover candidate session files for every known agent under `homeDir`. */
export async function discoverSessions({ homeDir, config }) {
  const found = []
  for (const agent of AGENTS) {
    for (const root of agent.roots) {
      const dir = join(homeDir, root)
      await walk(dir, async (path) => {
        const rel = relative(homeDir, path)
        found.push({
          agentId: agent.id,
          agentLabel: agent.label,
          path,
          relPath: rel
        })
      })
    }
  }
  const includes = config.includeWorkspaces ?? []
  const excludes = config.excludeWorkspaces ?? []
  if (includes.length === 0 && excludes.length === 0) {
    return found
  }
  // Workspace filtering happens after parse (the cwd lives inside the file), so
  // the caller applies include/exclude once it has parsed a session.
  return found
}

export function collectorFor(agentId) {
  const known = COLLECTORS.get(agentId)
  if (known) {
    return known
  }
  const agent = AGENTS.find((entry) => entry.id === agentId)
  if (!agent) {
    return null
  }
  return { ...genericCollector, id: agent.id, label: agent.label }
}

export async function statTranscript(path) {
  try {
    const info = await stat(path)
    return { bytes: info.size, mtimeMs: info.mtimeMs }
  } catch {
    return null
  }
}
