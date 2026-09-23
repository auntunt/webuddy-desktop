import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ARTIFACT_MAX_CONTENT_BYTES } from '../../../../shared/artifacts'
import { publishArtifactFromSurface } from './artifact-publish-flow'

const mocks = vi.hoisted(() => ({
  callRuntimeRpc: vi.fn(),
  openAccountSettings: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  state: {
    orcaProfileAuthStatus: { state: 'connected' } as { state: string } | null,
    openOrcaAccountSettings: vi.fn()
  }
}))

vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.callRuntimeRpc }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => mocks.state }
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))
vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess }
}))
const request = {
  sourceKey: '/repo/report.html',
  content: '<h1>Report</h1>',
  contentType: 'text/html' as const,
  fileName: 'report.html'
}
const published = {
  change: 'created' as const,
  item: {
    artifact: { slug: 'artifact-a' },
    shareUrl: 'https://share.cloudwaveai.cn/a/artifact-a'
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.orcaProfileAuthStatus = { state: 'connected' }
  mocks.state.openOrcaAccountSettings = mocks.openAccountSettings
})

describe('artifact publish flow', () => {
  it('publishes without preparing anything else when already signed in', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({ status: 'ok', value: published })
    const createRequest = vi.fn().mockResolvedValue(request)

    await expect(publishArtifactFromSurface(createRequest)).resolves.toBe(published)
    expect(mocks.openAccountSettings).not.toHaveBeenCalled()
    expect(createRequest).toHaveBeenCalledOnce()
    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'local' },
      'artifacts.publish',
      request
    )
  })

  it('opens the sign-in form instead of publishing when signed out', async () => {
    mocks.state.orcaProfileAuthStatus = { state: 'local' }
    const createRequest = vi.fn().mockResolvedValue(request)

    await expect(publishArtifactFromSurface(createRequest)).resolves.toBeNull()
    expect(mocks.openAccountSettings).toHaveBeenCalledOnce()
    expect(createRequest).not.toHaveBeenCalled()
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('retries once, then asks for a fresh sign-in when the session is rejected twice', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({ status: 'reconnect-required' })
    const createRequest = vi.fn().mockResolvedValue(request)

    await expect(publishArtifactFromSurface(createRequest)).resolves.toBeNull()
    expect(createRequest).toHaveBeenCalledTimes(2)
    expect(mocks.callRuntimeRpc).toHaveBeenCalledTimes(2)
    expect(mocks.toastError).toHaveBeenCalledWith('Sign in to Webuddy and try again.')
  })

  it('sends the user to the sign-in form when the session is gone mid-publish', async () => {
    // Why the state flips inside the RPC: the auth broadcast lands while the
    // publish is in flight, which is the only way to reach this branch.
    mocks.callRuntimeRpc.mockImplementation(async () => {
      mocks.state.orcaProfileAuthStatus = { state: 'reconnect-required' }
      return { status: 'reconnect-required' }
    })
    const createRequest = vi.fn().mockResolvedValue(request)

    await expect(publishArtifactFromSurface(createRequest)).resolves.toBeNull()
    expect(createRequest).toHaveBeenCalledOnce()
    expect(mocks.openAccountSettings).toHaveBeenCalledOnce()
    expect(mocks.toastError).toHaveBeenCalledWith('Sign in to Webuddy and try again.')
  })

  it('surfaces a preparation failure without publishing', async () => {
    const createRequest = vi.fn().mockRejectedValue(new Error('unreadable'))

    await expect(publishArtifactFromSurface(createRequest)).resolves.toBeNull()
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('Could not share artifact', undefined)
  })

  it('rejects an oversized request before RPC', async () => {
    const createRequest = vi.fn().mockResolvedValue({
      ...request,
      content: '"'.repeat(ARTIFACT_MAX_CONTENT_BYTES + 1)
    })

    await expect(publishArtifactFromSurface(createRequest)).resolves.toBeNull()
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('Could not share artifact', {
      description: 'This artifact is too large to share.'
    })
  })

  it('publishes content at the 10 MiB boundary', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({ status: 'ok', value: published })
    const createRequest = vi.fn().mockResolvedValue({
      ...request,
      content: 'a'.repeat(ARTIFACT_MAX_CONTENT_BYTES)
    })

    await expect(publishArtifactFromSurface(createRequest)).resolves.toBe(published)
    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'local' },
      'artifacts.publish',
      expect.objectContaining({ content: 'a'.repeat(ARTIFACT_MAX_CONTENT_BYTES) })
    )
  })

  it('shows confirmation without putting the public link in the toast', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({ status: 'ok', value: published })
    await publishArtifactFromSurface(() => Promise.resolve(request))

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Artifact shared')
  })
})
