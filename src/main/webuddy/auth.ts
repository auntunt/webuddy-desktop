/**
 * 账号登录（主进程）。
 *
 * 为什么凭证落到采集器的配置文件而不是 Electron safeStorage：
 * 采集器是被 app 以独立 Node 进程拉起的，它只认 ~/.webuddy-agent/config.json。
 * 让两边读同一个文件，一台机器就只有一个身份；否则会出现「app 里登录了、
 * 采集器仍用旧身份上传」这种最难查的分裂。
 *
 * 未登录 = 不上传。不兜底、不猜身份。
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type WebuddyUser = {
  id: string
  username: string
  displayName: string | null
  role: 'admin' | 'member'
}

export type AuthStatus = {
  loggedIn: boolean
  user?: WebuddyUser
  endpoint: string
}

/** 默认上线地址；可用环境变量覆盖（预发/本地）。 */
export const DEFAULT_ORIGIN = 'https://webuddyserver.cloudwaveai.cn'

export function authOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return env.WEBUDDY_ORIGIN || DEFAULT_ORIGIN
}

export function collectorConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  // 与采集器 lib/state.mjs 的解析顺序保持一致。
  const home = env.WEBUDDY_AGENT_HOME || join(env.WEBUDDY_HOME || homedir(), '.webuddy-agent')
  return join(home, 'config.json')
}

async function readConfig(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function writeConfig(path: string, config: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  // Why 600: the file holds a bearer token that can read the owner's transcripts.
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await chmod(path, 0o600).catch(() => undefined)
}

export async function login(
  username: string,
  password: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<WebuddyUser> {
  const origin = authOrigin(env)
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, label: `app:${process.platform}` })
  })
  if (!response.ok) {
    // Why not surface the server body verbatim: it is JSON with English keys and
    // reads poorly in a login form.
    throw new Error(response.status === 401 ? '用户名或密码不对' : `登录失败（${response.status}）`)
  }
  const data = (await response.json()) as {
    token: string
    user: { id: string; username: string; display_name: string | null; role: 'admin' | 'member' }
  }
  const path = collectorConfigPath(env)
  const config = await readConfig(path)
  // 服务端返回的 username 才是权威写法，记录归属必须和它一致。
  await writeConfig(path, {
    ...config,
    endpoint: `${origin}/api/ingest`,
    token: data.token,
    userId: data.user.username
  })
  return {
    id: data.user.id,
    username: data.user.username,
    displayName: data.user.display_name,
    role: data.user.role
  }
}

export async function logout(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const path = collectorConfigPath(env)
  const config = await readConfig(path)
  delete config.token
  delete config.userId
  await writeConfig(path, config)
}

export async function status(env: NodeJS.ProcessEnv = process.env): Promise<AuthStatus> {
  const config = await readConfig(collectorConfigPath(env))
  const token = typeof config.token === 'string' ? config.token : ''
  const endpoint =
    typeof config.endpoint === 'string' ? config.endpoint : `${authOrigin(env)}/api/ingest`
  if (!token) {
    return { loggedIn: false, endpoint }
  }
  try {
    const response = await fetch(`${authOrigin(env)}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` }
    })
    if (!response.ok) {
      // 凭证被吊销或过期：如实报告未登录，而不是留着一个用不了的 token。
      return { loggedIn: false, endpoint }
    }
    const data = (await response.json()) as {
      user: { id: string; username: string; display_name: string | null; role: 'admin' | 'member' }
    }
    return {
      loggedIn: true,
      endpoint,
      user: {
        id: data.user.id,
        username: data.user.username,
        displayName: data.user.display_name,
        role: data.user.role
      }
    }
  } catch {
    // 离线时保留登录态：已登录的机器断网不应该被踢出。
    return {
      loggedIn: true,
      endpoint,
      user: {
        id: '',
        username: typeof config.userId === 'string' ? config.userId : '',
        displayName: null,
        role: 'member'
      }
    }
  }
}
