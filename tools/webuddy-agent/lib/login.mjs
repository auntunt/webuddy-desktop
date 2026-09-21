/**
 * `webuddy-agent login` — exchange company credentials for a personal token.
 *
 * Why a browser-less CLI login rather than only an in-app form: the collector
 * runs headless (scheduled, and spawned by the desktop app), so the credential
 * has to live in the collector's own config. The desktop app reads the same
 * config, which keeps one identity per machine instead of two.
 */

import { createInterface } from 'node:readline'

import { loadConfig, saveConfig, paths } from './state.mjs'

/** Derive the API origin from the configured ingest endpoint. */
export function originFromEndpoint(endpoint) {
  if (!endpoint) {
    return null
  }
  try {
    const url = new URL(endpoint)
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    // Muting the echo keeps the password out of the terminal scrollback.
    const onData = (char) => {
      if (['\n', '\r', '\u0004'].includes(String(char))) {
        return
      }
      process.stdout.write(`\r\x1b[K${question}`)
    }
    process.stdin.on('data', onData)
    process.stdout.write(question)
    rl.question('', (answer) => {
      process.stdin.off('data', onData)
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

export async function login({ username, password, label, json = false }) {
  const config = await loadConfig()
  const origin = originFromEndpoint(config.endpoint)
  if (!origin) {
    throw new Error(
      '先配置 endpoint，例如 webuddy-agent config set endpoint=https://<域名>/api/ingest'
    )
  }
  const user = username || process.env.WEBUDDY_LOGIN_USER
  const secret = password || process.env.WEBUDDY_LOGIN_PASSWORD || (await askHidden('密码: '))
  if (!user || !secret) {
    throw new Error('需要用户名和密码')
  }

  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: user, password: secret, label: label ?? 'cli' })
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`登录失败 (${response.status}) ${body.slice(0, 200)}`)
  }
  const data = await response.json()

  // Why the server's username and not what was typed: casing/aliases are the
  // server's business, and records must attribute to the canonical name.
  config.token = data.token
  config.userId = data.user.username
  await saveConfig(config)

  if (json) {
    return { user: data.user, tokenPrefix: data.token.slice(0, 10) }
  }
  return { user: data.user, tokenPrefix: data.token.slice(0, 10), configPath: paths.config }
}
