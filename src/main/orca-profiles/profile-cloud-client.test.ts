import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelTrackingResponse } from '../lib/unread-response-body.test-fixtures'
import type { OrcaCloudAuthConfig } from './profile-cloud-auth-config'
import type { OrcaCloudSession } from './profile-cloud-session-store'
import {
  createOrcaCloudProfile,
  refreshOrcaCloudCapabilities,
  refreshOrcaCloudSession,
  selectOrcaCloudOrg,
  signInOrcaCloudSession
} from './profile-cloud-client'

const fetchMock = vi.fn()

const config: OrcaCloudAuthConfig = {
  apiBaseUrl: 'https://orca-cloud.example',
  sessionEndpoint: 'https://orca-cloud.example/api/desktop/session',
  refreshEndpoint: 'https://orca-cloud.example/api/desktop/refresh',
  capabilitiesEndpoint: 'https://orca-cloud.example/api/desktop/capabilities',
  profileEndpoint: 'https://orca-cloud.example/api/desktop/profile',
  orgEndpoint: 'https://orca-cloud.example/api/desktop/org',
  logoutEndpoint: 'https://orca-cloud.example/api/desktop/logout',
  relayTokenEndpoint: 'https://orca-cloud.example/api/desktop/relay-token',
  relayDirectorUrl: 'https://relay.example'
}

const session: OrcaCloudSession = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: 999,
  capabilities: { flags: { share: true }, refreshedAt: 1 }
}

function mockFetchJson(value: unknown): void {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => value
  })
}

describe('Orca cloud client', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('normalizes the sign-in session exchange organizations', async () => {
    mockFetchJson({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 999,
      cloud: {
        cloudProfileId: 'cloud-profile-1',
        userId: 'user-1',
        email: 'nina@example.com'
      },
      organizations: [
        { orgId: 'org-1', name: 'Acme', role: 'Admin' },
        { orgId: '', name: 'Ignored' }
      ],
      capabilities: {
        flags: { share: true },
        refreshedAt: 123
      }
    })

    await expect(
      signInOrcaCloudSession(config, {
        username: 'nina',
        password: 'correct-horse',
        localProfileId: 'local-default'
      })
    ).resolves.toMatchObject({
      organizations: [{ orgId: 'org-1', name: 'Acme', role: 'Admin' }]
    })
    expect(fetchMock).toHaveBeenCalledWith(
      config.sessionEndpoint,
      expect.objectContaining({
        body: JSON.stringify({
          username: 'nina',
          password: 'correct-horse',
          localProfileId: 'local-default'
        })
      })
    )
  })

  it('normalizes organization selection response metadata', async () => {
    mockFetchJson({
      cloud: {
        cloudProfileId: 'cloud-profile-1',
        userId: 'user-1',
        email: 'nina@example.com',
        activeOrgId: 'org-2',
        activeOrgName: 'Personal'
      },
      organizations: [
        { orgId: 'org-1', name: 'Acme' },
        { orgId: 'org-2', name: 'Personal' }
      ],
      capabilities: {
        flags: { share: false, sso: true },
        refreshedAt: 456
      }
    })

    await expect(selectOrcaCloudOrg(config, session, 'org-2')).resolves.toEqual({
      cloud: expect.objectContaining({ activeOrgId: 'org-2', activeOrgName: 'Personal' }),
      organizations: [
        { orgId: 'org-1', name: 'Acme', role: undefined },
        { orgId: 'org-2', name: 'Personal', role: undefined }
      ],
      capabilities: { flags: { share: false, sso: true }, refreshedAt: 456 }
    })
    expect(fetchMock).toHaveBeenCalledWith(
      config.orgEndpoint,
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer access-token' })
      })
    )
  })

  it('creates cloud profiles with a profile-scoped session response', async () => {
    mockFetchJson({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: 1000,
      cloud: {
        cloudProfileId: 'cloud-profile-2',
        userId: 'user-1',
        email: 'nina@example.com',
        activeOrgId: 'org-1',
        activeOrgName: 'Acme'
      },
      organizations: [{ orgId: 'org-1', name: 'Acme' }],
      capabilities: {
        flags: { share: true },
        refreshedAt: 789
      }
    })

    await expect(
      createOrcaCloudProfile(config, session, { orgId: 'org-1', name: 'Acme' })
    ).resolves.toMatchObject({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      cloud: expect.objectContaining({ cloudProfileId: 'cloud-profile-2' }),
      organizations: [{ orgId: 'org-1', name: 'Acme', role: undefined }]
    })
    expect(fetchMock).toHaveBeenCalledWith(
      config.profileEndpoint,
      expect.objectContaining({
        body: JSON.stringify({ orgId: 'org-1', name: 'Acme' })
      })
    )
  })

  it('refreshes session material without exposing refresh tokens in URLs', async () => {
    mockFetchJson({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      expiresAt: 2000,
      cloud: {
        cloudProfileId: 'cloud-profile-1',
        userId: 'user-1',
        email: 'nina@example.com'
      },
      capabilities: {
        flags: { share: true },
        refreshedAt: 999
      }
    })

    await expect(refreshOrcaCloudSession(config, session)).resolves.toMatchObject({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      config.refreshEndpoint,
      expect.objectContaining({
        body: JSON.stringify({ refreshToken: 'refresh-token' })
      })
    )
  })

  it('refreshes capability flags and optional org metadata with the current access token', async () => {
    mockFetchJson({
      cloud: {
        cloudProfileId: 'cloud-profile-1',
        userId: 'user-1',
        email: 'nina@example.com'
      },
      organizations: [],
      capabilities: {
        flags: { share: false, team: true },
        refreshedAt: 1001
      }
    })

    await expect(refreshOrcaCloudCapabilities(config, session)).resolves.toEqual({
      cloud: expect.objectContaining({ cloudProfileId: 'cloud-profile-1' }),
      organizations: [],
      capabilities: {
        flags: { share: false, team: true },
        refreshedAt: 1001
      }
    })
    expect(fetchMock).toHaveBeenCalledWith(
      config.capabilitiesEndpoint,
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer access-token' })
      })
    )
  })

  it('trims cloud metadata and drops blank active org fields', async () => {
    mockFetchJson({
      cloud: {
        cloudProfileId: ' cloud-profile-1 ',
        userId: ' user-1 ',
        email: ' nina@example.com ',
        displayName: ' Nina ',
        activeOrgId: ' ',
        activeOrgName: ''
      },
      capabilities: {
        flags: {},
        refreshedAt: 1002
      }
    })

    await expect(refreshOrcaCloudCapabilities(config, session)).resolves.toMatchObject({
      cloud: {
        cloudProfileId: 'cloud-profile-1',
        userId: 'user-1',
        email: 'nina@example.com',
        displayName: 'Nina',
        activeOrgId: undefined,
        activeOrgName: undefined
      }
    })
  })

  it('cancels the unread error-response body so bundled undici cannot crash on socket close', async () => {
    let cancelledBodies = 0
    fetchMock.mockResolvedValue(
      cancelTrackingResponse(502, () => {
        cancelledBodies += 1
      })
    )

    await expect(refreshOrcaCloudCapabilities(config, session)).rejects.toThrow()
    expect(cancelledBodies).toBe(1)
  })
})
