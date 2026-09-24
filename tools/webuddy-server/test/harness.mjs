/**
 * In-process test server: real HTTP on an ephemeral port, temp-dir db and
 * relay signing key, so route tests exercise `createRequestHandler` exactly
 * as `server.mjs` wires it.
 */

import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { openDb } from '../lib/db.mjs'
import { createUser as createUserRow } from '../lib/auth.mjs'
import { loadOrCreateSigningKey, signingKeyId } from '../lib/relay-tokens.mjs'
import { createRequestHandler } from '../lib/app.mjs'

const DEFAULT_PASSWORD = 'password1'
const DEFAULT_PUBLIC_DIR = join(import.meta.dirname, '..', 'public')

/** Minimal, schema-valid record — see tools/webuddy-agent/lib/schema.mjs. */
function baseRecord(overrides = {}) {
  const now = new Date().toISOString()
  return {
    schema: 'webuddy.agent-session.v1',
    collectedAt: now,
    actor: {
      userId: 'placeholder', // rewritten server-side to the token's owner
      deviceId: 'dev-1',
      hostname: 'test-host',
      osUser: 'tester',
      platform: 'darwin',
      deviceLabel: 'Test Machine'
    },
    agent: { id: 'claude-code', label: 'Claude Code', version: '1.0.0', model: 'test-model' },
    session: {
      id: randomUUID(),
      startedAt: now,
      endedAt: now,
      durationMs: 1000,
      localDate: now.slice(0, 10),
      turnCount: 1,
      messageCount: 2,
      tokens: { input: 10, output: 20, total: 30 }
    },
    workspace: { cwd: '/repo', branch: 'main', repo: 'repo' },
    transcript: {
      path: '/tmp/transcript.jsonl',
      bytes: 100,
      sha256: 'a'.repeat(64),
      format: 'jsonl'
    },
    redaction: { policyVersion: 'webuddy.redact.v1', rulesApplied: [], transcriptTruncated: false },
    consent: { scope: 'transcript-full' },
    ...overrides
  }
}

export async function startTestServer(opts = {}) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'wb-server-'))
  const db = openDb(join(tmpDir, 'test.sqlite'))
  const relayKeys = loadOrCreateSigningKey(tmpDir)
  const relayKid = signingKeyId(relayKeys.publicJwk)
  const publicDir = opts.publicDir ?? DEFAULT_PUBLIC_DIR

  const handler = createRequestHandler({
    db,
    relay: {
      privateKey: relayKeys.privateKey,
      kid: relayKid,
      issuer: 'https://test.invalid',
      publicJwk: relayKeys.publicJwk
    },
    publicDir
  })
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`

  function createUser({ username, password = DEFAULT_PASSWORD, role = 'member', groupId } = {}) {
    return createUserRow(db, { username, password, role, groupId })
  }

  async function login(username, password = DEFAULT_PASSWORD) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    const body = await res.json()
    if (!res.ok) {
      throw new Error(`login failed: ${JSON.stringify(body)}`)
    }
    return body.token
  }

  function api(token, path, init = {}) {
    const headers = { ...init.headers }
    if (token) {
      headers.authorization = `Bearer ${token}`
    }
    if (init.body && !headers['content-type']) {
      headers['content-type'] = 'application/json'
    }
    return fetch(`${baseUrl}${path}`, { ...init, headers })
  }

  async function ingestSession(token, overrides = {}, { transcript = null, conversation } = {}) {
    const record = baseRecord(overrides)
    const payload = { record, transcript }
    if (conversation !== undefined) {
      payload.conversation = conversation
    }
    return api(token, '/api/ingest', {
      method: 'POST',
      body: JSON.stringify({ records: [payload] })
    })
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve))
    db.close()
  }

  return { baseUrl, db, close, createUser, login, api, ingestSession }
}
