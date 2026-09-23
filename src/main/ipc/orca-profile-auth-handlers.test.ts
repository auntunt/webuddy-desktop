import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  createCloudLinkedOrcaProfileMock,
  signInCurrentOrcaProfileMock,
  getCurrentOrcaProfileAuthStatusMock,
  refreshCurrentOrcaProfileAuthMock,
  selectCurrentOrcaProfileOrgMock,
  signOutCurrentOrcaProfileMock
} = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
  createCloudLinkedOrcaProfileMock: vi.fn(),
  signInCurrentOrcaProfileMock: vi.fn(),
  getCurrentOrcaProfileAuthStatusMock: vi.fn(),
  refreshCurrentOrcaProfileAuthMock: vi.fn(),
  selectCurrentOrcaProfileOrgMock: vi.fn(),
  signOutCurrentOrcaProfileMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    relaunch: vi.fn()
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('../tray/system-tray', () => ({
  destroySystemTray: vi.fn()
}))

vi.mock('../orca-profiles/profile-index-store', () => ({
  createLocalOrcaProfile: vi.fn(),
  getOrcaProfileListState: vi.fn(),
  seedNewOrcaProfileTelemetryConsent: vi.fn(),
  setActiveOrcaProfile: vi.fn()
}))

vi.mock('../orca-profiles/profile-project-transfer', () => ({
  transferOrcaProfileProject: vi.fn()
}))

vi.mock('../orca-profiles/profile-cloud-service', () => ({
  createCloudLinkedOrcaProfile: createCloudLinkedOrcaProfileMock,
  getCurrentOrcaProfileAuthStatus: getCurrentOrcaProfileAuthStatusMock,
  refreshCurrentOrcaProfileAuth: refreshCurrentOrcaProfileAuthMock,
  selectCurrentOrcaProfileOrg: selectCurrentOrcaProfileOrgMock,
  signInCurrentOrcaProfile: signInCurrentOrcaProfileMock,
  signOutCurrentOrcaProfile: signOutCurrentOrcaProfileMock
}))

import { registerOrcaProfileHandlers } from './orca-profiles'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'

describe('registerOrcaProfileHandlers auth channels', () => {
  beforeEach(() => {
    // Why the port and per-test: userData resolves through AppEnvironment now, and
    // the global setup's beforeEach reinstates its own fake before this runs.
    installFakeAppEnvironment({ getPath: () => '/tmp/orca-user-data' })
    handlers.clear()
    createCloudLinkedOrcaProfileMock.mockReset()
    signInCurrentOrcaProfileMock.mockReset()
    getCurrentOrcaProfileAuthStatusMock.mockReset()
    refreshCurrentOrcaProfileAuthMock.mockReset()
    selectCurrentOrcaProfileOrgMock.mockReset()
    signOutCurrentOrcaProfileMock.mockReset()
  })

  it('returns auth status for the current profile', async () => {
    const status = {
      activeProfileId: 'local-default',
      configured: false,
      state: 'unconfigured',
      persistence: 'none'
    }
    getCurrentOrcaProfileAuthStatusMock.mockReturnValue(status)
    registerOrcaProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(Promise.resolve(handlers.get('orcaProfiles:authStatus')?.(null))).resolves.toBe(
      status
    )
    expect(getCurrentOrcaProfileAuthStatusMock).toHaveBeenCalledWith('/tmp/orca-user-data')
  })

  it('signs in with credentials and signs out the current profile through the cloud service', async () => {
    const signInResult = { status: 'unconfigured', auth: { activeProfileId: 'local-default' } }
    const signOutResult = { status: 'signed-out', auth: { activeProfileId: 'local-default' } }
    signInCurrentOrcaProfileMock.mockResolvedValue(signInResult)
    signOutCurrentOrcaProfileMock.mockResolvedValue(signOutResult)
    registerOrcaProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(
        handlers.get('orcaProfiles:signIn')?.(null, {
          username: ' nina ',
          password: 'correct-horse'
        })
      )
    ).resolves.toBe(signInResult)
    await expect(
      Promise.resolve(handlers.get('orcaProfiles:signOutCurrent')?.(null))
    ).resolves.toBe(signOutResult)
    // Why the trimmed username but the untouched password: a leading/trailing
    // space can be part of a password, and trimming it would fail the login.
    expect(signInCurrentOrcaProfileMock).toHaveBeenCalledWith('/tmp/orca-user-data', {
      username: 'nina',
      password: 'correct-horse'
    })
    expect(signOutCurrentOrcaProfileMock).toHaveBeenCalledWith('/tmp/orca-user-data')
  })

  it('rejects sign-in without both credentials', async () => {
    registerOrcaProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(
        handlers.get('orcaProfiles:signIn')?.(null, { username: 'nina', password: '' })
      )
    ).rejects.toThrow('invalid_orca_profile_sign_in')
    expect(signInCurrentOrcaProfileMock).not.toHaveBeenCalled()
  })

  it('refreshes profile auth through the cloud service', async () => {
    const refreshResult = { status: 'refreshed', auth: { activeProfileId: 'local-default' } }
    refreshCurrentOrcaProfileAuthMock.mockResolvedValue(refreshResult)
    registerOrcaProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(Promise.resolve(handlers.get('orcaProfiles:refreshAuth')?.(null))).resolves.toBe(
      refreshResult
    )
    expect(refreshCurrentOrcaProfileAuthMock).toHaveBeenCalledWith('/tmp/orca-user-data')
  })

  it('validates organization selection before calling the cloud service', async () => {
    const selectResult = { status: 'selected', auth: { activeProfileId: 'local-default' } }
    selectCurrentOrcaProfileOrgMock.mockResolvedValue(selectResult)
    registerOrcaProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(handlers.get('orcaProfiles:selectOrg')?.(null, { orgId: ' org-1 ' }))
    ).resolves.toBe(selectResult)
    expect(selectCurrentOrcaProfileOrgMock).toHaveBeenCalledWith('/tmp/orca-user-data', 'org-1')

    await expect(
      Promise.resolve(handlers.get('orcaProfiles:selectOrg')?.(null, { orgId: ' ' }))
    ).rejects.toThrow('invalid_orca_profile_org_selection')
  })

  it('creates cloud-linked profiles with trimmed optional args', async () => {
    const createResult = {
      status: 'created',
      auth: { activeProfileId: 'local-default' },
      activeProfileId: 'local-default',
      profiles: [],
      profile: { id: 'cloud-1' }
    }
    createCloudLinkedOrcaProfileMock.mockResolvedValue(createResult)
    registerOrcaProfileHandlers({
      flush: vi.fn(),
      freezeWrites: vi.fn(),
      getSettings: () => ({})
    } as never)

    await expect(
      Promise.resolve(
        handlers.get('orcaProfiles:createCloudLinked')?.(null, { orgId: ' org-1 ', name: ' Acme ' })
      )
    ).resolves.toBe(createResult)
    expect(createCloudLinkedOrcaProfileMock).toHaveBeenCalledWith('/tmp/orca-user-data', {
      orgId: 'org-1',
      name: 'Acme'
    })
  })
})
