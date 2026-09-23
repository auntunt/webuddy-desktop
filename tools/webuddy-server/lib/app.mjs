/**
 * Request handler for webuddy-server. `server.mjs` only wires up process-level
 * concerns (env, db open, bootstrap admin, schedules, listen); every route
 * lives here so it can be exercised against a real HTTP server in tests
 * without booting the whole process.
 */

import { upsertSessions, logBatch } from './db.mjs'
import {
  computeRollups,
  facets,
  getSession,
  groupBy,
  listSessions,
  rollups,
  toCsv,
  totals,
  countSessions,
  GROUPABLE
} from './queries.mjs'
import { isRouteAllowedForToken } from './auth.mjs'
import { handleAuthRoute } from './auth-routes.mjs'
import { handleDesktopAuthRoute } from './desktop-auth-routes.mjs'
import { listTodos, syncTodos } from './sync.mjs'
import { workSummary } from './insights.mjs'
import { lastAnalysis, runAnalysis } from './analysis-job.mjs'
import { jwksFor } from './relay-tokens.mjs'
import {
  extractSkills,
  getSkill,
  listSkills,
  skillAsMarkdown,
  skillsAsBundle
} from './skill-extraction.mjs'
import { json, readBody, serveStatic } from './http-io.mjs'
import { validate } from './ingest-validation.mjs'
import { authenticate, filtersOf } from './request-context.mjs'
import { canSeeUser, resolveOwner, resolveVisibleUsers } from './visibility.mjs'

/** `deps.relay` = { privateKey, kid, issuer, publicJwk }. */
const notFound = (res) => json(res, 404, { error: 'not found' })

export function createRequestHandler({ db, relay, publicDir }) {
  return async function handleRequest(req, res) {
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
        return json(res, 200, jwksFor(relay.publicJwk, relay.kid))
      }
      // Why before authentication: everything the login screen itself loads.
      if (!route.startsWith('/api/')) {
        if (await serveStatic(res, route, publicDir)) {
          return
        }
        return json(res, 404, { error: 'not found' })
      }

      const auth = authenticate(db, req, url)
      // 采集器 token 只认 /api/ingest：把闸放在最前面，/api/auth/*、/api/desktop/* 和数据接口都覆盖到。
      if (auth && !isRouteAllowedForToken(auth, route)) {
        return json(res, 401, { error: 'unauthorized' })
      }
      if (await handleAuthRoute({ db, req, res, url, auth })) {
        return
      }
      // 桌面端的登录/刷新本身不带 access token，所以必须排在下面那道 401 闸之前。
      if (await handleDesktopAuthRoute({ db, req, res, url, auth, relay })) {
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
        return json(res, 200, facets(db, filtersOf(url, auth, db)))
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
        const filters = filtersOf(url, auth, db)
        // Why __all__ 等同不传：admin 名下往往 0 条数据，默认成自己会让 KPI 与同页图表口径不一。
        if (filters.user === '__all__') {
          filters.user = undefined
        }
        return json(res, 200, workSummary(db, filters))
      }

      // ---- LLM 分析：默认 2 小时一轮，无新数据自动跳过 ----
      if (route === '/api/analysis/llm' && req.method === 'GET') {
        const owner = resolveOwner(db, auth, url.searchParams.get('user'), { allowAll: true })
        if (owner === undefined) {
          return notFound(res)
        }
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
        const owner = resolveOwner(db, auth, url.searchParams.get('user'), { allowAll: true })
        if (owner === undefined) {
          return notFound(res)
        }
        const result = await runAnalysis(db, owner)
        return json(res, 200, result)
      }

      // ---- skill 蒸馏：按人提炼可复用做法，可单条/整包下载 ----
      if (route === '/api/skills' && req.method === 'GET') {
        const owner = resolveOwner(db, auth, url.searchParams.get('user'))
        if (owner === undefined) {
          return notFound(res)
        }
        return json(res, 200, { userId: owner, items: listSkills(db, owner) })
      }
      if (route === '/api/skills/bundle' && req.method === 'GET') {
        const owner = resolveOwner(db, auth, url.searchParams.get('user'))
        if (owner === undefined) {
          return notFound(res)
        }
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
        // 看不见的人的 skill 不给下 —— skill 里会带原始项目路径。
        if (!skill || !canSeeUser(resolveVisibleUsers(db, auth.user), skill.user_id)) {
          return notFound(res)
        }
        res.writeHead(200, {
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': `attachment; filename="skill-${skill.id}.md"`
        })
        return res.end(skillAsMarkdown(skill))
      }
      if (route === '/api/skills/extract' && req.method === 'POST') {
        const owner = resolveOwner(db, auth, url.searchParams.get('user'))
        if (owner === undefined) {
          return notFound(res)
        }
        return json(res, 200, await extractSkills(db, owner))
      }

      // relay token 的签发在 /api/desktop/relay-token：relayHostId 只能由主机公钥推导，
      // 那条路径才拿得到 hostPublicKeyB64。这里只留 relay 取公钥用的 JWKS。

      if (route === '/api/stats') {
        // 图表要能"展开全部"，所以分组上限得可调；500 是防止有人一次拉爆。
        const limit = Math.min(Number(url.searchParams.get('limit') || 50), 500)
        const filters = filtersOf(url, auth, db)
        // Why：旧看板用 `group` 传分组维度，与小组筛选同名；维度名优先按旧义解释。
        const legacy = url.searchParams.get('group')
        const isDimension = Object.hasOwn(GROUPABLE, legacy ?? '')
        if (isDimension) {
          filters.group = undefined
        }
        const group = url.searchParams.get('by') || (isDimension ? legacy : 'person')
        return json(res, 200, {
          totals: totals(db, filters),
          groups: groupBy(db, group, filters, limit)
        })
      }

      if (route === '/api/sessions') {
        const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200)
        const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0)
        const filters = filtersOf(url, auth, db)
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
        // Why check here too: dedupe_key is guessable from a shared link.
        if (!session || !canSeeUser(resolveVisibleUsers(db, auth.user), session.user_id)) {
          return notFound(res)
        }
        return json(res, 200, session)
      }

      if (route === '/api/analysis') {
        return json(res, 200, { rollups: rollups(db, filtersOf(url, auth, db)) })
      }

      if (route === '/api/export.csv' || route === '/api/export.json') {
        const rows = listSessions(db, filtersOf(url, auth, db), 100000, 0)
        if (route.endsWith('.json')) {
          return json(res, 200, { items: rows })
        }
        const csv = toCsv(rows)
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="webuddy-sessions-${Date.now()}.csv"`
        })
        return res.end(`﻿${csv}`)
      }

      return json(res, 404, { error: 'not found' })
    } catch (error) {
      return json(res, 400, { error: String(error?.message ?? error) })
    }
  }
}
