import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  refreshOrcaCloudCapabilities: vi.fn(),
  refreshOrcaCloudSession: vi.fn(),
  revokeOrcaCloudSession: revokeOrcaCloudSessionMock,
  selectOrcaCloudOrg: vi.fn(),
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

describe('Orca cloud dev auth service', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-cloud-dev-auth-'))
    revokeOrcaCloudSessionMock.mockReset()
    signInOrcaCloudSessionMock.mockReset()
    safeStorageMock.decryptString.mockReset()
    safeStorageMock.encryptString.mockReset()
    safeStorageMock.isEncryptionAvailable.mockReset()
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString('utf-8'))
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value, 'utf-8'))
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.unstubAllEnvs()
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ORCA_CLOUD_DEV_AUTH', '1')
    vi.stubEnv('ORCA_CLOUD_API_URL', '')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('connects the active profile without hitting the cloud', async () => {
    expect(getCurrentOrcaProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'local'
    })

    const result = await signInCurrentOrcaProfile(userDataPath, credentials)

    expect(result.status).toBe('connected')
    expect(signInOrcaCloudSessionMock).not.toHaveBeenCalled()
    expect(getCurrentOrcaProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'connected',
      persistence: 'encrypted',
      cloud: {
        cloudProfileId: 'dev-cloud-local-default',
        email: 'dev@orca.local'
      },
      capabilities: {
        flags: expect.objectContaining({ 'share.create': true })
      }
    })
    expect(getCurrentOrcaProfileAuthStatus(userDataPath).organizations).toHaveLength(2)
  })

  it('selects dev organizations and creates org-scoped cloud profiles locally', async () => {
    await signInCurrentOrcaProfile(userDataPath, credentials)

    const selected = await selectCurrentOrcaProfileOrg(userDataPath, 'dev-acme')
    const created = await createCloudLinkedOrcaProfile(userDataPath, {
      orgId: 'dev-acme',
      name: 'Acme Dev'
    })

    expect(selected.status).toBe('selected')
    expect(getCurrentOrcaProfileAuthStatus(userDataPath).cloud).toMatchObject({
      activeOrgId: 'dev-acme',
      activeOrgName: 'Acme Dev'
    })
    expect(created.status).toBe('created')
    if (created.status === 'created') {
      expect(created.profile).toMatchObject({
        name: 'Acme Dev',
        kind: 'cloud-linked',
        cloud: expect.objectContaining({
          activeOrgId: 'dev-acme',
          activeOrgName: 'Acme Dev'
        })
      })
    }
  })

  it('signs out locally without calling the cloud logout endpoint', async () => {
    await signInCurrentOrcaProfile(userDataPath, credentials)

    const result = await signOutCurrentOrcaProfile(userDataPath)

    expect(result.status).toBe('signed-out')
    expect(revokeOrcaCloudSessionMock).not.toHaveBeenCalled()
    expect(getCurrentOrcaProfileAuthStatus(userDataPath)).toMatchObject({
      configured: true,
      state: 'local',
      persistence: 'none'
    })
  })
})
