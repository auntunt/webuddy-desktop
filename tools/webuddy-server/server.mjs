#!/usr/bin/env node
/**
 * webuddy-server — receives collected agent sessions, stores them, serves the
 * dashboard, and keeps per-day rollups current.
 *
 * Run: node server.mjs
 *   env: WEBUDDY_PORT, WEBUDDY_DATA, WEBUDDY_ADMIN_USER, WEBUDDY_ADMIN_PASSWORD
 * Zero dependencies: node:http + node:sqlite.
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { openDb, upsertSessions, logBatch } from './lib/db.mjs'
import {
  computeRollups,
  facets,
  getSession,
  groupBy,
  listSessions,
  rollups,
  toCsv,
  totals,
  countSessions
} from './lib/queries.mjs'
import { ensureBootstrapAdmin, isRouteAllowedForToken, resolveToken } from './lib/auth.mjs'
import { handleAuthRoute } from './lib/auth-routes.mjs'
import { handleDesktopAuthRoute } from './lib/desktop-auth-routes.mjs'
import { listTodos, syncTodos } from './lib/sync.mjs'
import { workSummary } from './lib/insights.mjs'
import { lastAnalysis, runAnalysis, startAnalysisSchedule } from './lib/analysis-job.mjs'
import { llmConfig } from './lib/llm.mjs'
import { jwksFor, loadOrCreateSigningKey, signingKeyId } from './lib/relay-tokens.mjs'
import {
  extractSkills,
  getSkill,
  listSkills,
  skillAsMarkdown,
  skillsAsBundle,
  startSkillSchedule
} from './lib/skill-extraction.mjs'

const HERE = import.meta.dirname
const PORT = Number(process.env.WEBUDDY_PORT || 8787)
// Loopback by default: nginx terminates TLS and proxies to us, so there is no
// reason to expose the origin port to the network.
const HOST = process.env.WEBUDDY_HOST || '127.0.0.1'
const DATA_DIR = process.env.WEBUDDY_DATA || join(HERE, 'data')
const ROLLUP_INTERVAL_MS = Number(process.env.WEBUDDY_ROLLUP_MS || 10 * 60 * 1000)

const db = openDb(join(DATA_DIR, 'webuddy.db'))

// Why env rather than a seeder script: the deployment needs a way in on first
// boot, and "create a user" itself requires an authenticated admin.
const bootstrapped = ensureBootstrapAdmin(db, {
  username: process.env.WEBUDDY_ADMIN_USER,
  password: process.env.WEBUDDY_ADMIN_PASSWORD
})

// relay 的签发密钥：持久化在数据目录，重启后旧 token 仍验得过。
const relayKeys = loadOrCreateSigningKey(DATA_DIR)
const relayKid = signingKeyId(relayKeys.publicJwk)
const relayIssuer =
  process.env.WEBUDDY_RELAY_ISSUER ||
  `https://${process.env.WEBUDDY_PUBLIC_HOST || 'webuddyserver.cloudwaveai.cn'}`

const REQUIRED = ['schema', 'actor', 'agent', 'session', 'transcript', 'consent']
const REQUIRED_PATHS = [
  'actor.userId',
  'actor.deviceId',
  'agent.id',
  'session.id',
  'session.localDate',
  'transcript.sha256'
]

function validate(record) {
  const errors = []
  for (const key of REQUIRED) {
    if (!record?.[key]) {
      errors.push(`missing ${key}`)
    }
  }
  for (const path of REQUIRED_PATHS) {
    const value = path.split('.').reduce((node, key) => node?.[key], record)
    if (typeof value !== 'string' || !value) {
      errors.push(`missing ${path}`)
    }
  }
  return errors
}

const json = (res, code, body) => {
  const text = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text)
  })
  res.end(text)
}

/** Resolve the caller's identity from a bearer token, or `?token=` for links. */
function authenticate(req, url) {
  const header = req.headers.authorization ?? ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null
  return resolveToken(db, bearer ?? url.searchParams.get('token'))
}

