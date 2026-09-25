import { useAppStore } from '@/store'
import { getConnectionId, isWorktreeConnectionResolved } from '@/lib/connection-context'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { getRuntimeGitStatus } from '@/runtime/runtime-git-client'
import { getIndexedWorktreeById } from '@/store/worktree-repo-index'

const loggedFailures = new Set<string>()

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
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value) {
        changed[result.value.worktreeId] = result.value.files
      }
      return
    }
    const worktreeId = worktreeIds[index]
    // Polled every 15 s and only feeds same-file edges: log once, never toast.
    if (!loggedFailures.has(worktreeId)) {
      loggedFailures.add(worktreeId)
      console.debug('[session-canvas] git status failed', worktreeId, result.reason)
    }
  })
  return changed
}
