import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getRuntimeGitStatus: vi.fn() }))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      settings: null,
      worktreesByRepo: {
        'repo-1': [
          { id: 'repo-1::/a', repoId: 'repo-1', path: '/a' },
          { id: 'repo-1::/b', repoId: 'repo-1', path: '/b' }
        ]
      }
    })
  }
}))
vi.mock('@/lib/connection-context', () => ({
  getConnectionId: () => null,
  isWorktreeConnectionResolved: () => true
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getSettingsForWorktreeRuntimeOwner: () => ({ activeRuntimeEnvironmentId: null })
}))
vi.mock('@/runtime/runtime-git-client', () => ({ getRuntimeGitStatus: mocks.getRuntimeGitStatus }))

import { fetchChangedFilesForWorktrees } from './session-canvas-git-status'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchChangedFilesForWorktrees', () => {
  it('omits failed worktrees and logs each failure once', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    mocks.getRuntimeGitStatus.mockImplementation(async ({ worktreeId }: { worktreeId: string }) => {
      if (worktreeId === 'repo-1::/b') {
        throw new Error('not a git repo')
      }
      return { entries: [{ path: 'x.ts' }, { path: 'x.ts' }] }
    })
    const ids = ['repo-1::/a', 'repo-1::/b']
    expect(await fetchChangedFilesForWorktrees(ids)).toEqual({ 'repo-1::/a': ['x.ts'] })
    await fetchChangedFilesForWorktrees(ids)
    expect(debug).toHaveBeenCalledTimes(1)
    expect(debug.mock.calls[0]).toContain('repo-1::/b')
  })
})
