#!/usr/bin/env node
/**
 * Seeds a local webuddy-server with demo data for the dashboard: one group, a lead,
 * two members and 20 sessions across 3 people, 2 agents and the last ~12 days.
 *
 * Usage (server started with a bootstrap admin, e.g. a throwaway WEBUDDY_DATA):
 *   WEBUDDY_ADMIN_USER=admin WEBUDDY_ADMIN_PASSWORD=admin-pass-1 node server.mjs
 *   WEBUDDY_ADMIN_USER=admin WEBUDDY_ADMIN_PASSWORD=admin-pass-1 \
 *     node web/scripts/seed-dev-data.mjs [http://127.0.0.1:8787]
 *
 * Re-runnable: existing group/users are reused and sessions have fixed ids, so a
 * second run updates the same rows. Seeded users log in with password `password1`.
 * Plain Node, no dependencies.
 */

const BASE = process.argv[2] ?? process.env.WEBUDDY_URL ?? 'http://127.0.0.1:8787'
const ADMIN_USER = process.env.WEBUDDY_ADMIN_USER ?? 'admin'
const ADMIN_PASSWORD = process.env.WEBUDDY_ADMIN_PASSWORD ?? 'admin-pass-1'
const PASSWORD = 'password1'
const GROUP_NAME = '前端组'

const PEOPLE = [
  { username: 'lina', displayName: '李娜', role: 'lead', inGroup: true },
  { username: 'wang', displayName: '王磊', role: 'member', inGroup: true },
  { username: 'zhao', displayName: '赵敏', role: 'member', inGroup: false }
]

const AGENTS = [
  { id: 'claude-code', label: 'Claude Code', version: '2.1.0', model: 'claude-opus' },
  { id: 'codex', label: 'Codex', version: '0.40.0', model: 'gpt-5-codex' }
]

const PROJECTS = [
  { cwd: '/Users/dev/work/webuddy-desktop', branch: 'main' },
  { cwd: '/Users/dev/work/webuddy-server', branch: 'feat/dashboard' },
  { cwd: '/Users/dev/sandbox/report-bot', branch: 'main' }
]

async function request(path, { token, method = 'GET', body } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) {
    headers.authorization = `Bearer ${token}`
  }
  const init =
    body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) }
  const res = await fetch(`${BASE}${path}`, init)
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function login(username, password) {
  const { status, data } = await request('/api/auth/login', {
    method: 'POST',
    body: { username, password, label: 'seed' }
  })
  if (status !== 200) {
    throw new Error(`login ${username} failed (${status}): ${JSON.stringify(data)}`)
  }
  return data.token
}

async function ensureGroup(adminToken) {
  const created = await request('/api/admin/groups', {
    token: adminToken,
    method: 'POST',
    body: { name: GROUP_NAME }
  })
  if (created.status === 201) {
    return created.data.group.id
  }
  const { data } = await request('/api/admin/groups', { token: adminToken })
  const group = data.groups?.find((g) => g.name === GROUP_NAME)
  if (!group) {
    throw new Error(`cannot create or find group: ${JSON.stringify(created.data)}`)
  }
  return group.id
}

async function ensureUser(adminToken, person, groupId) {
  const { status, data } = await request('/api/admin/users', {
    token: adminToken,
    method: 'POST',
    body: {
      username: person.username,
      password: PASSWORD,
      displayName: person.displayName,
      role: person.role,
      groupId: person.inGroup ? groupId : null
    }
  })
  if (status !== 201 && status !== 409) {
    throw new Error(`create ${person.username} failed (${status}): ${JSON.stringify(data)}`)
  }
}

function localDate(daysAgo) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function transcriptFor(i, person, project) {
  const lines = [
    `user: 帮我看看 ${project.cwd.split('/').pop()} 里第 ${i + 1} 个问题`,
    'assistant: 好的，我先读一下相关文件。',
    `tool: read_file src/module-${i}.ts`,
    'assistant: 问题出在缓存没有失效，我改一下并补一条测试。',
    `user: 可以，提交到 ${project.branch}`,
    `assistant: 已提交。token=[REDACTED] 已按规则脱敏。（${person.username}）`
  ]
  return lines.join('\n')
}

