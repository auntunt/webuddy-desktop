import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  OrcaCloudCapabilities,
  OrcaCloudOrgSummary,
  OrcaProfileCloudSummary
} from '../../shared/orca-profiles'

const {
  revokeOrcaCloudSessionMock,
  signInOrcaCloudSessionMock,
  OrcaCloudRequestErrorMock,
  safeStorageMock
} = vi.hoisted(() => ({
  revokeOrcaCloudSessionMock: vi.fn(),
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
  app: { getPath: () => userDataPath },
  safeStorage: safeStorageMock
}))

// Why the mock exports its own error class: the service does
// `instanceof OrcaCloudRequestError`, so both sides must resolve the same binding.
vi.mock('./profile-cloud-client', () => ({
  OrcaCloudRequestError: OrcaCloudRequestErrorMock,
  createOrcaCloudProfile: vi.fn(),
  revokeOrcaCloudSession: revokeOrcaCloudSessionMock,
  selectOrcaCloudOrg: vi.fn(),
  signInOrcaCloudSession: signInOrcaCloudSessionMock
}))

import {
  getCurrentOrcaProfileAuthStatus,
  signInCurrentOrcaProfile,
  signOutCurrentOrcaProfile
} from './profile-cloud-service'

const credentials = { username: 'nina', password: 'correct-horse' }

const cloud: OrcaProfileCloudSummary = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  displayName: 'Nina',
  linkedAt: 10
}

const laterCloud: OrcaProfileCloudSummary = {
  ...cloud,
  cloudProfileId: 'cloud-profile-2',
  email: 'ada@example.com'
}

const capabilities: OrcaCloudCapabilities = { flags: { share: true }, refreshedAt: 11 }
const organizations: OrcaCloudOrgSummary[] = [{ orgId: 'org-1', name: 'Acme', role: 'Admin' }]

describe('Orca cloud sign-out vs newer connect', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-cloud-sign-out-connect-'))
    revokeOrcaCloudSessionMock.mockReset()
    signInOrcaCloudSessionMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.stubEnv('ORCA_CLOUD_API_URL', 'https://orca-cloud.example')
    signInOrcaCloudSessionMock.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3_600_000,
      cloud,
      organizations,
      capabilities
    })
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('keeps a newer connect that finishes while sign-out is still revoking', async () => {
    await expect(signInCurrentOrcaProfile(userDataPath, credentials)).resolves.toMatchObject({
      status: 'connected'
    })
    let finishRevoke!: () => void
    revokeOrcaCloudSessionMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRevoke = resolve
      })
    )
    const signingOut = signOutCurrentOrcaProfile(userDataPath)
    signInOrcaCloudSessionMock.mockResolvedValue({
      accessToken: 'later-access',
      refreshToken: 'later-refresh',
      expiresAt: Date.now() + 3_600_000,
      cloud: laterCloud,
      organizations,
      capabilities
    })
    await expect(signInCurrentOrcaProfile(userDataPath, credentials)).resolves.toMatchObject({
      status: 'connected'
    })
    expect(getCurrentOrcaProfileAuthStatus(userDataPath).cloud?.email).toBe('ada@example.com')
    finishRevoke()
    await expect(signingOut).resolves.toMatchObject({ status: 'signed-out' })
    expect(getCurrentOrcaProfileAuthStatus(userDataPath)).toMatchObject({
      state: 'connected',
      cloud: { email: 'ada@example.com' }
    })
  })
})
