import { describe, expect, it, vi } from 'vitest'
import {
  allowsPlaintextOrcaCloudSession,
  getOrcaCloudAuthConfig,
  isOrcaCloudDevAuthEnabled
} from './profile-cloud-auth-config'

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

describe('Orca cloud auth config', () => {
  it('reports unconfigured without an API URL', () => {
    expect(getOrcaCloudAuthConfig({})).toEqual({
      configured: false,
      setupMessage: 'Webuddy Cloud sign-in is not configured for this build.'
    })
  })

  it('builds default desktop auth endpoints from the API URL', () => {
    const state = getOrcaCloudAuthConfig({
      ORCA_CLOUD_API_URL: 'https://orca-cloud.example/'
    })

    expect(state).toEqual({
      configured: true,
      config: {
        apiBaseUrl: 'https://orca-cloud.example',
        sessionEndpoint: 'https://orca-cloud.example/api/desktop/session',
        refreshEndpoint: 'https://orca-cloud.example/api/desktop/refresh',
        capabilitiesEndpoint: 'https://orca-cloud.example/api/desktop/capabilities',
        profileEndpoint: 'https://orca-cloud.example/api/desktop/profile',
        orgEndpoint: 'https://orca-cloud.example/api/desktop/org',
        logoutEndpoint: 'https://orca-cloud.example/api/desktop/logout',
        relayTokenEndpoint: 'https://orca-cloud.example/api/desktop/relay-token',
        relayDirectorUrl: 'https://webuddyserver.cloudwaveai.cn'
      }
    })
  })

  it('uses first-party production endpoints without runtime env in packaged builds', () => {
    expect(getOrcaCloudAuthConfig({}, true)).toEqual({
      configured: true,
      config: {
        apiBaseUrl: 'https://webuddyserver.cloudwaveai.cn',
        sessionEndpoint: 'https://webuddyserver.cloudwaveai.cn/api/desktop/session',
        refreshEndpoint: 'https://webuddyserver.cloudwaveai.cn/api/desktop/refresh',
        capabilitiesEndpoint: 'https://webuddyserver.cloudwaveai.cn/api/desktop/capabilities',
        profileEndpoint: 'https://webuddyserver.cloudwaveai.cn/api/desktop/profile',
        orgEndpoint: 'https://webuddyserver.cloudwaveai.cn/api/desktop/org',
        logoutEndpoint: 'https://webuddyserver.cloudwaveai.cn/api/desktop/logout',
        relayTokenEndpoint: 'https://webuddyserver.cloudwaveai.cn/api/desktop/relay-token',
        relayDirectorUrl: 'https://webuddyserver.cloudwaveai.cn'
      }
    })
  })

  it('allows loopback HTTP endpoints for local desktop auth development', () => {
    const state = getOrcaCloudAuthConfig({
      ORCA_CLOUD_API_URL: 'http://localhost:4100'
    })

    expect(state.configured).toBe(true)
  })

  it('rejects loopback HTTP endpoints in packaged builds', () => {
    expect(
      getOrcaCloudAuthConfig({ ORCA_CLOUD_API_URL: 'http://localhost:4100' }, true)
    ).toMatchObject({ configured: false })

    const httpsState = getOrcaCloudAuthConfig(
      { ORCA_CLOUD_API_URL: 'https://orca-cloud.example' },
      true
    )
    expect(httpsState.configured).toBe(true)
  })

  it('rejects non-HTTPS non-loopback API URLs', () => {
    expect(
      getOrcaCloudAuthConfig({ ORCA_CLOUD_API_URL: 'http://orca-cloud.example' })
    ).toMatchObject({ configured: false })
  })

  it('allows dev plaintext sessions only outside production', () => {
    expect(
      allowsPlaintextOrcaCloudSession({
        ORCA_CLOUD_ALLOW_PLAINTEXT_SESSION: '1',
        NODE_ENV: 'development'
      })
    ).toBe(true)
    expect(
      allowsPlaintextOrcaCloudSession({
        ORCA_CLOUD_ALLOW_PLAINTEXT_SESSION: '1',
        NODE_ENV: 'production'
      })
    ).toBe(false)
  })

  it('ignores dev flags in packaged builds even without NODE_ENV', () => {
    // Why: packaged main bundles never define NODE_ENV, so packaged-ness must
    // gate the escape hatches on its own.
    expect(allowsPlaintextOrcaCloudSession({ ORCA_CLOUD_ALLOW_PLAINTEXT_SESSION: '1' }, true)).toBe(
      false
    )
    expect(isOrcaCloudDevAuthEnabled({ ORCA_CLOUD_DEV_AUTH: '1' }, true)).toBe(false)
  })

  it('allows local dev auth only outside production', () => {
    expect(
      isOrcaCloudDevAuthEnabled({
        ORCA_CLOUD_DEV_AUTH: '1',
        NODE_ENV: 'development'
      })
    ).toBe(true)
    expect(
      isOrcaCloudDevAuthEnabled({
        ORCA_CLOUD_DEV_AUTH: '1',
        NODE_ENV: 'production'
      })
    ).toBe(false)
  })
})