/** Session i of 20: spread over people, agents, projects and the last ~12 days. */
function recordFor(i) {
  const person = PEOPLE[i % PEOPLE.length]
  const agent = AGENTS[i % 5 >= 3 ? 1 : 0]
  const project = PROJECTS[i % PROJECTS.length]
  // Leaves a few idle days so the chart shows zero-filled gaps.
  const daysAgo = [0, 1, 1, 2, 4, 4, 5, 7, 8, 8, 9, 11][i % 12]
  const date = localDate(daysAgo)
  const started = new Date(`${date}T09:00:00`)
  started.setMinutes(started.getMinutes() + i * 17)
  // One session spans 30 h so the 12 h clamp shows up in the KPI.
  const durationMs = i === 7 ? 30 * 3_600_000 : (20 + ((i * 23) % 140)) * 60_000
  const ended = new Date(started.getTime() + durationMs)
  const turns = 3 + ((i * 7) % 25)
  // Codex doesn't report usage here, so its tokens stay 0 and the UI shows "—".
  const tokens = agent.id === 'codex' ? 0 : 12_000 + i * 3_517
  const sessionId = `seed-session-${String(i).padStart(2, '0')}`
  return {
    username: person.username,
    transcript: transcriptFor(i, person, project),
    record: {
      schema: 'webuddy.agent-session.v1',
      collectedAt: new Date().toISOString(),
      actor: {
        userId: person.username,
        deviceId: `${person.username}-mbp`,
        hostname: `${person.username}-mbp.local`,
        osUser: person.username,
        platform: 'darwin',
        deviceLabel: `${person.displayName} 的 MacBook`
      },
      agent: agent,
      session: {
        id: sessionId,
        startedAt: started.toISOString(),
        endedAt: ended.toISOString(),
        durationMs,
        localDate: date,
        turnCount: turns,
        messageCount: turns * 2 + 1,
        tokens: { input: Math.round(tokens * 0.8), output: Math.round(tokens * 0.2), total: tokens }
      },
      workspace: { cwd: project.cwd, branch: project.branch, repo: project.cwd.split('/').pop() },
      transcript: {
        path: `/Users/${person.username}/.${agent.id}/sessions/${sessionId}.jsonl`,
        bytes: 4096 + i * 512,
        sha256: `${i.toString(16).padStart(2, '0')}ab`.repeat(16),
        format: 'jsonl'
      },
      redaction: {
        policyVersion: 'webuddy.redact.v1',
        rulesApplied: i % 4 === 0 ? ['api-key'] : [],
        transcriptTruncated: i === 5
      },
      consent: { scope: 'transcript-full' }
    }
  }
}

async function main() {
  const adminToken = await login(ADMIN_USER, ADMIN_PASSWORD)
  const groupId = await ensureGroup(adminToken)
  for (const person of PEOPLE) {
    await ensureUser(adminToken, person, groupId)
  }
  const tokens = {}
  for (const person of PEOPLE) {
    tokens[person.username] = await login(person.username, PASSWORD)
  }
  const records = Array.from({ length: 20 }, (_, i) => recordFor(i))
  let written = 0
  for (const person of PEOPLE) {
    const mine = records.filter((r) => r.username === person.username)
    const { status, data } = await request('/api/ingest', {
      token: tokens[person.username],
      method: 'POST',
      body: { records: mine.map(({ record, transcript }) => ({ record, transcript })) }
    })
    if (status !== 200 || data.rejected?.length) {
      throw new Error(`ingest for ${person.username} failed (${status}): ${JSON.stringify(data)}`)
    }
    written += data.written
  }
  console.log(
    `seeded ${BASE}: group ${GROUP_NAME}, users ${PEOPLE.map((p) => p.username).join(', ')}`
  )
  console.log(`  ${written} sessions written; user password: ${PASSWORD}`)
}

main().catch((error) => {
  console.error(error.message ?? error)
  process.exit(1)
})
