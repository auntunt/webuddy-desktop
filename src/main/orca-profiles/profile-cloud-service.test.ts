import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  OrcaCloudCapabilities,
  OrcaCloudOrgSummary,
  OrcaProfileCloudSummary
} from '../../shared/orca-profiles'
import type { OrcaCloudSessionExchangeResponse } from './profile-cloud-session-exchange'

const {
  createOrcaCloudProfileMock,
  revokeOrcaCloudSessionMock,
  selectOrcaCloudOrgMock,
  signInOrcaCloudSessionMock,
  OrcaCloudRequestErrorMock,
  safeStorageMock
} = vi.hoisted(() => ({
  createOrcaCloudProfileMock: vi.fn(),
  revokeOrcaCloudSessionMock: vi.fn(),
  selectOrcaCloudOrgMock: vi.fn(),
  signInOrcaCloudSessionMock: vi.fn(),
  OrcaCloudRequestErrorMock: class OrcaCloudRequestError extends Error {
    constructor(public readonly statusCode: number) {
      super(`orca_cloud_request_failed_${statusCode}`)
      this.name = 'OrcaCloudRequestError'
    }
  },
  safeStorageMock: {
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8')),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    isEncryptionAvailable: vi.fn(() => true)
  }
}))

let userDataPath = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath
  },
  safeStorage: safeStorageMock
}))

// Why the mock exports its own error class: the service does
// `instanceof OrcaCloudRequestError`, so both sides must resolve the same binding.
vi.mock('./profile-cloud-client', () => ({
  OrcaCloudRequestError: OrcaCloudRequestErrorMock,
  createOrcaCloudProfile: createOrcaCloudProfileMock,
  revokeOrcaCloudSession: revokeOrcaCloudSessionMock,
  selectOrcaCloudOrg: selectOrcaCloudOrgMock,
  signInOrcaCloudSession: signInOrcaCloudSessionMock
}))

import {
  createCloudLinkedOrcaProfile,
  getCurrentOrcaProfileAuthStatus,
  selectCurrentOrcaProfileOrg,
  signInCurrentOrcaProfile,
  signOutCurrentOrcaProfile
} from './profile-cloud-service'

const credentials = { username: 'nina', password: 'correct-horse' }

const cloudSummary: OrcaProfileCloudSummary = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  displayName: 'Nina',
  linkedAt: 10
}

const capabilities: OrcaCloudCapabilities = {
  flags: { share: true },
  refreshedAt: 11
}

const organizations: OrcaCloudOrgSummary[] = [
  { orgId: 'org-1', name: 'Acme', role: 'Admin' },
  { orgId: 'org-2', name: 'Personal' }
]

function configureCloudEnv(): void {
  vi.stubEnv('ORCA_CLOUD_API_URL', 'https://orca-cloud.example')
}

function futureExpiresAt(): number {
  return Date.now() + 3_600_000
}

function mockSuccessfulSignIn(expiresAt = futureExpiresAt()): void {
  signInOrcaCloudSessionMock.mockResolvedValue({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt,
    cloud: cloudSummary,
    organizations,
    capabilities
  } satisfies OrcaCloudSessionExchangeResponse)
}