async function readBody(req, limitBytes = 64 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limitBytes) {
      throw new Error('payload too large')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function filtersOf(url, auth) {
  const q = url.searchParams
  return {
    // Members are pinned to their own rows; only admins see the whole team.
    ownerId: auth.user.role === 'admin' ? undefined : auth.user.username,
    user: q.get('user') || undefined,
    agent: q.get('agent') || undefined,
    project: q.get('project') || undefined,
    from: q.get('from') || undefined,
    to: q.get('to') || undefined,
    q: q.get('q') || undefined
  }
}

/** Dashboard assets. Served before the auth gate — the login page needs them. */
async function serveStatic(res, route) {
  const asset = route === '/' ? 'index.html' : route.slice(1)
  if (!/^[a-z0-9._-]+$/i.test(asset)) {
    return false
  }
  try {
    const body = await readFile(join(HERE, 'public', asset))
    const type = asset.endsWith('.css')
      ? 'text/css'
      : asset.endsWith('.js')
        ? 'text/javascript'
        : 'text/html'
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-cache' })
    res.end(body)
    return true
  } catch {
    return false
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const route = url.pathname
  try {
    if (route === '/api/health') {
      return json(res, 200, {
        ok: true,
        rollups: db.prepare('SELECT COUNT(*) AS n FROM daily_rollups').get().n
      })
    }
    // Why 免鉴权：JWKS 本身就是公钥，且 relay 要在没有我们用户凭证的情况下取它。
    if (route === '/api/relay/jwks') {
      return json(res, 200, jwksFor(relayKeys.publicJwk, relayKid))
    }
    // Why before authentication: everything the login screen itself loads.
    if (!route.startsWith('/api/')) {
      if (await serveStatic(res, route)) {
        return
      }
      return json(res, 404, { error: 'not found' })
    }

    const auth = authenticate(req, url)
    // 采集器 token 只认 /api/ingest：把闸放在最前面，/api/auth/*、/api/desktop/* 和数据接口都覆盖到。
    if (auth && !isRouteAllowedForToken(auth, route)) {
      return json(res, 401, { error: 'unauthorized' })
    }
    if (await handleAuthRoute({ db, req, res, url, auth })) {
      return
    }
    // 桌面端的登录/刷新本身不带 access token，所以必须排在下面那道 401 闸之前。
    if (
      await handleDesktopAuthRoute({
        db,
        req,
        res,
        url,
        auth,
        relay: { privateKey: relayKeys.privateKey, kid: relayKid, issuer: relayIssuer }
      })
    ) {
      return
    }
    if (!auth) {
      return json(res, 401, {
        error: 'unauthorized',
        hint: '先 POST /api/auth/login 拿 token，再带 Authorization: Bearer <token>'
      })
    }

    if (req.method === 'POST' && route === '/api/ingest') {
      const body = JSON.parse(await readBody(req))
      const payloads = Array.isArray(body?.records) ? body.records : []
      const accepted = []
      const rejected = []
      for (const payload of payloads) {
        const errors = validate(payload?.record)
        if (errors.length) {
          rejected.push({ sessionId: payload?.record?.session?.id ?? null, errors })
        } else {
          accepted.push(payload)
        }
      }
      // Why overwrite rather than trust: the record's actor.userId arrives from
      // the client, so a member could otherwise label their uploads as a
      // colleague. The token decides the owner, full stop.
      for (const payload of accepted) {
        payload.record.actor.userId = auth.user.username
      }
      const receivedAt = new Date().toISOString()
      const written = upsertSessions(db, accepted, receivedAt)
      logBatch(db, {
        receivedAt,
        deviceId: accepted[0]?.record?.actor?.deviceId,
        userId: auth.user.username,
        recordCount: written,
        rejected: rejected.length
      })
      if (rejected.length === 0) {
        computeRollups(db)
      }
      return json(res, 200, { ok: true, written, rejected })
    }

    if (route === '/api/facets') {
      return json(res, 200, facets(db, filtersOf(url, auth)))
    }

    // ---- 待办同步：个人数据，按设备游标增量 ----
    if (route === '/api/sync/todos' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 4 * 1024 * 1024))
      return json(
        res,
        200,
        syncTodos(db, auth.user.username, {
          deviceId: body.deviceId ?? req.headers['x-webuddy-device-id'],
          since: body.since,
          items: body.items
        })
      )
    }
    if (route === '/api/todos' && req.method === 'GET') {
      return json(res, 200, {
        items: listTodos(db, auth.user.username, {
          from: url.searchParams.get('from') || undefined,
          to: url.searchParams.get('to') || undefined
        })
      })
    }

    // ---- 个人工作情况分析 ----
    if (route === '/api/insights' && req.method === 'GET') {
      // 带上全套筛选（日期/项目/agent/关键词），否则切区间时 KPI 不会变。
      const filters = filtersOf(url, auth)
      const wanted = url.searchParams.get('user')
      if (auth.user.role === 'admin') {
        // 成员被 ownerId 钉在自己身上；管理员「没传 user」或「user=__all__」都表示全组。
        // Why 不能默认成管理员自己：admin 这类账号名下往往 0 条数据，默认成自己会让
        // KPI 全 0，而同页图表（走 /api/stats）却是全组 —— 同一屏两套口径，看着就像坏了。
        filters.user = !wanted || wanted === '__all__' ? undefined : wanted
      }
      return json(res, 200, workSummary(db, filters))
    }

    // ---- LLM 分析：默认 2 小时一轮，无新数据自动跳过 ----
    if (route === '/api/analysis/llm' && req.method === 'GET') {
      const owner =
        auth.user.role === 'admin' && url.searchParams.get('user') === '__all__'
          ? null
          : auth.user.username
      const latest = lastAnalysis(db, owner)
      return json(
        res,
        200,
        latest
          ? {
              model: latest.model,
              createdAt: latest.created_at,
              sessionsCovered: latest.sessions_covered,
              inputTokens: latest.input_tokens,
              outputTokens: latest.output_tokens,
              content: latest.content
            }
          : {
              content: null,
              hint: '还没有分析结果；等一轮定时任务，或 POST /api/analysis/llm/run 立即跑一次'
            }
      )
    }
    if (route === '/api/analysis/llm/run' && req.method === 'POST') {
      // 手动触发也要过同一道"没新数据就不跑"的闸，否则手动就成了绕过省钱的口子。
      const result = await runAnalysis(db, auth.user.username)
      return json(res, 200, result)
    }

    // ---- skill 蒸馏：按人提炼可复用做法，可单条/整包下载 ----
    if (route === '/api/skills' && req.method === 'GET') {
      const wanted = url.searchParams.get('user')
      const owner = auth.user.role === 'admin' && wanted ? wanted : auth.user.username
      return json(res, 200, { userId: owner, items: listSkills(db, owner) })
    }
    if (route === '/api/skills/bundle' && req.method === 'GET') {
      const wanted = url.searchParams.get('user')
      const owner = auth.user.role === 'admin' && wanted ? wanted : auth.user.username
      const markdown = skillsAsBundle(owner, listSkills(db, owner))
      res.writeHead(200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="webuddy-skills-${owner}.md"`
      })
      return res.end(markdown)
    }
    if (route.startsWith('/api/skills/') && route.endsWith('/download') && req.method === 'GET') {
      const id = route.slice('/api/skills/'.length, -'/download'.length)
      const skill = getSkill(db, id)
      if (!skill) {
        return json(res, 404, { error: 'not found' })
      }
      // 别人的 skill 不给下 —— 同一道归属边界，skill 里会带原始项目路径。
      if (auth.user.role !== 'admin' && skill.user_id !== auth.user.username) {
        return json(res, 404, { error: 'not found' })
      }
      res.writeHead(200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="skill-${skill.id}.md"`
      })
      return res.end(skillAsMarkdown(skill))
    }
    if (route === '/api/skills/extract' && req.method === 'POST') {
      return json(res, 200, await extractSkills(db, auth.user.username))
    }

    // relay token 的签发在 /api/desktop/relay-token：relayHostId 只能由主机公钥推导，
    // 那条路径才拿得到 hostPublicKeyB64。这里只留 relay 取公钥用的 JWKS。

    if (route === '/api/stats') {
      const group = url.searchParams.get('group') || 'person'
      // 图表要能"展开全部"，所以分组上限得可调；500 是防止有人一次拉爆。
      const limit = Math.min(Number(url.searchParams.get('limit') || 50), 500)
      const filters = filtersOf(url, auth)
      return json(res, 200, {
        totals: totals(db, filters),
        groups: groupBy(db, group, filters, limit)
      })
    }

    if (route === '/api/sessions') {
      const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200)
      const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0)
      const filters = filtersOf(url, auth)
      // 带上 total，前端才能画翻页器（否则只能靠"下一页点不动了"来判断到底）。
      return json(res, 200, {
        items: listSessions(db, filters, limit, offset),
        total: countSessions(db, filters),
        limit,
        offset
      })
    }

    if (route.startsWith('/api/sessions/')) {
      const session = getSession(db, decodeURIComponent(route.slice('/api/sessions/'.length)))
      // Why check ownership here too: dedupe_key is guessable from a shared
      // link, so fetching one row must go through the same boundary.
      if (session && auth.user.role !== 'admin' && session.user_id !== auth.user.username) {
        return json(res, 404, { error: 'not found' })
      }
      return session ? json(res, 200, session) : json(res, 404, { error: 'not found' })
    }

    if (route === '/api/analysis') {
      return json(res, 200, { rollups: rollups(db, filtersOf(url, auth)) })
    }

    if (route === '/api/export.csv' || route === '/api/export.json') {
      const rows = listSessions(db, filtersOf(url, auth), 100000, 0)
      if (route.endsWith('.json')) {
        return json(res, 200, { items: rows })
      }
      const csv = toCsv(rows)
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="webuddy-sessions-${Date.now()}.csv"`
      })
      return res.end(`\uFEFF${csv}`)
    }

    return json(res, 404, { error: 'not found' })
  } catch (error) {
    return json(res, 400, { error: String(error?.message ?? error) })
  }
})

computeRollups(db)
setInterval(() => {
  try {
    computeRollups(db)
  } catch (error) {
    console.error('[rollup] failed:', error?.message ?? error)
  }
}, ROLLUP_INTERVAL_MS).unref()

// 全组维度定时分析（管理员视角）。默认 2 小时一轮，无新数据自动跳过。
const analysis = startAnalysisSchedule(db)
void analysis.tick()

// skill 蒸馏：按人逐个提炼，默认 6 小时一轮（比分析慢 —— 提炼要的是跨会话的重复模式）
const skills = startSkillSchedule(db)

server.listen(PORT, HOST, () => {
  console.log(`webuddy-server listening on http://${HOST}:${PORT}`)
  console.log(`  data:  ${join(DATA_DIR, 'webuddy.db')}`)
  console.log('  auth:  per-user tokens (POST /api/auth/login)')
  console.log(
    `  analysis: every ${Math.round(analysis.intervalMs / 60000)} min, skipped when no new data`
  )
  console.log(`  skills:   every ${Math.round(skills.intervalMs / 60000)} min, per user`)
  const llm = llmConfig(process.env)
  console.log(
    `  model: ${llm.model} via ${llm.kind}${llm.apiKey ? '' : ' (NO API KEY — analysis disabled)'}`
  )
  if (bootstrapped) {
    console.log(`  seeded admin: ${bootstrapped.username}`)
  }
})
