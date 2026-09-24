/**
 * Outbox + push.
 *
 * Records are written to disk before any network call. A failed or offline push
 * therefore loses nothing: the next run retries the same files. Attempts and the
 * last error are recorded so `status` can show why something is stuck instead of
 * silently retrying forever.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { paths } from './state.mjs'

const BATCH_LIMIT = 50
// Why a byte budget as well as a count: transcripts are megabytes each, so 50
// records can add up to hundreds of MB in one request and exceed the server's
// body limit. Whichever bound is hit first closes the batch.
const BATCH_BYTES = 8 * 1024 * 1024
const MAX_ATTEMPTS = 25

/**
 * Greedy pack: honour the count and byte budgets, but always emit at least one
 * entry per batch so an oversized single record is still attempted (and fails
 * with a precise error) instead of stalling the queue forever.
 */
export function packBatches(entries, limit = BATCH_LIMIT, maxBytes = BATCH_BYTES) {
  const batches = []
  let current = []
  let bytes = 0
  for (const entry of entries) {
    const tooMany = current.length >= limit
    const tooBig = current.length > 0 && bytes + entry.size > maxBytes
    if (tooMany || tooBig) {
      batches.push(current)
      current = []
      bytes = 0
    }
    current.push(entry)
    bytes += entry.size
  }
  if (current.length > 0) {
    batches.push(current)
  }
  return batches
}

export async function enqueue(record, transcriptText = null, conversation = null) {
  await mkdir(paths.outbox, { recursive: true })
  const payload = transcriptText === null ? { record } : { record, transcript: transcriptText }
  // Optional and additive: servers that predate it read only `transcript`.
  if (Array.isArray(conversation)) {
    payload.conversation = conversation
  }
  // Why the random suffix: a parent and its subagents share a session id and can land in one ms.
  const unique = randomUUID().slice(0, 8)
  const name = `${Date.now()}-${record.agent.id}-${record.session.id}-${unique}.json`.replace(
    /[^A-Za-z0-9._-]/g,
    '_'
  )
  const path = join(paths.outbox, name)
  await writeFile(path, JSON.stringify(payload), { mode: 0o600 })
  return path
}

export async function pendingCount() {
  try {
    return (await readdir(paths.outbox)).filter((name) => name.endsWith('.json')).length
  } catch {
    return 0
  }
}

async function readAttempts(path) {
  try {
    return JSON.parse(await readFile(`${path}.attempts`, 'utf8'))
  } catch {
    return { count: 0, lastError: null, lastAttemptAt: null }
  }
}

async function recordFailure(path, error) {
  const attempts = await readAttempts(path)
  const next = {
    count: attempts.count + 1,
    lastError: String(error?.message ?? error),
    lastAttemptAt: new Date().toISOString()
  }
  await writeFile(`${path}.attempts`, JSON.stringify(next, null, 2), { mode: 0o600 })
  return next
}

/**
 * Push queued records. Returns a summary rather than throwing, so a single bad
 * record cannot abort the whole run.
 */
export async function pushPending({ endpoint, token, deviceId, fetchImpl = fetch }) {
  if (!endpoint) {
    return {
      pushed: 0,
      failed: 0,
      skipped: 'no endpoint configured',
      exhausted: 0,
      authRejected: false
    }
  }
  // Why refuse rather than send unauthenticated: a signed-out machine has no
  // token, and an ingest route that accepts anonymous batches would let it
  // keep uploading under whatever identity the server defaults to.
  if (!token) {
    return { pushed: 0, failed: 0, exhausted: 0, skipped: 'no token', authRejected: false }
  }
  let names
  try {
    names = (await readdir(paths.outbox)).filter((name) => name.endsWith('.json'))
  } catch {
    return { pushed: 0, failed: 0, skipped: 'empty outbox', exhausted: 0, authRejected: false }
  }

  // Measure before packing: one 30 MB transcript must not ride along with 49 others.
  const entries = []
  for (const name of names) {
    const path = join(paths.outbox, name)
    try {
      entries.push({ name, path, size: (await stat(path)).size })
    } catch {
      /* vanished between readdir and stat */
    }
  }

  let pushed = 0
  let failed = 0
  let exhausted = 0

  for (const batch of packBatches(entries)) {
    const payloads = []
    for (const entry of batch) {
      payloads.push(JSON.parse(await readFile(entry.path, 'utf8')))
    }
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'x-webuddy-device-id': deviceId ?? ''
        },
        body: JSON.stringify({ schemaVersion: 'webuddy.batch.v1', records: payloads })
      })
      if (response.status === 401) {
        // Why 立即停：凭证失效时继续重试只会把每条记录的重试次数耗到 exhausted。
        return { pushed, failed, exhausted, authRejected: true }
      }
      if (!response.ok) {
        throw new Error(`ingest returned ${response.status}`)
      }
      for (const entry of batch) {
        await rm(entry.path, { force: true })
        await rm(`${entry.path}.attempts`, { force: true })
      }
      pushed += batch.length
    } catch (error) {
      failed += batch.length
      for (const entry of batch) {
        const attempts = await recordFailure(entry.path, error)
        if (attempts.count >= MAX_ATTEMPTS) {
          exhausted += 1
        }
      }
    }
  }
  return { pushed, failed, exhausted, authRejected: false }
}
