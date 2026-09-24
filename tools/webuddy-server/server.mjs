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
import { join } from 'node:path'

import { openDb } from './lib/db.mjs'
import { computeRollups } from './lib/queries.mjs'
import { ensureBootstrapAdmin } from './lib/auth.mjs'
import { llmConfig } from './lib/llm.mjs'
import { loadOrCreateSigningKey, signingKeyId } from './lib/relay-tokens.mjs'
import { startAnalysisSchedule } from './lib/analysis-job.mjs'
import { startSkillSchedule } from './lib/skill-schedule.mjs'
import { createRequestHandler } from './lib/app.mjs'

const HERE = import.meta.dirname
const PORT = Number(process.env.WEBUDDY_PORT || 8787)
// Loopback by default: nginx terminates TLS and proxies to us, so there is no
// reason to expose the origin port to the network.
const HOST = process.env.WEBUDDY_HOST || '127.0.0.1'
const DATA_DIR = process.env.WEBUDDY_DATA || join(HERE, 'data')
const ROLLUP_INTERVAL_MS = Number(process.env.WEBUDDY_ROLLUP_MS || 10 * 60 * 1000)
const PUBLIC_DIR = join(HERE, 'public')

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

const server = createServer(
  createRequestHandler({
    db,
    relay: {
      privateKey: relayKeys.privateKey,
      kid: relayKid,
      issuer: relayIssuer,
      publicJwk: relayKeys.publicJwk
    },
    publicDir: PUBLIC_DIR
  })
)

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
  console.log(
    `  skills:   every ${Math.round(skills.intervalMs / 60000)} min, per user; first run in ${Math.round(skills.startupDelayMs / 1000)} s`
  )
  const llm = llmConfig(process.env)
  console.log(
    `  model: ${llm.model} via ${llm.kind}${llm.apiKey ? '' : ' (NO API KEY — analysis disabled)'}`
  )
  if (bootstrapped) {
    console.log(`  seeded admin: ${bootstrapped.username}`)
  }
})
