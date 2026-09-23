/**
 * Collector config file access (main process).
 *
 * 为什么凭证落到采集器的配置文件而不是 Electron safeStorage：
 * 采集器是被 app 以独立 Node 进程拉起的，它只认 ~/.webuddy-agent/config.json。
 * 让两边读同一个文件，一台机器就只有一个身份；否则会出现「app 里登录了、
 * 采集器仍用旧身份上传」这种最难查的分裂。
 *
 * 未登录 = 不上传。不兜底、不猜身份。
 */

import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type LastPush = {
  at: string
  pushed: number
  failed: number
  exhausted: number
  authRejected: boolean
  error?: string
}

export function collectorStateDir(env: NodeJS.ProcessEnv = process.env): string {
  // 与采集器 lib/state.mjs 的解析顺序保持一致。
  return env.WEBUDDY_AGENT_HOME || join(env.WEBUDDY_HOME || homedir(), '.webuddy-agent')
}

export function collectorConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(collectorStateDir(env), 'config.json')
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? { ...parsed }
      : null
  } catch {
    return null
  }
}

export async function readCollectorConfig(path: string): Promise<Record<string, unknown>> {
  return (await readJsonObject(path)) ?? {}
}

export async function writeCollectorConfig(
  path: string,
  config: Record<string, unknown>
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  // Why 600: the file holds a bearer token that can read the owner's transcripts.
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await chmod(path, 0o600).catch(() => undefined)
}

export async function readLastPush(env: NodeJS.ProcessEnv = process.env): Promise<LastPush | null> {
  const raw = await readJsonObject(join(collectorStateDir(env), 'last-push.json'))
  if (!raw || typeof raw.at !== 'string') {
    return null
  }
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
  return {
    at: raw.at,
    pushed: num(raw.pushed),
    failed: num(raw.failed),
    exhausted: num(raw.exhausted),
    authRejected: raw.authRejected === true,
    ...(typeof raw.error === 'string' ? { error: raw.error } : {})
  }
}

/** Why 同一个 device.json：服务端按设备签 token，必须和采集器上报的 deviceId 一致。 */
export async function ensureCollectorDeviceId(
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const path = join(collectorStateDir(env), 'device.json')
  const existing = await readJsonObject(path)
  if (typeof existing?.deviceId === 'string' && existing.deviceId) {
    return existing.deviceId
  }
  const deviceId = randomUUID()
  await writeCollectorConfig(path, { deviceId, createdAt: new Date().toISOString() })
  return deviceId
}
