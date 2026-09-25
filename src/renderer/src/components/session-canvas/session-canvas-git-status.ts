import { useAppStore } from '@/store'
import { getConnectionId, isWorktreeConnectionResolved } from '@/lib/connection-context'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { getRuntimeGitStatus } from '@/runtime/runtime-git-client'
import { getIndexedWorktreeById } from '@/store/worktree-repo-index'

/**
 * Changed files per worktree, fetched through the same host-aware git status path as the
 * sidebar (local, SSH or paired runtime). Worktrees that fail or aren't resolved yet are
 * omitted rather than reported as clean.
 */
export async function fetchChangedFilesForWorktrees(
  worktreeIds: readonly string[]
): Promise<Record<string, string[]>> {
  const state = useAppStore.getState()
  const results = await Promise.allSettled(
    worktreeIds.map(async (worktreeId) => {
      const worktree = getIndexedWorktreeById(state.worktreesByRepo, worktreeId)
      // Why: an unresolved owner could send a remote path to the local git (#6648).
      if (!worktree || !isWorktreeConnectionResolved(worktreeId)) {
        return null
      }
      const status = await getRuntimeGitStatus(
        {
          settings: getSettingsForWorktreeRuntimeOwner(state, worktreeId),
          worktreeId,
          worktreePath: worktree.path,
          connectionId: getConnectionId(worktreeId) ?? undefined
        },
        { admissionTier: 'background', includeLineStats: false }
      )
      return { worktreeId, files: [...new Set(status.entries.map((entry) => entry.path))] }
    })
  )
  const changed: Record<string, string[]> = {}
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      changed[result.value.worktreeId] = result.value.files
    }
  }
  return changed
}