describe('Orca cloud profile service', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-cloud-service-'))
    createOrcaCloudProfileMock.mockReset()
    revokeOrcaCloudSessionMock.mockReset()
    selectOrcaCloudOrgMock.mockReset()
    signInOrcaCloudSessionMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    revokeOrcaCloudSessionMock.mockResolvedValue(undefined)
    vi.unstubAllEnvs()
    vi.stubEnv('ORCA_CLOUD_API_URL', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('reports local unconfigured auth without cloud setup', () => {
    expect(getCurrentOrcaProfileAuthStatus(userDataPath)).toMatchObject({
      activeProfileId: 'local-default',
      configured: false,
      state: 'unconfigured',
      persistence: 'none'
    })
  })

  it('connects the active local profile without replacing its local profile ID', async () => {
    configureCloudEnv()
    mockSuccessfulSignIn()

    const result = await signInCurrentOrcaProfile(userDataPath, credentials)

    if (result.status !== 'connected') {
      throw new Error(`Expected connected result, got ${result.status}`)
    }
    expect(result.activeProfileId).toBe('local-default')
    expect(result.profiles[0]).toMatchObject({
      id: 'local-default',
      kind: 'cloud-linked',
      cloud: cloudSummary
    })
    expect(signInOrcaCloudSessionMock).toHaveBeenCalledWith(expect.any(Object), {
      ...credentials,
      localProfileId: 'local-default'
    })
    expect(getCurrentOrcaProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'connected',
      persistence: 'encrypted',
      cloud: cloudSummary,
      organizations,
      capabilities
    })
  })

  it('reports a rejected credential as a failed sign-in', async () => {
    configureCloudEnv()
    signInOrcaCloudSessionMock.mockRejectedValue(new OrcaCloudRequestErrorMock(401))

    const result = await signInCurrentOrcaProfile(userDataPath, credentials)

    expect(result).toMatchObject({ status: 'failed', error: '用户名或密码不对' })
    expect(getCurrentOrcaProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'local',
      persistence: 'none'
    })
  })

  it('reports other transport failures verbatim', async () => {
    configureCloudEnv()
    signInOrcaCloudSessionMock.mockRejectedValue(new OrcaCloudRequestErrorMock(503))

    const result = await signInCurrentOrcaProfile(userDataPath, credentials)

    expect(result).toMatchObject({ status: 'failed' })
    expect(getCurrentOrcaProfileAuthStatus(userDataPath)).toMatchObject({ state: 'local' })
  })

  it('does not report a saved cloud session as connected when cloud config is unavailable', async () => {
    configureCloudEnv()
    mockSuccessfulSignIn()
    await signInCurrentOrcaProfile(userDataPath, credentials)
    vi.stubEnv('ORCA_CLOUD_API_URL', '')

    expect(getCurrentOrcaProfileAuthStatus(userDataPath)).toMatchObject({
      configured: false,
      state: 'unconfigured',
      persistence: 'encrypted',
      cloud: cloudSummary,
      setupMessage: 'Webuddy Cloud sign-in is not configured for this build.'
    })
    expect(getCurrentOrcaProfileAuthStatus(userDataPath).organizations).toBeUndefined()
    expect(getCurrentOrcaProfileAuthStatus(userDataPath).capabilities).toBeUndefined()
  })

  it('signs out by removing cloud metadata while keeping the local profile', async () => {
    configureCloudEnv()
    mockSuccessfulSignIn()
    await signInCurrentOrcaProfile(userDataPath, credentials)

    const result = await signOutCurrentOrcaProfile(userDataPath)

    expect(result.status).toBe('signed-out')
    expect(result.activeProfileId).toBe('local-default')
    expect(result.profiles[0]).toMatchObject({ id: 'local-default', kind: 'local' })
    expect(result.profiles[0]?.cloud).toBeUndefined()
    expect(getCurrentOrcaProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'local',
      persistence: 'none'
    })
    expect(revokeOrcaCloudSessionMock).toHaveBeenCalledOnce()
  })

  it('creates a new empty cloud-linked profile with its own cloud session', async () => {
    configureCloudEnv()
    mockSuccessfulSignIn()
    await signInCurrentOrcaProfile(userDataPath, credentials)
    createOrcaCloudProfileMock.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: 1000,
      cloud: {
        ...cloudSummary,
        cloudProfileId: 'cloud-profile-2',
        activeOrgId: 'org-1',
        activeOrgName: 'Acme'
      },
      organizations,
      capabilities: { flags: { share: true, team: true }, refreshedAt: 13 }
    } satisfies OrcaCloudSessionExchangeResponse)

    const result = await createCloudLinkedOrcaProfile(userDataPath, {
      orgId: 'org-1',
      name: 'Acme'
    })

    if (result.status !== 'created') {
      throw new Error(`Expected created result, got ${result.status}`)
    }
    expect(result.profile).toMatchObject({
      id: expect.stringMatching(/^cloud-/),
      name: 'Acme',
      kind: 'cloud-linked',
      cloud: expect.objectContaining({ cloudProfileId: 'cloud-profile-2' })
    })
    expect(createOrcaCloudProfileMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'access-token' }),
      { orgId: 'org-1', name: 'Acme' }
    )
  })

  it('selects an organization for a connected profile', async () => {
    configureCloudEnv()
    mockSuccessfulSignIn()
    await signInCurrentOrcaProfile(userDataPath, credentials)
    const orgCloudSummary = {
      ...cloudSummary,
      activeOrgId: 'org-1',
      activeOrgName: 'Acme'
    }
    selectOrcaCloudOrgMock.mockResolvedValue({
      cloud: orgCloudSummary,
      organizations,
      capabilities: { flags: { share: true, sso: true }, refreshedAt: 12 }
    })

    const result = await selectCurrentOrcaProfileOrg(userDataPath, 'org-1')

    expect(result.status).toBe('selected')
    expect(selectOrcaCloudOrgMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ accessToken: 'access-token' }),
      'org-1'
    )
    expect(getCurrentOrcaProfileAuthStatus(userDataPath).cloud).toMatchObject({
      activeOrgId: 'org-1',
      activeOrgName: 'Acme'
    })
    expect(getCurrentOrcaProfileAuthStatus(userDataPath).organizations).toEqual(organizations)
  })
})
