import { app } from 'electron'
import {
  cleanCloudServiceUrl as cleanUrl,
  cleanCloudServiceOrigin as cleanOrigin
} from '../../shared/cloud-service-url'
import { resolvePushGatewayOrigin } from '../runtime/push/push-gateway-origin'

export type OrcaCloudAuthConfig = {
  apiBaseUrl: string
  sessionEndpoint: string
  refreshEndpoint: string
  capabilitiesEndpoint: string
  profileEndpoint: string
  orgEndpoint: string
  logoutEndpoint: string
  relayTokenEndpoint: string
  relayDirectorUrl: string
}

const PRODUCTION_API_BASE_URL = 'https://webuddyserver.cloudwaveai.cn'
// Why 与 apiBaseUrl 同域名：客户端对 /v1/assign、/v1/regions 是硬编码路径（不可配置），
// nginx 把 /v1/* 转给 relay、/api/* 转给 webuddy-server，两者本就在同一台服务器上。
const PRODUCTION_RELAY_DIRECTOR_URL = 'https://webuddyserver.cloudwaveai.cn'
// Why 不用上游的 /v1/desktop/auth/*：/v1/ 前缀已经归 relay，一旦 nginx 漏配规则，
// 请求会静默打到 relay 上返回 404；/api/ 本来就是 webuddy-server 的地盘。
const DESKTOP_AUTH_BASE_PATH = '/api/desktop'

// Why: packaged main bundles never define NODE_ENV, so packaged-ness is the
// only reliable production signal for gating dev-only auth escape hatches.
function isPackagedOrcaBuild(): boolean {
  try {
    return app?.isPackaged === true
  } catch {
    return false
  }
}

function endpoint(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl}/`).toString()
}

export function getOrcaCloudAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
  packaged: boolean = isPackagedOrcaBuild()
): { configured: true; config: OrcaCloudAuthConfig } | { configured: false; setupMessage: string } {
  // Why: loopback HTTP endpoints are a local-development convenience only;
  // packaged builds must not accept plain-HTTP token endpoints via env vars.
  const allowLoopbackHttp = !packaged
  const cleanEndpointUrl = (value: string | undefined): string | null =>
    cleanUrl(value, allowLoopbackHttp)
  const configuredApiBaseUrl = env.ORCA_CLOUD_API_URL?.trim()
  // Why: packaged releases cannot depend on launch-time environment injection;
  // this first-party endpoint is not a secret.
  const apiBaseUrl = configuredApiBaseUrl
    ? cleanEndpointUrl(configuredApiBaseUrl)
    : packaged
      ? PRODUCTION_API_BASE_URL
      : null
  if (!apiBaseUrl) {
    return {
      configured: false,
      setupMessage: 'Webuddy Cloud sign-in is not configured for this build.'
    }
  }

  const desktopPath = (path: string): string => `${DESKTOP_AUTH_BASE_PATH}${path}`
  return {
    configured: true,
    config: {
      apiBaseUrl,
      sessionEndpoint:
        cleanEndpointUrl(env.ORCA_CLOUD_SESSION_URL) ??
        endpoint(apiBaseUrl, desktopPath('/session')),
      refreshEndpoint:
        cleanEndpointUrl(env.ORCA_CLOUD_REFRESH_URL) ??
        endpoint(apiBaseUrl, desktopPath('/refresh')),
      capabilitiesEndpoint:
        cleanEndpointUrl(env.ORCA_CLOUD_CAPABILITIES_URL) ??
        endpoint(apiBaseUrl, desktopPath('/capabilities')),
      profileEndpoint:
        cleanEndpointUrl(env.ORCA_CLOUD_PROFILE_URL) ??
        endpoint(apiBaseUrl, desktopPath('/profile')),
      orgEndpoint:
        cleanEndpointUrl(env.ORCA_CLOUD_ORG_URL) ?? endpoint(apiBaseUrl, desktopPath('/org')),
      logoutEndpoint:
        cleanEndpointUrl(env.ORCA_CLOUD_LOGOUT_URL) ?? endpoint(apiBaseUrl, desktopPath('/logout')),
      relayTokenEndpoint:
        cleanEndpointUrl(env.ORCA_CLOUD_RELAY_TOKEN_URL) ??
        endpoint(apiBaseUrl, desktopPath('/relay-token')),
      relayDirectorUrl:
        cleanOrigin(env.ORCA_RELAY_URL, allowLoopbackHttp) ?? PRODUCTION_RELAY_DIRECTOR_URL
    }
  }
}

/**
 * Where the host registers phones for background push. Deliberately outside
 * OrcaCloudAuthConfig: the push gateway authenticates with the host keypair, so an
 * accountless host reaches it on exactly the same path as a signed-in one.
 */
export function getOrcaPushGatewayUrl(
  env: NodeJS.ProcessEnv = process.env,
  packaged: boolean = isPackagedOrcaBuild()
): string {
  return resolvePushGatewayOrigin(env, packaged)
}

export function allowsPlaintextOrcaCloudSession(
  env: NodeJS.ProcessEnv = process.env,
  packaged: boolean = isPackagedOrcaBuild()
): boolean {
  return (
    env.ORCA_CLOUD_ALLOW_PLAINTEXT_SESSION === '1' && env.NODE_ENV !== 'production' && !packaged
  )
}

export function isOrcaCloudDevAuthEnabled(
  env: NodeJS.ProcessEnv = process.env,
  packaged: boolean = isPackagedOrcaBuild()
): boolean {
  return env.ORCA_CLOUD_DEV_AUTH === '1' && env.NODE_ENV !== 'production' && !packaged
}
