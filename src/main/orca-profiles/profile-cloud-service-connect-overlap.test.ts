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
  app: {
    getPath: () => userDataPath
  },
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

const earlierCloud: OrcaProfileCloudSummary = {
  cloudProfileId: 'cloud-profile-1',
  userId: 'user-1',
  email: 'nina@example.com',
  displayName: 'Nina',
  linkedAt: 10
}

const laterCloud: OrcaProfileCloudSummary = {
  ...earlierCloud,
  cloudProfileId: 'cloud-profile-2',
  userId: 'user-2',
  email: 'ada@example.com'
}

const capabilities: OrcaCloudCapabilities = {
  flags: { share: true },
  refreshedAt: 11
}

const organizations: OrcaCloudOrgSummary[] = [{ orgId: 'org-1', name: 'Acme', role: 'Admin' }]

function exchangeFor(cloud: OrcaProfileCloudSummary): OrcaCloudSessionExchangeResponse {
  return {
    accessToken: `${cloud.userId}-access`,
    refreshToken: `${cloud.userId}-refresh`,
    expiresAt: Date.now() + 3_600_000,
    cloud,
    organizations,
    capabilities
  }
}

const earlierSession = exchangeFor(earlierCloud)
const laterSession = exchangeFor(laterCloud)

describe('Orca cloud overlapping connect', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-cloud-connect-overlap-'))
    revokeOrcaCloudSessionMock.mockReset()
    revokeOrcaCloudSessionMock.mockResolvedValue(undefined)
    signInOrcaCloudSessionMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.stubEnv('ORCA_CLOUD_API_URL', 'https://orca-cloud.example')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('does not let an earlier sign-in overwrite a later successful one', async () => {
    let finishFirst!: (value: OrcaCloudSessionExchangeResponse) => void
    signInOrcaCloudSessionMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishFirst = resolve
        })
      )
      .mockResolvedValueOnce(laterSession)

    const first = signInCurrentOrcaProfile(userDataPath, credentials)
    const later = signInCurrentOrcaProfile(userDataPath, credentials)
    await expect(later).resolves.toMatchObject({ status: 'connected' })
    expect(getCurrentOrcaProfileAuthStatus(userDataPath).cloud?.email).toBe('ada@example.com')

    finishFirst(earlierSession)
    await expect(first).resolves.toMatchObject({ status: 'cancelled' })
    expect(getCurrentOrcaProfileAuthStatus(userDataPath).cloud?.email).toBe('ada@example.com')
  })

  it('discards an earlier sign-in that resolves after a later one has linked', async () => {
    let finishEarlier!: (value: OrcaCloudSessionExchangeResponse) => void
    let finishLater!: (value: OrcaCloudSessionExchangeResponse) => void
    signInOrcaCloudSessionMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishEarlier = resolve
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishLater = resolve
        })
      )

    const earlier = signInCurrentOrcaProfile(userDataPath, credentials)
    const later = signInCurrentOrcaProfile(userDataPath, credentials)
    await vi.waitFor(() => expect(signInOrcaCloudSessionMock).toHaveBeenCalledTimes(2))

    finishLater(laterSession)
    await expect(later).resolves.toMatchObject({ status: 'connected' })
    expect(getCurrentOrcaProfileAuthStatus(userDataPath).cloud?.email).toBe('ada@example.com')

    finishEarlier(earlierSession)
    await expect(earlier).resolves.toMatchObject({ status: 'cancelled' })
    expect(getCurrentOrcaProfileAuthStatus(userDataPath).cloud?.email).toBe('ada@example.com')
  })

  it('does not relink an in-flight later sign-in after sign-out', async () => {
    let finishLater!: (value: OrcaCloudSessionExchangeResponse) => void
    signInOrcaCloudSessionMock.mockResolvedValueOnce(earlierSession).mockReturnValueOnce(
      new Promise((resolve) => {
        finishLater = resolve
      })
    )

    const earlier = signInCurrentOrcaProfile(userDataPath, credentials)
    const later = signInCurrentOrcaProfile(userDataPath, credentials)
    await expect(earlier).resolves.toMatchObject({ status: 'connected' })
    await expect(signOutCurrentOrcaProfile(userDataPath)).resolves.toMatchObject({
      status: 'signed-out'
    })

    finishLater(laterSession)
    await expect(later).resolves.toMatchObject({ status: 'cancelled' })
    expect(getCurrentOrcaProfileAuthStatus(userDataPath)).toMatchObject({ state: 'local' })
  })
})
